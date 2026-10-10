import { useFrame } from '@react-three/fiber';
import { useAfterPhysicsStep, useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { useRef } from 'react';
import { Object3D, Vector3 } from 'three';
import { perfStats } from './perfStats';

/** Compteurs de scène relus toutes les N images : gl.info et les ensembles Rapier ne sont pas gratuits à interroger. */
const SCENE_SAMPLE_EVERY_FRAMES = 30;
/** Nombre d'images suivant un recentrage d'origine flottante pendant lesquelles on cherche une discontinuité visuelle. */
const RECENTER_WATCH_FRAMES = 8;
/** Images ignorées après l'apparition du châssis : la caméra se place d'un coup au démarrage, ce n'est pas de la conduite. */
const WARMUP_FRAMES = 240;
const CHASSIS_NAME = 'generic-car-chassis';

/**
 * Sonde à monter dans le Canvas (aucun rendu), APRÈS la caméra de poursuite : sa mise à jour de position doit avoir eu lieu
 * avant la lecture. Alimente perfStats avec le temps d'image, la durée du pas physique, les compteurs de scène et la
 * continuité visuelle autour des recentrages. Son coût est négligeable (deux horloges et un tampon circulaire par image).
 *
 * Continuité : on suit le vecteur voiture→caméra, tel que rendu (position interpolée du châssis, position de la caméra).
 * Un scintillement au recentrage de l'origine flottante se verrait comme un saut de ce vecteur entre deux images
 * consécutives, bien au-delà de son évolution normale ; on retient le plus grand saut des images qui suivent un recentrage
 * (`recenterJumpM`) et, pour comparaison, le plus grand saut de conduite normale (`steadyJumpM`).
 */
export function PerfProbe() {
  const { world } = useRapier();
  const stepStartRef = useRef(0);
  const frameRef = useRef(0);
  const chassisRef = useRef<Object3D | null>(null);
  const previousRelativeRef = useRef<Vector3 | null>(null);
  const relativeRef = useRef(new Vector3());
  const carPositionRef = useRef(new Vector3());
  const lastRecentersRef = useRef(0);
  const watchFramesRef = useRef(0);
  const framesWithChassisRef = useRef(0);

  useBeforePhysicsStep(() => { stepStartRef.current = performance.now(); });
  useAfterPhysicsStep(() => { perfStats.physicsStepMs.push(performance.now() - stepStartRef.current); });

  useFrame(({ gl, scene, camera }, delta) => {
    perfStats.frameMs.push(delta * 1000);
    frameRef.current += 1;

    if (!chassisRef.current) chassisRef.current = scene.getObjectByName(CHASSIS_NAME) ?? null;
    const chassis = chassisRef.current;
    if (chassis) {
      framesWithChassisRef.current += 1;
      chassis.getWorldPosition(carPositionRef.current);
      relativeRef.current.copy(carPositionRef.current).sub(camera.position);
      if (perfStats.world.recenters !== lastRecentersRef.current) {
        lastRecentersRef.current = perfStats.world.recenters;
        watchFramesRef.current = RECENTER_WATCH_FRAMES;
      }
      const previous = previousRelativeRef.current;
      if (previous) {
        const jump = relativeRef.current.distanceTo(previous);
        if (watchFramesRef.current > 0) {
          perfStats.world.recenterJumpM = Math.max(perfStats.world.recenterJumpM, jump);
          watchFramesRef.current -= 1;
        } else if (delta < 0.1 && framesWithChassisRef.current > WARMUP_FRAMES) {
          // Les images très longues (chargement) ne représentent pas la conduite normale.
          perfStats.world.steadyJumpM = Math.max(perfStats.world.steadyJumpM, jump);
        }
        previous.copy(relativeRef.current);
      } else {
        previousRelativeRef.current = relativeRef.current.clone();
      }
    }

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
