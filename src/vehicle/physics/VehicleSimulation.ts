import type { RapierContext, RapierRigidBody } from '@react-three/rapier';
import { Quaternion, Vector3 } from 'three';
import type { VehicleConfig, VehicleInput, VehicleTelemetry } from '../../shared/types.ts';
import {
  stableReferenceSpeedMps, staticWheelLoadN, stepTireThermal, temperatureGripFactor, thermalParamsFor, tireForce,
  type TireForceParams, type TireThermalParams,
} from './tireModel.ts';
import { calculateSuspensionForceN, interpolateTorqueNm } from './vehicleMath.ts';

export interface WheelPose {
  xM: number;
  zM: number;
  suspensionM: number;
  steeringRad: number;
  spinRad: number;
  /** Vitesse de rotation de la roue (rad/s, positive en roulant vers l'avant). */
  omegaRadPerS: number;
  /** Température de la bande de roulement (°C) : celle qui détermine l'adhérence. */
  temperatureC: number;
  /** Température de la carcasse (°C) : inertielle, elle réchauffe lentement la bande. */
  carcassTemperatureC: number;
  /** Vrai si la roue appuie sur le sol à ce pas. */
  grounded: boolean;
  /** Puissance de frottement au contact (W) : mesure physique du glissement, base de la fumée et des traces de pneus. */
  slidingPowerW: number;
  /** Point de contact au sol (repère de rendu courant) ; valide seulement si `grounded`. */
  contactX: number;
  contactY: number;
  contactZ: number;
}

const clamp = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));
const moveTowards = (value: number, target: number, amount: number) => value + clamp(target - value, -amount, amount);

/**
 * Un vrai pneu a une longueur de relaxation (~0,3 m) : sa force se construit sur une distance, pas instantanément, donc
 * elle est « douce » à basse vitesse. Sans cela, la raideur au contact rend l'intégration explicite du châssis instable
 * à l'arrêt (la voiture vibre). Les vitesses de référence ci-dessous (voir stableReferenceSpeedMps) jouent ce rôle et ne
 * changent rien au-dessus de ~20 km/h. Planchers minimaux en m/s.
 */
const MIN_SLIP_REFERENCE_SPEED_MPS = 2;
/** ABS : le frein de service ne peut pas ralentir la roue au-delà de ce multiple du glissement au pic (la roue reste près du maximum d'adhérence). */
const ABS_SLIP_LIMIT = 1.25;
/** Largeur (m/s) du lissage du signe de la vitesse pour les résistances au roulement et au frein moteur. */
const SIGN_SMOOTHING_MPS = 0.4;
const SIGN_SMOOTHING_RADPS = 0.5;

/**
 * Applique un freinage de `deltaOmega` (rad/s perdus dans le pas) à une roue : il réduit |ω| sans jamais l'inverser ni
 * passer sous `floorOmega` (borne ABS signée, 0 = aucune borne) tant que la roue tourne dans le sens du sol.
 */
function applyBrake(omega: number, deltaOmega: number, floorOmega: number): number {
  if (omega === 0 || deltaOmega <= 0) return omega;
  const sign = Math.sign(omega);
  let result = Math.max(0, Math.abs(omega) - deltaOmega);
  const floor = floorOmega * sign > 0 ? Math.abs(floorOmega) : 0;
  if (floor > 0) result = Math.max(result, Math.min(Math.abs(omega), floor));
  return result * sign;
}

/** One vehicle solver, shared by the game and the calibration measurements. */
export class VehicleSimulation {
  readonly config: VehicleConfig;
  readonly wheelPoses: WheelPose[];
  gear = 1;
  rpm: number;
  steeringRad = 0;
  private shiftRemainingS = 0;
  private directionWaitS = 0;
  private readonly rotation = new Quaternion();
  private readonly position = new Vector3();
  private readonly forward = new Vector3();
  private readonly down = new Vector3();
  private readonly normal = new Vector3();
  private readonly mount = new Vector3();
  private readonly point = new Vector3();
  private readonly tireForward = new Vector3();
  private readonly tireRight = new Vector3();
  private readonly contactVelocity = new Vector3();
  private readonly tireRotation = new Quaternion();
  private readonly steerRotation = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly impulses: Array<{ impulse: Vector3; point: Vector3 }>;
  private readonly drivenWheelCount: number;
  private readonly tireParams: TireForceParams;
  private readonly thermalParams: TireThermalParams;
  /** Vitesses de référence des dénominateurs du glissement longitudinal et de l'angle de dérive (m/s), calculées au premier pas. */
  /** Accélération longitudinale lissée de la caisse (m/s²) : sert à prédire sa vitesse au pas suivant dans l'intégration des roues. */
  private longitudinalAccelMps2 = 0;
  private previousLongitudinalSpeedMps = 0;
  private slipReferenceSpeedMps = 0;
  private slipAngleReferenceSpeedMps = 0;
  private ray: InstanceType<RapierContext['rapier']['Ray']> | null = null;

