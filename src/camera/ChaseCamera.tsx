import { useFrame, useThree } from '@react-three/fiber';
import { useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useEffect, useMemo, useRef } from 'react';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { impactChannel, originShiftChannel } from '../feel/feelBus';
import { BASE_FOV_DEG, cameraShakeAmplitude, fovForSpeed, SHAKE_DECAY_S, smoothingFactor } from '../feel/feelMath';

interface ChaseCameraProps {
  bodyRef: React.RefObject<RapierRigidBody | null>;
  snapVersion: number;
  /** Tremblement et champ de vision variable. Toujours désactivés si le système demande de réduire les animations. */
  effects?: boolean;
}

const FOLLOW_RATE_PER_S = 3.8;
const FOV_RATE_PER_S = 2.5;
const FOV_EPSILON_DEG = 0.02;

/** Applique un champ de vision à la caméra perspective s'il a assez changé (la matrice de projection est recalculée). */
function applyFov(camera: object, fovDeg: number): void {
  const perspective = camera as PerspectiveCamera;
  if (Math.abs(perspective.fov - fovDeg) <= FOV_EPSILON_DEG) return;
  perspective.fov = fovDeg;
  perspective.updateProjectionMatrix();
}

const prefersReducedMotion = () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

export function ChaseCamera({ bodyRef, snapVersion, effects = true }: ChaseCameraProps) {
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const forward = useMemo(() => new Vector3(), []);
  const desired = useMemo(() => new Vector3(), []);
  const safePosition = useMemo(() => new Vector3(), []);
  const cameraDirection = useMemo(() => new Vector3(), []);
  const lookTarget = useMemo(() => new Vector3(), []);
  const orientation = useMemo(() => new Quaternion(), []);
  /** Position suivie, SANS tremblement : le tremblement s'ajoute à la sortie sans jamais se réinjecter dans le suivi. */
  const smoothed = useMemo(() => new Vector3(), []);
  const shakeOffset = useMemo(() => new Vector3(), []);
  const cameraRayRef = useRef(new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }));
  const lastSnap = useRef(snapVersion);
  const initialised = useRef(false);
  const shakeEnergy = useRef(0);
  const fov = useRef(BASE_FOV_DEG);
  const timeS = useRef(0);

  // Un choc secoue la caméra ; un décalage d'origine déplace la position suivie du même vecteur que le monde (elle garde son
  // retard naturel sur la voiture au lieu de « sauter » vers sa position idéale).
  useEffect(() => impactChannel.subscribe((event) => { shakeEnergy.current = Math.max(shakeEnergy.current, event.intensity); }), []);
  useEffect(() => originShiftChannel.subscribe((shift) => { smoothed.x -= shift.dx; smoothed.y -= shift.dy; smoothed.z -= shift.dz; }), [smoothed]);

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
    if (lastSnap.current !== snapVersion || !initialised.current) {
      smoothed.copy(safePosition);
      lastSnap.current = snapVersion;
      initialised.current = true;
    } else {
      smoothed.lerp(safePosition, smoothingFactor(FOLLOW_RATE_PER_S, delta));
    }
    camera.position.copy(smoothed);

    // Ressenti : tremblement (vibration à haute vitesse + choc qui s'éteint) et champ de vision qui s'ouvre avec la vitesse.
    const velocity = rigidBody.linvel();
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const enabled = effects && !prefersReducedMotion();
    shakeEnergy.current *= Math.exp(-delta / SHAKE_DECAY_S);
    timeS.current += delta;
    const amplitude = enabled ? cameraShakeAmplitude(speed, shakeEnergy.current) : 0;
    if (amplitude > 1e-4) {
      const t = timeS.current;
      // Somme de sinusoïdes incommensurables : un bruit lisse et non répétitif, sans générateur aléatoire.
      shakeOffset.set(
        Math.sin(t * 61.3) + 0.6 * Math.sin(t * 37.7 + 1.1),
        Math.sin(t * 53.9 + 2.3) + 0.6 * Math.sin(t * 29.1),
        Math.sin(t * 47.1 + 0.4) + 0.6 * Math.sin(t * 33.3 + 3.1),
      ).multiplyScalar(amplitude * 0.6);
      camera.position.add(shakeOffset);
    }
    const targetFov = fovForSpeed(speed, enabled);
    fov.current += (targetFov - fov.current) * smoothingFactor(FOV_RATE_PER_S, delta);
    applyFov(camera, fov.current);
    camera.lookAt(lookTarget);
  });

  return null;
}
