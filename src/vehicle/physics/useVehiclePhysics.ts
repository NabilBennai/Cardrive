import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Quaternion, Vector3 } from 'three';
import type { VehicleInput, VehicleTelemetry } from '../../shared/types';
import { genericVehicle } from '../configs/genericVehicle';
import { calculateSuspensionForceN, interpolateTorqueNm, maximumLongitudinalForceN } from './vehicleMath';

const wheelRadiusM = genericVehicle.wheelRadiusM;
const restLengthM = genericVehicle.suspensionRestLengthM;
const maxTravelM = genericVehicle.suspensionTravelM;
const idleRpm = genericVehicle.idleRpm;
const redlineRpm = genericVehicle.maximumRpm;

export interface WheelPose {
  xM: number;
  zM: number;
  suspensionM: number;
  steeringRad: number;
  spinRad: number;
}

export interface VehiclePhysicsOptions {
  bodyRef: React.RefObject<import('@react-three/rapier').RapierRigidBody | null>;
  input: React.RefObject<VehicleInput>;
  telemetryRef: React.RefObject<VehicleTelemetry>;
  wheelPosesRef: React.RefObject<WheelPose[]>;
  respawnVersion: number;
  onTelemetry: (telemetry: VehicleTelemetry) => void;
}

const wheelMounts = genericVehicle.wheelMounts;
const drivenWheelCount = wheelMounts.filter((wheel) => wheel.driven).length;