  constructor(config: VehicleConfig) {
    this.config = config;
    this.rpm = config.idleRpm;
    this.drivenWheelCount = config.wheelMounts.filter((wheel) => wheel.driven).length;
    this.wheelPoses = config.wheelMounts.map(({ xM, zM }) => ({
      xM, zM, suspensionM: config.suspensionRestLengthM, steeringRad: 0, spinRad: 0, omegaRadPerS: 0,
      temperatureC: config.ambientTemperatureC, carcassTemperatureC: config.ambientTemperatureC,
      grounded: false, slidingPowerW: 0, contactX: 0, contactY: 0, contactZ: 0,
    }));
    this.impulses = config.wheelMounts.map(() => ({ impulse: new Vector3(), point: new Vector3() }));
    const staticLoadN = staticWheelLoadN(config.massKg);
    this.tireParams = {
      baseGrip: config.tireGrip,
      peakSlipRatio: config.tirePeakSlipRatio,
      peakSlipAngleRad: config.tirePeakSlipAngleRad,
      slidingRatio: config.tireSlidingGripRatio,
      loadSensitivity: config.tireLoadSensitivity,
      referenceLoadN: staticLoadN,
    };
    this.thermalParams = thermalParamsFor(staticLoadN);
  }

  reset() {
    this.gear = 1;
    this.rpm = this.config.idleRpm;
    this.steeringRad = 0;
    this.shiftRemainingS = 0;
    this.directionWaitS = 0;
    this.longitudinalAccelMps2 = 0;
    this.previousLongitudinalSpeedMps = 0;
    for (const pose of this.wheelPoses) {
      pose.suspensionM = this.config.suspensionRestLengthM;
      pose.steeringRad = 0;
      pose.spinRad = 0;
      pose.omegaRadPerS = 0;
      pose.temperatureC = this.config.ambientTemperatureC;
      pose.carcassTemperatureC = this.config.ambientTemperatureC;
      pose.grounded = false;
      pose.slidingPowerW = 0;
    }
  }

