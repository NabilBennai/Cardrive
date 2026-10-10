import { useEffect, useRef } from 'react';
import type { CircuitTrack } from '../circuits/circuitGeometry';

const SIZE_PX = 168;
const PADDING_PX = 16;
const TRACK_COLOR = 'rgba(243, 245, 248, .92)';
const HALO_COLOR = 'rgba(8, 11, 15, .85)';
const ACCENT_COLOR = '#6cd2ff';

interface CircuitMinimapProps {
  track: CircuitTrack;
  positionM: { xM: number; zM: number };
  headingRad: number;
}

/**
 * Mini-carte hors ligne d'un circuit : le tracé seul (pas de fond OSM) et la position de la
 * voiture. Le repère est celui de la scène (x = est, z = sud) : le nord est donc en haut et
 * le cap se dessine comme dans Minimap.tsx (flèche pointant vers le bas à cap 0, tournée de -cap).
 */
export function CircuitMinimap({ track, positionM, headingRad }: CircuitMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== SIZE_PX * ratio) {
      canvas.width = SIZE_PX * ratio;
      canvas.height = SIZE_PX * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, SIZE_PX, SIZE_PX);

    const { minX, maxX, minZ, maxZ } = track.boundsM;
    const scale = (SIZE_PX - 2 * PADDING_PX) / (Math.max(maxX - minX, maxZ - minZ) || 1);
    const offsetX = (SIZE_PX - (maxX - minX) * scale) / 2;
    const offsetY = (SIZE_PX - (maxZ - minZ) * scale) / 2;
    const toX = (xM: number) => offsetX + (xM - minX) * scale;
    const toY = (zM: number) => offsetY + (zM - minZ) * scale;

    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();
    track.centerline.forEach((point, index) => {
      if (index === 0) context.moveTo(toX(point.xM), toY(point.zM));
      else context.lineTo(toX(point.xM), toY(point.zM));
    });
    context.closePath();
    context.strokeStyle = HALO_COLOR;
    context.lineWidth = 6;
    context.stroke();
    context.strokeStyle = TRACK_COLOR;
    context.lineWidth = 3;
    context.stroke();

    // Ligne de départ : un court trait perpendiculaire à la piste.
    const line = track.startLine;
    const nx = Math.cos(line.headingRad); const nz = -Math.sin(line.headingRad);
    context.beginPath();
    context.moveTo(toX(line.xM) - nx * 5, toY(line.zM) - nz * 5);
    context.lineTo(toX(line.xM) + nx * 5, toY(line.zM) + nz * 5);
    context.strokeStyle = ACCENT_COLOR;
    context.lineWidth = 2;
    context.stroke();

    context.save();
    context.translate(toX(positionM.xM), toY(positionM.zM));
    context.rotate(-headingRad);
    context.beginPath();
    context.moveTo(0, 8);
    context.lineTo(-5.5, -6);
    context.lineTo(0, -2.5);
    context.lineTo(5.5, -6);
    context.closePath();
    context.fillStyle = ACCENT_COLOR;
    context.strokeStyle = '#0b0e12';
    context.lineWidth = 1.5;
    context.fill();
    context.stroke();
    context.restore();
  }, [track, positionM.xM, positionM.zM, headingRad]);

  return <canvas ref={canvasRef} className="minimap-canvas" width={SIZE_PX} height={SIZE_PX} aria-label={`Position sur le circuit : ${track.name}`} />;
}