export function useVehiclePhysics({ bodyRef, input, telemetryRef, wheelPosesRef, respawnVersion, onTelemetry }: VehiclePhysicsOptions) {
  const { rapier } = useRapier();
  const rotation = useMemo(() => new Quaternion(), []);
  const position = useMemo(() => new Vector3(), []);
  const up = useMemo(() => new Vector3(0, 1, 0), []);
  const forward = useMemo(() => new Vector3(), []);
  const right = useMemo(() => new Vector3(), []);
  const mount = useMemo(() => new Vector3(), []);
  const rayDown = useMemo(() => new Vector3(0, -1, 0), []);
  const springForce = useMemo(() => new Vector3(), []);
  const rayLengthM = restLengthM + maxTravelM + wheelRadiusM;
  const engineRef = useRef({ gear: 1, rpm: idleRpm, shiftDelay: 0, telemetryDelay: 0 });
  const telemetryCallback = useRef(onTelemetry);
  useLayoutEffect(() => {
    telemetryCallback.current = onTelemetry;
  }, [onTelemetry]);
  useLayoutEffect(() => {
    engineRef.current = { gear: 1, rpm: idleRpm, shiftDelay: 0, telemetryDelay: 0 };
  }, [respawnVersion]);

  useBeforePhysicsStep((rapierWorld) => {
    const rigidBody = bodyRef.current;
    if (!rigidBody) return;

    if (engineRef.current.shiftDelay > 0) engineRef.current.shiftDelay -= rapierWorld.timestep;
    const bodyRotation = rigidBody.rotation();
    rotation.set(bodyRotation.x, bodyRotation.y, bodyRotation.z, bodyRotation.w);
    const bodyPosition = rigidBody.translation();
    position.set(bodyPosition.x, bodyPosition.y, bodyPosition.z);
    rayDown.set(0, -1, 0).applyQuaternion(rotation).normalize();
    const velocity = rigidBody.linvel();
    const speedMps = Math.hypot(velocity.x, velocity.y, velocity.z);
    const baseForward = forward.set(0, 0, 1).applyQuaternion(rotation).normalize();
    const longitudinalSpeedMps = velocity.x * baseForward.x + velocity.z * baseForward.z;
    const reverseActive = input.current.brake > 0 && Math.abs(longitudinalSpeedMps) < 0.45;
    const controls = {
      throttle: input.current.throttle,
      brake: reverseActive ? 0 : input.current.brake,
      reverse: reverseActive ? input.current.brake : 0,
      steering: input.current.steering,
      handbrake: input.current.handbrake,
    };

    const engine = engineRef.current;
    if (reverseActive) engine.gear = -1;
    else if (engine.gear < 1) engine.gear = 1;

    const ratio = engine.gear < 0 ? -genericVehicle.reverseGearRatio : genericVehicle.gearRatios[engine.gear - 1] ?? 0.86;
    const coupledRpm = Math.abs(longitudinalSpeedMps) / wheelRadiusM * Math.abs(ratio) * genericVehicle.finalDriveRatio * 60 / (2 * Math.PI);
    engine.rpm = Math.max(idleRpm, Math.min(redlineRpm, coupledRpm + controls.throttle * 650));
    if (engine.gear > 0 && engine.shiftDelay <= 0 && engine.rpm > 5700 && engine.gear < genericVehicle.gearRatios.length) {
      engine.gear += 1;
      engine.shiftDelay = 0.32;
    } else if (engine.gear > 1 && engine.shiftDelay <= 0 && engine.rpm < 2200) {
      engine.gear -= 1;
      engine.shiftDelay = 0.26;
    }
    const engineTorqueNm = interpolateTorqueNm(engine.rpm, genericVehicle.torqueCurve);
    const driveForceN = ((engineTorqueNm * Math.abs(ratio) * genericVehicle.finalDriveRatio * 0.84) / wheelRadiusM)
      * (controls.throttle - controls.reverse);
    const steeringRad = controls.steering * genericVehicle.maxSteeringRad / (1 + speedMps * genericVehicle.steeringReductionPerMps);
    let groundedWheels = 0;
    let totalSlip = 0;

    for (let index = 0; index < wheelMounts.length; index += 1) {
      const wheel = wheelMounts[index];
      mount.set(wheel.xM, -0.08, wheel.zM).applyQuaternion(rotation).add(position);
      const ray = new rapier.Ray(mount, rayDown);
      const hit = rapierWorld.castRayAndGetNormal(
        ray,
        rayLengthM,
        true,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        rigidBody,
      );
      const wheelPose = wheelPosesRef.current[index];
      wheelPose.steeringRad = wheel.front ? steeringRad : 0;

      if (!hit) {
        wheelPose.suspensionM = restLengthM + maxTravelM;
        continue;
      }

      groundedWheels += 1;
      const suspensionM = Math.max(0.06, hit.timeOfImpact - wheelRadiusM);
      wheelPose.suspensionM = Math.min(restLengthM + maxTravelM, suspensionM);
      const contactPoint = mount.clone().addScaledVector(rayDown, hit.timeOfImpact);
      const pointVelocity = rigidBody.velocityAtPoint(contactPoint);
      const relativeDownSpeed = pointVelocity.x * rayDown.x + pointVelocity.y * rayDown.y + pointVelocity.z * rayDown.z;
      const normalForceN = calculateSuspensionForceN(
        suspensionM,
        restLengthM,
        genericVehicle.springRateNPerM,
        genericVehicle.damperNsPerM,
        relativeDownSpeed,
        19_000,
      );
      if (normalForceN > 0) {
        // Rapier user forces persist between steps. Apply J = F * dt so the
        // suspension acts for this step without accumulating a constant force.
        springForce.copy(rayDown).multiplyScalar(-normalForceN * rapierWorld.timestep);
        rigidBody.applyImpulseAtPoint(springForce, contactPoint, true);
      }

      const tireRotation = rotation.clone();
      if (wheel.front) tireRotation.multiply(new Quaternion().setFromAxisAngle(up, steeringRad));
      const tireForward = forward.set(0, 0, 1).applyQuaternion(tireRotation).normalize();
      const tireRight = right.set(1, 0, 0).applyQuaternion(tireRotation).normalize();
      const longitudinalSpeed = pointVelocity.x * tireForward.x + pointVelocity.y * tireForward.y + pointVelocity.z * tireForward.z;
      const lateralSpeed = pointVelocity.x * tireRight.x + pointVelocity.y * tireRight.y + pointVelocity.z * tireRight.z;
      const requestedLateralN = -lateralSpeed * genericVehicle.tireLateralStiffnessNsPerM;
      const brakeForceN = Math.abs(longitudinalSpeed) > 0.12
        ? -Math.sign(longitudinalSpeed) * (controls.brake * genericVehicle.serviceBrakeForceN + (controls.handbrake && !wheel.front ? genericVehicle.handbrakeForceN : 0))
        : 0;
      const wheelDriveForceN = wheel.driven ? driveForceN / drivenWheelCount : 0;
      const dragForceN = (42 * longitudinalSpeed
        + 0.5 * 1.225 * genericVehicle.aerodynamicDragCoefficient * genericVehicle.frontalAreaM2
        * longitudinalSpeed * Math.abs(longitudinalSpeed)) / wheelMounts.length;
      const requestedLongitudinalN = wheelDriveForceN + brakeForceN - dragForceN;
      const frictionLimitN = normalForceN * genericVehicle.tireGrip;
      const lateralForceN = Math.max(-frictionLimitN, Math.min(frictionLimitN, requestedLateralN));
      const remainingLongitudinalLimitN = maximumLongitudinalForceN(lateralForceN, frictionLimitN);
      const longitudinalForceN = Math.max(-remainingLongitudinalLimitN, Math.min(remainingLongitudinalLimitN, requestedLongitudinalN));

      const tireForce = new Vector3()
        .addScaledVector(tireForward, longitudinalForceN)
        .addScaledVector(tireRight, lateralForceN);
      tireForce.multiplyScalar(rapierWorld.timestep);
      rigidBody.applyImpulseAtPoint(tireForce, contactPoint, true);
      wheelPose.spinRad -= longitudinalSpeed * rapierWorld.timestep / wheelRadiusM;
      totalSlip += Math.abs(lateralSpeed) / (Math.abs(longitudinalSpeed) + 1.5);
    }

    const telemetry: VehicleTelemetry = {
      speedMps,
      engineRpm: engine.rpm,
      gear: engine.gear,
      slip: groundedWheels > 0 ? totalSlip / groundedWheels : 0,
      groundedWheels,
      throttle: controls.throttle + controls.reverse,
      brake: controls.brake,
      steering: controls.steering,
    };
    telemetryRef.current = telemetry;
    engine.telemetryDelay += rapierWorld.timestep;
    if (engine.telemetryDelay >= 0.1) {
      engine.telemetryDelay %= 0.1;
      telemetryCallback.current(telemetry);
    }
  });

  return { restLengthM, maxTravelM, wheelMounts };
}