  step(world: RapierContext['world'], rapier: RapierContext['rapier'], body: RapierRigidBody, input: VehicleInput): VehicleTelemetry {
    const c = this.config;
    const dt = world.timestep;
    if (this.slipReferenceSpeedMps === 0) {
      const { tireGrip, tireSlidingGripRatio, tirePeakSlipRatio, tirePeakSlipAngleRad } = this.config;
      this.slipReferenceSpeedMps = Math.max(MIN_SLIP_REFERENCE_SPEED_MPS, stableReferenceSpeedMps(dt, tireGrip, tireSlidingGripRatio, tirePeakSlipRatio));
      this.slipAngleReferenceSpeedMps = Math.max(MIN_SLIP_REFERENCE_SPEED_MPS, stableReferenceSpeedMps(dt, tireGrip, tireSlidingGripRatio, tirePeakSlipAngleRad));
    }
    const rotation = body.rotation();
    this.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.position.copy(body.translation());
    this.forward.set(0, 0, 1).applyQuaternion(this.rotation);
    this.down.set(0, -1, 0).applyQuaternion(this.rotation);
    this.ray ??= new rapier.Ray(this.mount, this.down);
    const velocity = body.linvel();
    const longitudinalSpeed = this.forward.dot(velocity);
    // Accélération de la caisse sur le dernier pas (lissée, bornée) : la roue doit suivre la vitesse du sol AU PROCHAIN pas,
    // sinon une roue libre retarde toujours d'un pas (κ ≈ -a·dt/vref) et la raideur du pneu en fait une traînée parasite.
    const rawAccel = (longitudinalSpeed - this.previousLongitudinalSpeedMps) / dt;
    this.longitudinalAccelMps2 += (clamp(rawAccel, -30, 30) - this.longitudinalAccelMps2) * 0.5;
    this.previousLongitudinalSpeedMps = longitudinalSpeed;
    const speedMps = Math.hypot(velocity.x, velocity.z);
    const throttle = clamp(input.throttle, 0, 1);
    const brake = clamp(input.brake, 0, 1);
    const handbrake = clamp(input.handbrake, 0, 1);
    const reverse = this.gear < 0;
    const changeRequested = reverse ? throttle > 0 && brake === 0 : brake > 0 && throttle === 0;
    this.directionWaitS = changeRequested && Math.abs(longitudinalSpeed) < c.directionChangeSpeedMps
      ? this.directionWaitS + dt : 0;
    if (this.directionWaitS >= c.directionChangeDelayS) {
      this.gear = reverse ? 1 : -1;
      this.shiftRemainingS = 0;
      this.directionWaitS = 0;
    }
    const direction = this.gear < 0 ? -1 : 1;
    const driveInput = direction < 0 ? brake : throttle;
    const brakeInput = throttle > 0 && brake > 0 ? Math.max(throttle, brake) : direction < 0 ? throttle : brake;
    // Opposite-direction input is a brake until the car has stopped.
    const driveAllowed = brakeInput === 0 && longitudinalSpeed * direction >= -c.directionChangeSpeedMps;
    const ratioFor = () => this.gear < 0 ? c.reverseGearRatio : c.gearRatios[this.gear - 1];
    // Régime « boîte » déduit de la vitesse du véhicule : sert aux décisions de changement de rapport (comme un calculateur
    // qui lit la vitesse du véhicule, insensible au patinage d'une roue).
    const speedRpmFor = (ratio: number) => Math.abs(longitudinalSpeed) / c.wheelRadiusM * ratio * c.finalDriveRatio * 60 / (2 * Math.PI);
    this.shiftRemainingS = Math.max(0, this.shiftRemainingS - dt);
    const speedRpm = speedRpmFor(ratioFor());
    if (this.gear > 0 && this.shiftRemainingS === 0) {
      if (speedRpm > c.upshiftRpm && this.gear < c.gearRatios.length) {
        this.gear += 1;
        this.shiftRemainingS = c.shiftDurationS;
      } else if (speedRpm < c.downshiftRpm && this.gear > 1) {
        // Do not downshift into the upshift threshold (gear hunting).
        if (speedRpmFor(c.gearRatios[this.gear - 2]) < c.upshiftRpm * 0.9) {
          this.gear -= 1;
          this.shiftRemainingS = c.shiftDurationS;
        }
      }
    }
    const ratio = ratioFor();
    const overallRatio = ratio * c.finalDriveRatio;

    // Le moteur tourne à la vitesse des roues motrices (embrayage fermé) : une roue qui patine emballe donc le moteur.
    // Au lancement, l'embrayage patine : le moteur est maintenu à un régime de décollage plutôt que de calar.
    let drivenOmegaSum = 0;
    for (let i = 0; i < c.wheelMounts.length; i += 1) if (c.wheelMounts[i].driven) drivenOmegaSum += Math.abs(this.wheelPoses[i].omegaRadPerS);
    const wheelCoupledRpm = (drivenOmegaSum / Math.max(1, this.drivenWheelCount)) * overallRatio * 60 / (2 * Math.PI);
    const targetRpm = clamp(Math.max(wheelCoupledRpm, c.idleRpm + driveInput * (c.launchRpm - c.idleRpm)), c.idleRpm, c.maximumRpm);
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-c.engineResponsePerS * dt));
    const torque = interpolateTorqueNm(this.rpm, c.torqueCurve);
    // Le limiteur de marche arrière regarde la plus grande des vitesses (véhicule, surface des roues motrices) : les roues
    // et le moteur emmagasinent de l'énergie de rotation qui dépasserait sinon la limite quand le couple est coupé.
    const drivenSurfaceSpeed = (drivenOmegaSum / Math.max(1, this.drivenWheelCount)) * c.wheelRadiusM;
    const reverseLimiter = direction < 0 ? clamp((c.maximumReverseSpeedMps - Math.max(Math.abs(longitudinalSpeed), drivenSurfaceSpeed))
      / (c.maximumReverseSpeedMps * 0.35), 0, 1) : 1;
    const clutchEngaged = this.shiftRemainingS === 0;
    // Couple moteur ramené aux roues, réparti à parts égales entre les roues motrices (différentiel ouvert).
    const driveWheelTorqueNm = driveAllowed && clutchEngaged && wheelCoupledRpm < c.maximumRpm
      ? torque * overallRatio * c.drivetrainEfficiency * driveInput * direction * reverseLimiter : 0;
    const engineBrakeWheelTorqueNm = c.engineBrakeTorqueNm * overallRatio * (1 - driveInput);
    // Inertie du moteur ramenée à chaque roue motrice (embrayage fermé) : c'est elle qui limite la vitesse de montée en régime.
    const reflectedEngineInertia = clutchEngaged ? c.engineInertiaKgM2 * overallRatio * overallRatio / Math.max(1, this.drivenWheelCount) : 0;

    // Un volant réel n'est pas mécaniquement bridé par la vitesse : seule l'assistance
    // s'allège. La limite de grip vient déjà du modèle de pneu (angle de dérive et
    // ellipse de friction ci-dessous) ; brider l'angle lui-même ici empêchait de tourner
    // normalement sur route alors qu'une C3 réelle le permet sans effort à 80 km/h.
    const maxSteer = c.maxSteeringRad / (1 + speedMps * c.steeringReductionPerMps);
    this.steeringRad = moveTowards(this.steeringRad, clamp(input.steering, -1, 1) * maxSteer, c.steeringRateRadPerS * dt);
    this.steerRotation.setFromAxisAngle(this.up, -this.steeringRad);
    let groundedWheels = 0;
    let maximumNormalizedSlip = 0;
    const wheelMassKg = c.massKg / c.wheelMounts.length;
    const wheelRadiusM = c.wheelRadiusM;

    // Sample every contact before applying any impulse: no dependence on wheel order.
    for (let index = 0; index < c.wheelMounts.length; index += 1) {
      const wheel = c.wheelMounts[index];
      const pose = this.wheelPoses[index];
      const pending = this.impulses[index];
      pending.impulse.set(0, 0, 0);
      pose.steeringRad = wheel.front ? -this.steeringRad : 0;
      const gripFactor = temperatureGripFactor(pose.temperatureC, c.tireOptimalTemperatureC, c.tireTemperatureFalloffC, c.tireMinGripMultiplier);

      this.mount.set(wheel.xM, -0.08, wheel.zM).applyQuaternion(this.rotation).add(this.position);
      this.ray.origin.x = this.mount.x;
      this.ray.origin.y = this.mount.y;
      this.ray.origin.z = this.mount.z;
      this.ray.dir.x = this.down.x;
      this.ray.dir.y = this.down.y;
      this.ray.dir.z = this.down.z;
      const hit = world.castRayAndGetNormal(this.ray,
        c.suspensionRestLengthM + c.suspensionTravelM + wheelRadiusM, true,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, body);
      pose.suspensionM = c.suspensionRestLengthM + c.suspensionTravelM;

      // Couples appliqués à la roue (hors frein), positifs dans le sens de roulement vers l'avant.
      const drivenShare = wheel.driven ? 1 / Math.max(1, this.drivenWheelCount) : 0;
      const wheelTorqueNm = driveWheelTorqueNm * drivenShare
        - clamp(pose.omegaRadPerS / SIGN_SMOOTHING_RADPS, -1, 1) * engineBrakeWheelTorqueNm * drivenShare;
      const wheelInertia = c.wheelInertiaKgM2 + (wheel.driven ? reflectedEngineInertia : 0);
      const brakeShare = wheel.front ? c.frontBrakeBias / 2 : (1 - c.frontBrakeBias) / 2;
      const serviceBrakeTorqueNm = brakeInput * c.serviceBrakeForceN * brakeShare * wheelRadiusM;
      const handbrakeTorqueNm = !wheel.front ? handbrake * c.handbrakeForceN / 2 * wheelRadiusM : 0;

      let inContact = false;
      let slidingPowerW = 0;
      let hysteresisPowerW = 0;

      // Vertical walls cannot act as suspension support.
      const supported = hit && this.normal.copy(hit.normal).dot(this.down) <= -0.35;
      if (hit && supported) {
        this.point.copy(this.mount).addScaledVector(this.down, hit.timeOfImpact);
        this.contactVelocity.copy(body.velocityAtPoint(this.point));
        const groundBody = hit.collider.parent();
        if (groundBody) this.contactVelocity.sub(groundBody.velocityAtPoint(this.point));
        const length = Math.max(c.minimumSuspensionLengthM, hit.timeOfImpact - wheelRadiusM);
        pose.suspensionM = Math.min(c.suspensionRestLengthM + c.suspensionTravelM, length);
        const load = calculateSuspensionForceN(length, c.suspensionRestLengthM, c.springRateNPerM,
          c.damperNsPerM, -this.contactVelocity.dot(this.normal) / Math.max(0.35, -this.normal.dot(this.down)), c.maximumSuspensionForceN);
        if (load > 0) {
          inContact = true;
          groundedWheels += 1;
          pending.point.copy(this.point);
          // Support follows the surface normal, not chassis tilt: a pitched body
          // must not turn its spring support into extra propulsion.
          pending.impulse.copy(this.normal).multiplyScalar(load * dt);
          this.tireRotation.copy(this.rotation);
          if (wheel.front) this.tireRotation.multiply(this.steerRotation);
          this.tireForward.set(0, 0, 1).applyQuaternion(this.tireRotation);
          this.tireForward.addScaledVector(this.normal, -this.tireForward.dot(this.normal)).normalize();
          this.tireRight.crossVectors(this.normal, this.tireForward).normalize();
          const vLong = this.contactVelocity.dot(this.tireForward);
          const vLat = this.contactVelocity.dot(this.tireRight);

          const slipDenominator = Math.max(Math.abs(vLong), this.slipReferenceSpeedMps);
          const kappa = (pose.omegaRadPerS * wheelRadiusM - vLong) / slipDenominator;
          const alpha = Math.atan2(vLat, Math.max(this.slipAngleReferenceSpeedMps, Math.abs(vLong)));
          const force = tireForce(this.tireParams, kappa, alpha, load, gripFactor);
          // Latéral : à très basse vitesse la dérive n'est pas définie, on amortit la vitesse transversale (stationnement).
          const blend = clamp(Math.abs(vLong) / 3, 0, 1);
          let lateralN = blend * force.fyN - (1 - blend) * vLat * c.lowSpeedTireDampingNsPerM;
          // Ellipse d'adhérence : la force latérale ne dépasse jamais ce que la force longitudinale laisse au pneu.
          const lateralBudget = Math.sqrt(Math.max(0, force.peakN * force.peakN - force.fxN * force.fxN));
          lateralN = clamp(lateralN, -lateralBudget, lateralBudget);
          // Pas de retournement de la vitesse transversale en un pas.
          lateralN = clamp(lateralN, -Math.abs(vLat) * wheelMassKg / dt, Math.abs(vLat) * wheelMassKg / dt);

          // Résistance au roulement (hystérésis du pneu) : s'oppose au mouvement, bornée pour ne pas inverser la vitesse.
          const rollingN = -clamp(vLong / SIGN_SMOOTHING_MPS, -1, 1) * load * c.rollingResistanceCoefficient;
          let longitudinalN = force.fxN;
          // Une force qui freine la voiture ne doit pas la faire repartir en arrière dans le même pas (sauf si le moteur
          // pousse dans le sens opposé à une vitesse parasite : on ne bride jamais un démarrage).
          const driving = wheel.driven && driveWheelTorqueNm * longitudinalN > 0;
          if (!driving && longitudinalN * vLong < 0) {
            const retardingLimit = Math.abs(vLong) * wheelMassKg / dt;
            longitudinalN = clamp(longitudinalN, -retardingLimit, retardingLimit);
          }

          // Roue : I·dω/dt = couple moteur − R·Fx, intégré de façon implicite avec la raideur SÉCANTE Fx/κ (toujours
          // positive, contrairement à la pente tangente nulle ou négative au-delà du pic qui rendrait le schéma explicite
          // et instable). La roue relaxe ainsi de façon monotone vers le roulement sans glissement, même à très basse vitesse
          // où R²·raideur/(I·vref) est très grand devant 1. Fx est la force réellement appliquée à la caisse.
          const stiffness = Math.abs(longitudinalN) / Math.max(Math.abs(kappa), 1e-4);
          const implicitDenominator = wheelInertia + dt * wheelRadiusM * wheelRadiusM * stiffness / slipDenominator;
          // Terme de prédiction : la vitesse du sol au prochain pas est vLong + a·dt, donc κ_nouveau = (ω_n·R − vLong − a·dt)/vref.
          const groundCatchUpN = stiffness * this.longitudinalAccelMps2 * dt / slipDenominator;
          let omegaFree = pose.omegaRadPerS + dt * (wheelTorqueNm - wheelRadiusM * (longitudinalN - groundCatchUpN)) / implicitDenominator;

          // Freins. Frein de service avec ABS prédictif : on borne la vitesse de roue de sorte que le taux de glissement
          // reste au-dessus de -ABS_SLIP_LIMIT × le glissement au pic (sans cela, en un pas de 1/60 s le couple de frein
          // arrête une roue de 1,1 kg·m² — la boucle de régulation d'un ABS réel est bien plus rapide que le pas physique).
          // Le frein à main n'a pas d'ABS : il bloque les roues arrière.
          omegaFree = applyBrake(omegaFree, dt * serviceBrakeTorqueNm / wheelInertia,
            Math.max(0, Math.abs(vLong) - ABS_SLIP_LIMIT * this.tireParams.peakSlipRatio * slipDenominator) / wheelRadiusM * Math.sign(vLong));
          omegaFree = applyBrake(omegaFree, dt * handbrakeTorqueNm / wheelInertia, 0);
          pose.omegaRadPerS = omegaFree;

          pending.impulse.addScaledVector(this.tireForward, (longitudinalN + rollingN) * dt)
            .addScaledVector(this.tireRight, lateralN * dt);
          // À très basse vitesse le glissement normalisé n'a pas de sens (arrêt, stationnement) : on ne le remonte pas.
          if (Math.abs(vLong) > 2) maximumNormalizedSlip = Math.max(maximumNormalizedSlip, force.normalizedSlip);
          // Chaleur : puissance de frottement au contact (force × vitesse de glissement) + hystérésis du roulement.
          const longitudinalSlipSpeed = pose.omegaRadPerS * wheelRadiusM - vLong;
          slidingPowerW = Math.abs(longitudinalN * longitudinalSlipSpeed) + Math.abs(lateralN * vLat);
          hysteresisPowerW = Math.abs(rollingN * vLong);
        }
      }

      if (!inContact) {
        // Roue en l'air (ou sans charge) : elle tourne librement sous le couple moteur et le frein.
        const freeOmega = pose.omegaRadPerS + dt * wheelTorqueNm / wheelInertia;
        pose.omegaRadPerS = applyBrake(freeOmega, dt * (serviceBrakeTorqueNm + handbrakeTorqueNm) / wheelInertia, 0);
      }

      pose.spinRad -= pose.omegaRadPerS * dt;
      const thermal = stepTireThermal(
        { surfaceC: pose.temperatureC, carcassC: pose.carcassTemperatureC },
        { slidingPowerW, hysteresisPowerW, speedMps, ambientC: c.ambientTemperatureC },
        this.thermalParams, dt,
      );
      pose.temperatureC = thermal.surfaceC;
      pose.carcassTemperatureC = thermal.carcassC;
      pose.grounded = inContact;
      pose.slidingPowerW = inContact ? slidingPowerW : 0;
      if (inContact) { pose.contactX = this.point.x; pose.contactY = this.point.y; pose.contactZ = this.point.z; }
    }
    for (const pending of this.impulses) {
      if (pending.impulse.lengthSq() > 0) body.applyImpulseAtPoint(pending.impulse, pending.point, true);
    }
    // Air drag at the centre of mass does not require wheel contact.
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const dragScale = -0.5 * 1.225 * c.aerodynamicDragCoefficient * c.frontalAreaM2 * horizontalSpeed * dt;
    body.applyImpulse({ x: velocity.x * dragScale, y: 0, z: velocity.z * dragScale }, true);
    return { speedMps, engineRpm: this.rpm, gear: this.gear,
      slip: maximumNormalizedSlip, groundedWheels,
      throttle: driveAllowed ? driveInput : 0, brake: brakeInput, steering: this.steeringRad / c.maxSteeringRad,
      tireTemperaturesC: this.wheelPoses.map((pose) => pose.temperatureC),
      positionM: { xM: this.position.x, zM: this.position.z },
      headingRad: Math.atan2(this.forward.x, this.forward.z) };
  }
}
