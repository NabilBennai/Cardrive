import { useEffect, useRef } from 'react';
import type { VehicleInput } from '../shared/types';

const emptyInput = (): VehicleInput => ({ throttle: 0, brake: 0, steering: 0, handbrake: 0 });

/**
 * Équivalent tactile de useDrivingInput.ts : même forme de retour (inputRef consommé par
 * GenericCar/VehicleSimulation à chaque pas physique) mais piloté par TouchControls.tsx
 * (joystick + bouton frein à main) au lieu du clavier. Les deux hooks sont indépendants et
 * App.tsx choisit lequel brancher selon la détection tactile — pas de fusion des deux sources,
 * elles sont mutuellement exclusives en pratique (un appareil a un clavier ou un écran tactile).
 */
export function useTouchDrivingInput(active: boolean, paused: boolean) {
  const inputRef = useRef<VehicleInput>(emptyInput());

  useEffect(() => {
    if (!active || paused) inputRef.current = emptyInput();
  }, [active, paused]);

  const setStick = (steering: number, verticalAxis: number) => {
    if (!active || paused) return;
    inputRef.current = {
      ...inputRef.current,
      steering,
      throttle: verticalAxis > 0 ? verticalAxis : 0,
      brake: verticalAxis < 0 ? -verticalAxis : 0,
    };
  };

  const setHandbrake = (engaged: boolean) => {
    if (!active || paused) return;
    inputRef.current = { ...inputRef.current, handbrake: engaged ? 1 : 0 };
  };

  return { inputRef, setStick, setHandbrake };
}
