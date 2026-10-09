import type { RapierContext, RapierRigidBody } from '@react-three/rapier';
import { Quaternion, Vector3 } from 'three';
import type { VehicleConfig, VehicleInput, VehicleTelemetry } from '../../shared/types.ts';
import { calculateSuspensionForceN, interpolateTorqueNm } from './vehicleMath.ts';

export interface WheelPose {
  xM: number;
  zM: number;
  suspensionM: number;
  steeringRad: number;
  spinRad: number;
}

const clamp = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));
const moveTowards = (value: number, target: number, amount: number) => value + clamp(target - value, -amount, amount);

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
  private ray: InstanceType<RapierContext['rapier']['Ray']> | null = null;

  constructor(config: VehicleConfig) {
    this.config = config;
    this.rpm = config.idleRpm;
    this.drivenWheelCount = config.wheelMounts.filter((wheel) => wheel.driven).length;
    this.wheelPoses = config.wheelMounts.map(({ xM, zM }) => ({
      xM, zM, suspensionM: config.suspensionRestLengthM, steeringRad: 0, spinRad: 0,
    }));
    this.impulses = config.wheelMounts.map(() => ({ impulse: new Vector3(), point: new Vector3() }));
  }

  reset() {
    this.gear = 1;
    this.rpm = this.config.idleRpm;
    this.steeringRad = 0;
    this.shiftRemainingS = 0;
    this.directionWaitS = 0;
    for (const pose of this.wheelPoses) {
      pose.suspensionM = this.config.suspensionRestLengthM;
      pose.steeringRad = 0;
      pose.spinRad = 0;
    }
  }

  step(world: RapierContext['world'], rapier: RapierContext['rapier'], body: RapierRigidBody, input: VehicleInput): VehicleTelemetry {
    const c = this.config;
    const dt = world.timestep;
    const rotation = body.rotation();
    this.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.position.copy(body.translation());
    this.forward.set(0, 0, 1).applyQuaternion(this.rotation);
    this.down.set(0, -1, 0).applyQuaternion(this.rotation);
    this.ray ??= new rapier.Ray(this.mount, this.down);
    const velocity = body.linvel();
    const longitudinalSpeed = this.forward.dot(velocity);
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
    const coupledRpmFor = (ratio: number) => Math.abs(longitudinalSpeed) / c.wheelRadiusM * ratio * c.finalDriveRatio * 60 / (2 * Math.PI);
    this.shiftRemainingS = Math.max(0, this.shiftRemainingS - dt);
    const coupledRpm = coupledRpmFor(ratioFor());
    if (this.gear > 0 && this.shiftRemainingS === 0) {
      if (coupledRpm > c.upshiftRpm && this.gear < c.gearRatios.length) {
        this.gear += 1;
        this.shiftRemainingS = c.shiftDurationS;
      } else if (coupledRpm < c.downshiftRpm && this.gear > 1) {
        // Do not downshift into the upshift threshold (gear hunting).
        if (coupledRpmFor(c.gearRatios[this.gear - 2]) < c.upshiftRpm * 0.9) {
          this.gear -= 1;
          this.shiftRemainingS = c.shiftDurationS;
        }
      }
    }
    const ratio = ratioFor();
    const targetRpm = clamp(Math.max(coupledRpmFor(ratio), c.idleRpm + driveInput * (c.launchRpm - c.idleRpm)), c.idleRpm, c.maximumRpm);
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-c.engineResponsePerS * dt));
    const torque = interpolateTorqueNm(this.rpm, c.torqueCurve);
    const reverseLimiter = direction < 0 ? clamp((c.maximumReverseSpeedMps - Math.abs(longitudinalSpeed))
      / (c.maximumReverseSpeedMps * 0.2), 0, 1) : 1;
    const driveForce = driveAllowed && this.shiftRemainingS === 0 && coupledRpmFor(ratio) < c.maximumRpm
      ? torque * ratio * c.finalDriveRatio * c.drivetrainEfficiency / c.wheelRadiusM * driveInput * direction * reverseLimiter : 0;
    const engineBrake = c.engineBrakeTorqueNm * ratio * c.finalDriveRatio / c.wheelRadiusM * (1 - driveInput);
    // Un volant réel n'est pas mécaniquement bridé par la vitesse : seule l'assistance
    // s'allège. La limite de grip vient déjà du modèle de pneu (angle de dérive et
    // ellipse de friction ci-dessous) ; brider l'angle lui-même ici empêchait de tourner
    // normalement sur route alors qu'une C3 réelle le permet sans effort à 80 km/h.
    const maxSteer = c.maxSteeringRad / (1 + speedMps * c.steeringReductionPerMps);
    this.steeringRad = moveTowards(this.steeringRad, clamp(input.steering, -1, 1) * maxSteer, c.steeringRateRadPerS * dt);
    this.steerRotation.setFromAxisAngle(this.up, -this.steeringRad);
    let groundedWheels = 0;
    let slip = 0;

    // Sample every contact before applying any impulse: no dependence on wheel order.
    for (let index = 0; index < c.wheelMounts.length; index += 1) {
      const wheel = c.wheelMounts[index];
      const pose = this.wheelPoses[index];
      const pending = this.impulses[index];
      pending.impulse.set(0, 0, 0);
      pose.steeringRad = wheel.front ? -this.steeringRad : 0;
      this.mount.set(wheel.xM, -0.08, wheel.zM).applyQuaternion(this.rotation).add(this.position);
      this.ray.origin.x = this.mount.x;
      this.ray.origin.y = this.mount.y;
      this.ray.origin.z = this.mount.z;
      this.ray.dir.x = this.down.x;
      this.ray.dir.y = this.down.y;
      this.ray.dir.z = this.down.z;
      const hit = world.castRayAndGetNormal(this.ray,
        c.suspensionRestLengthM + c.suspensionTravelM + c.wheelRadiusM, true,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, body);
      pose.suspensionM = c.suspensionRestLengthM + c.suspensionTravelM;
      // Vertical walls cannot act as suspension support.
      if (!hit || this.normal.copy(hit.normal).dot(this.down) > -0.35) continue;
      this.point.copy(this.mount).addScaledVector(this.down, hit.timeOfImpact);
      this.contactVelocity.copy(body.velocityAtPoint(this.point));
      const groundBody = hit.collider.parent();
      if (groundBody) this.contactVelocity.sub(groundBody.velocityAtPoint(this.point));
      const length = Math.max(c.minimumSuspensionLengthM, hit.timeOfImpact - c.wheelRadiusM);
      pose.suspensionM = Math.min(c.suspensionRestLengthM + c.suspensionTravelM, length);
      const load = calculateSuspensionForceN(length, c.suspensionRestLengthM, c.springRateNPerM,
        c.damperNsPerM, -this.contactVelocity.dot(this.normal) / Math.max(0.35, -this.normal.dot(this.down)), c.maximumSuspensionForceN);
      if (load <= 0) continue;
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
      const angle = Math.atan2(vLat, Math.max(2, Math.abs(vLong)));
      const blend = clamp(Math.abs(vLong) / 3, 0, 1);
      const desiredLateral = -(1 - blend) * vLat * c.lowSpeedTireDampingNsPerM - blend * load * c.tireCorneringStiffnessPerRad * angle;
      const wheelMass = c.massKg / c.wheelMounts.length;
      const lateral = clamp(desiredLateral, -Math.abs(vLat) * wheelMass / dt, Math.abs(vLat) * wheelMass / dt);
      const brakeShare = wheel.front ? c.frontBrakeBias / 2 : (1 - c.frontBrakeBias) / 2;
      const resistance = load * c.rollingResistanceCoefficient
        + brakeInput * c.serviceBrakeForceN * brakeShare
        + (!wheel.front ? handbrake * c.handbrakeForceN / 2 : 0)
        + (wheel.driven ? engineBrake / this.drivenWheelCount : 0);
      // Never brake through zero within one step, including at parking speeds.
      const stoppingForce = -Math.sign(vLong) * Math.min(resistance, Math.abs(vLong) * wheelMass / dt);
      const longitudinal = (wheel.driven ? driveForce / this.drivenWheelCount : 0) + stoppingForce;
      const grip = c.tireGrip * (!wheel.front ? 1 - handbrake * (1 - c.handbrakeRearGripFactor) : 1);
      const utilization = Math.hypot(lateral, longitudinal) / Math.max(1, load * grip);
      const scale = 1 / Math.max(1, utilization);
      pending.impulse.addScaledVector(this.tireForward, longitudinal * scale * dt)
        .addScaledVector(this.tireRight, lateral * scale * dt);
      pose.spinRad -= vLong * dt / c.wheelRadiusM;
      slip += Math.max(Math.abs(angle), Math.max(0, utilization - 1));
    }
    for (const pending of this.impulses) {
      if (pending.impulse.lengthSq() > 0) body.applyImpulseAtPoint(pending.impulse, pending.point, true);
    }
    // Air drag at the centre of mass does not require wheel contact.
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const dragScale = -0.5 * 1.225 * c.aerodynamicDragCoefficient * c.frontalAreaM2 * horizontalSpeed * dt;
    body.applyImpulse({ x: velocity.x * dragScale, y: 0, z: velocity.z * dragScale }, true);
    return { speedMps, engineRpm: this.rpm, gear: this.gear,
      slip: groundedWheels ? slip / groundedWheels : 0, groundedWheels,
      throttle: driveAllowed ? driveInput : 0, brake: brakeInput, steering: this.steeringRad / c.maxSteeringRad };
  }
}
