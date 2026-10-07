import { useFrame, useThree } from '@react-three/fiber';
import { useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useMemo, useRef } from 'react';
import { Quaternion, Vector3 } from 'three';

interface ChaseCameraProps {
  bodyRef: React.RefObject<RapierRigidBody | null>;
  snapVersion: number;
}

export function ChaseCamera({ bodyRef, snapVersion }: ChaseCameraProps) {
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const forward = useMemo(() => new Vector3(), []);
  const desired = useMemo(() => new Vector3(), []);
  const safePosition = useMemo(() => new Vector3(), []);
  const cameraDirection = useMemo(() => new Vector3(), []);
  const lookTarget = useMemo(() => new Vector3(), []);
  const orientation = useMemo(() => new Quaternion(), []);
  const cameraRayRef = useRef(new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }));
  const lastSnap = useRef(snapVersion);

  useFrame((_, delta) => {
    const rigidBody = bodyRef.current;
    if (!rigidBody) return;
    const position = rigidBody.translation();
    const rotation = rigidBody.rotation();
    orientation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    forward.set(0, 0, 1).applyQuaternion(orientation).normalize();
    desired.set(position.x, position.y + 3.5, position.z).addScaledVector(forward, -7.8);
    lookTarget.set(position.x, position.y + 0.58, position.z).addScaledVector(forward, 2.4);
    cameraDirection.copy(desired).sub(lookTarget);
    const desiredDistance = cameraDirection.length();
    cameraDirection.normalize();
    const cameraRay = cameraRayRef.current;
    cameraRay.origin.x = lookTarget.x;
    cameraRay.origin.y = lookTarget.y;
    cameraRay.origin.z = lookTarget.z;
    cameraRay.dir.x = cameraDirection.x;
    cameraRay.dir.y = cameraDirection.y;
    cameraRay.dir.z = cameraDirection.z;
    const obstruction = world.castRayAndGetNormal(
      cameraRay,
      desiredDistance,
      true,
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      rigidBody,
    );
    const safeDistance = obstruction ? Math.max(0.8, obstruction.timeOfImpact - 0.38) : desiredDistance;
    safePosition.copy(lookTarget).addScaledVector(cameraDirection, safeDistance);
    if (lastSnap.current !== snapVersion) {
      camera.position.copy(safePosition);
      lastSnap.current = snapVersion;
    } else {
      camera.position.lerp(safePosition, 1 - Math.exp(-3.8 * delta));
    }
    camera.lookAt(lookTarget);
  });

  return null;
}
