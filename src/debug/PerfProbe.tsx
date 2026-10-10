import { useFrame } from '@react-three/fiber';
import { useAfterPhysicsStep, useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { useRef } from 'react';
import { perfStats } from './perfStats';

/** Compteurs de scène relus toutes les N images : gl.info et les ensembles Rapier ne sont pas gratuits à interroger. */
const SCENE_SAMPLE_EVERY_FRAMES = 30;

/**
 * Sonde à monter dans le Canvas (aucun rendu) : alimente perfStats avec le temps d'image, la durée du pas physique et les
 * compteurs de scène. Son coût est négligeable (deux horloges et un tampon circulaire par image).
 */
export function PerfProbe() {
  const { world } = useRapier();
  const stepStartRef = useRef(0);
  const frameRef = useRef(0);

  useBeforePhysicsStep(() => { stepStartRef.current = performance.now(); });
  useAfterPhysicsStep(() => { perfStats.physicsStepMs.push(performance.now() - stepStartRef.current); });

  useFrame(({ gl }, delta) => {
    perfStats.frameMs.push(delta * 1000);
    frameRef.current += 1;
    if (frameRef.current % SCENE_SAMPLE_EVERY_FRAMES !== 0) return;
    perfStats.scene = {
      triangles: gl.info.render.triangles,
      drawCalls: gl.info.render.calls,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      colliders: world.colliders.len(),
      bodies: world.bodies.len(),
    };
  });

  return null;
}
