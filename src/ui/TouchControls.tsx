import { useRef, useState } from 'react';
import { normalizeStick } from '../input/stickMath';

interface TouchControlsProps {
  setStick: (steering: number, verticalAxis: number) => void;
  setHandbrake: (engaged: boolean) => void;
}

const STICK_RADIUS_PX = 48;

/**
 * Contrôle type joystick unique pour mobile/tablette : axe horizontal = direction, axe
 * vertical = accélérateur (vers le haut) / frein (vers le bas), plus un bouton frein à main
 * séparé. Remplace le clavier sur les appareils tactiles (voir App.tsx, détection tactile).
 */
export function TouchControls({ setStick, setHandbrake }: TouchControlsProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });

  const updateFromPointer = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const { x, y, steering, verticalAxis } = normalizeStick(clientX - centerX, clientY - centerY, STICK_RADIUS_PX);
    setKnobOffset({ x, y });
    setStick(steering, verticalAxis);
  };

  const release = () => {
    pointerIdRef.current = null;
    setKnobOffset({ x: 0, y: 0 });
    setStick(0, 0);
  };

  return (
    <div className="touch-controls" aria-hidden="true">
      <div
        ref={baseRef}
        className="touch-stick-base"
        onPointerDown={(event) => {
          pointerIdRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (pointerIdRef.current !== event.pointerId) return;
          updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (pointerIdRef.current !== event.pointerId) return;
          release();
        }}
        onPointerCancel={release}
      >
        <div className="touch-stick-knob" style={{ transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)` }} />
      </div>
      <button
        className="touch-handbrake"
        onPointerDown={(event) => { event.preventDefault(); setHandbrake(true); }}
        onPointerUp={() => setHandbrake(false)}
        onPointerCancel={() => setHandbrake(false)}
        onPointerLeave={() => setHandbrake(false)}
      >
        Frein<br />à main
      </button>
    </div>
  );
}
