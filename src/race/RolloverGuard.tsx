import { useAfterPhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import { useMemo, useRef } from 'react';
import { VEHICLE_FIXED_STEP_S } from '../vehicle/physics/vehicleBody';
import { uprightness } from './bodyPose';
import { FlipDetector } from './flipDetector';

/** Durée (s) pendant laquelle la voiture reste retournée avant d'être remise en piste d'office (course seulement). */
const AUTO_RECOVER_AFTER_S = 4;

interface RolloverGuardProps {
  bodyRef: React.RefObject<RapierRigidBody | null>;
  /** Notifie l'interface quand l'état « retournée » change. */
  onFlippedChange: (flipped: boolean) => void;
  /** Course : remise en piste automatique après AUTO_RECOVER_AFTER_S ; sinon on se contente d'inviter à appuyer sur R. */
  onAutoRecover?: () => void;
}

/** Surveille le joueur : voiture retournée → message « R pour repositionner », et remise en piste d'office en course. */
export function RolloverGuard({ bodyRef, onFlippedChange, onAutoRecover }: RolloverGuardProps) {
  const detector = useMemo(() => new FlipDetector(), []);
  const flipped = useRef(false);
  const flippedS = useRef(0);

  useAfterPhysicsStep(() => {
    const body = bodyRef.current;
    if (!body) return;
    const velocity = body.linvel();
    const isFlipped = detector.update(uprightness(body.rotation()), Math.hypot(velocity.x, velocity.y, velocity.z), VEHICLE_FIXED_STEP_S);
    if (isFlipped !== flipped.current) {
      flipped.current = isFlipped;
      flippedS.current = 0;
      onFlippedChange(isFlipped);
    }
    if (isFlipped && onAutoRecover) {
      flippedS.current += VEHICLE_FIXED_STEP_S;
      if (flippedS.current >= AUTO_RECOVER_AFTER_S) {
        flippedS.current = 0;
        detector.reset();
        flipped.current = false;
        onFlippedChange(false);
        onAutoRecover();
      }
    }
  });

  return null;
}
