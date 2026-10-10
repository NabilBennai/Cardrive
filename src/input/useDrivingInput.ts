import { useEffect, useRef } from 'react';
import type { VehicleInput } from '../shared/types';

const emptyInput = (): VehicleInput => ({ throttle: 0, brake: 0, steering: 0, handbrake: 0 });

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function useDrivingInput(
  active: boolean,
  paused: boolean,
  gameFocus: React.RefObject<HTMLElement | null>,
  onPause: () => void,
  onRespawn: () => void,
) {
  const inputRef = useRef<VehicleInput>(emptyInput());
  const keyStates = useRef(new Set<string>());

  useEffect(() => {
    const clear = () => {
      keyStates.current.clear();
      inputRef.current = emptyInput();
    };

    if (!active || paused) {
      clear();
      return;
    }

    const sync = () => {
      const keys = keyStates.current;
      const forward = keys.has('KeyZ') || keys.has('KeyW') || keys.has('ArrowUp');
      const reverse = keys.has('KeyS') || keys.has('ArrowDown');
      inputRef.current = {
        throttle: forward ? 1 : 0,
        brake: reverse ? 1 : 0,
        steering: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyQ') || keys.has('KeyA') || keys.has('ArrowLeft')),
        handbrake: keys.has('Space') ? 1 : 0,
        shiftUp: keys.has('KeyE') || keys.has('PageUp'),
        shiftDown: keys.has('KeyC') || keys.has('PageDown'),
      };
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (document.activeElement !== gameFocus.current) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        onPause();
        return;
      }
      if (event.code === 'KeyR' && !event.repeat) {
        event.preventDefault();
        clear();
        onRespawn();
      }
      const drivingKeys = ['KeyZ', 'KeyW', 'KeyS', 'KeyQ', 'KeyA', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE', 'KeyC', 'PageUp', 'PageDown'];
      if (drivingKeys.includes(event.code)) {
        event.preventDefault();
        keyStates.current.add(event.code);
        sync();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keyStates.current.delete(event.code);
      sync();
    };

    const onBlur = () => clear();
    const onVisibility = () => {
      if (document.hidden) clear();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clear();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, gameFocus, onPause, onRespawn, paused]);

  return inputRef;
}
