import { useFrame } from '@react-three/fiber';
import type { RapierRigidBody } from '@react-three/rapier';
import { useMemo, useRef } from 'react';
import { Object3D, type DirectionalLight } from 'three';

/** Direction du soleil : la lumière est placée à ce décalage de la cible (30 m à l'ouest, 48 m en hauteur, 20 m au sud). */
const SUN_OFFSET = { x: -30, y: 48, z: 20 };
/** Demi-côté (m) de la zone ombrée autour de la voiture ; la carte d'ombre (2048 px) couvre donc 150 m → ≈ 7 cm par texel. */
const SHADOW_HALF_EXTENT_M = 75;
/**
 * Biais de la carte d'ombre : sans lui, les surfaces qui reçoivent ET projettent de l'ombre (trottoirs, murs, bordures) se
 * « s'ombrent » elles-mêmes et affichent un motif moiré (acné d'ombre). Le biais de normale (en unités de monde, ≈ 7 texels)
 * décale l'échantillonnage le long de la normale de la surface, ce qui élimine l'acné sans détacher les ombres de leurs objets.
 */
const SHADOW_BIAS = -0.0005;
const SHADOW_NORMAL_BIAS = 0.05;
/** Pas de grille (m) sur lequel suit la lumière : l'accrocher limite le scintillement des bords d'ombre quand elle se déplace. */
const SNAP_M = 1;

interface FollowingSunProps {
  bodyRef: React.RefObject<RapierRigidBody | null>;
}

/**
 * Soleil dont la zone d'ombre suit la voiture. Une lumière fixe n'ombrait que les ±75 m autour de l'origine : à l'origine
 * du monde pour une piste, mais surtout à chaque recentrage pour une ville, la voiture roulait donc presque tout le temps
 * hors de la zone et n'avait plus d'ombre (constaté à 2 km du départ sur le scénario de ville synthétique).
 */
export function FollowingSun({ bodyRef }: FollowingSunProps) {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);

  useFrame(() => {
    const body = bodyRef.current;
    const sun = light.current;
    if (!body || !sun) return;
    const position = body.translation();
    const x = Math.round(position.x / SNAP_M) * SNAP_M;
    const z = Math.round(position.z / SNAP_M) * SNAP_M;
    target.position.set(x, 0, z);
    target.updateMatrixWorld();
    sun.position.set(x + SUN_OFFSET.x, SUN_OFFSET.y, z + SUN_OFFSET.z);
  });

  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={light}
        target={target}
        position={[SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={SHADOW_BIAS}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
        shadow-camera-left={-SHADOW_HALF_EXTENT_M}
        shadow-camera-right={SHADOW_HALF_EXTENT_M}
        shadow-camera-top={SHADOW_HALF_EXTENT_M}
        shadow-camera-bottom={-SHADOW_HALF_EXTENT_M}
      />
    </>
  );
}
