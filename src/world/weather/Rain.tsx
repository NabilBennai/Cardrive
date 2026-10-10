import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, LineBasicMaterial } from 'three';

const DROP_COUNT = 2400;
/** Demi-largeur (m) du volume de pluie autour de la caméra, et hauteur (m). */
const HALF_EXTENT_M = 24;
const HEIGHT_M = 18;
const FALL_SPEED_MPS = 24;
const STREAK_LENGTH_M = 0.9;
/** Pas maximal (s) pris en compte : un onglet en arrière-plan ne doit pas faire « téléporter » les gouttes. */
const MAX_STEP_S = 0.1;

/** Pseudo-aléatoire déterministe (suite de Weyl) : une pluie reproductible, sans Math.random dans le rendu. */
const weyl = (index: number, alpha: number) => (index * alpha) % 1;

function seedDrops(offsets: Float32Array): void {
  for (let i = 0; i < DROP_COUNT; i += 1) {
    offsets[i * 3] = (weyl(i + 1, 0.7548776662) * 2 - 1) * HALF_EXTENT_M;
    offsets[i * 3 + 1] = weyl(i + 1, 0.5698402909) * HEIGHT_M;
    offsets[i * 3 + 2] = (weyl(i + 1, 0.6180339887) * 2 - 1) * HALF_EXTENT_M;
  }
}

/**
 * Fait tomber les gouttes et écrit leurs segments. Les positions horizontales sont celles du monde : la pluie ne suit pas la caméra
 * (parallaxe correcte quand on roule) ; une goutte qui sort du volume centré sur la caméra y rentre de l'autre côté. Une goutte qui
 * touche le sol repart d'en haut.
 */
function advanceRain(offsets: Float32Array, positions: Float32Array, dtS: number, cx: number, cy: number, cz: number, wind: number): void {
  const size = 2 * HALF_EXTENT_M;
  for (let i = 0; i < DROP_COUNT; i += 1) {
    let y = offsets[i * 3 + 1] - FALL_SPEED_MPS * dtS;
    if (y < -cy + 0.05) y += HEIGHT_M;
    const x = offsets[i * 3] - Math.floor((offsets[i * 3] - cx + HALF_EXTENT_M) / size) * size;
    const z = offsets[i * 3 + 2] - Math.floor((offsets[i * 3 + 2] - cz + HALF_EXTENT_M) / size) * size;
    offsets[i * 3] = x;
    offsets[i * 3 + 1] = y;
    offsets[i * 3 + 2] = z;
    const top = cy + y;
    positions.set([x, top, z, x + wind * STREAK_LENGTH_M, top - STREAK_LENGTH_M, z], i * 6);
  }
}

interface RainProps {
  /** Intensité de la pluie, 0 (aucune) à 1 (forte). */
  intensity: number;
}

/** Traînées de pluie dans un volume qui suit la caméra. Rien n'est dessiné sans pluie. */
export function Rain({ intensity }: RainProps) {
  const camera = useThree((state) => state.camera);
  const offsets = useMemo(() => { const data = new Float32Array(DROP_COUNT * 3); seedDrops(data); return data; }, []);
  const positions = useMemo(() => new Float32Array(DROP_COUNT * 6), []);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setDrawRange(0, 0);
    return g;
  }, [positions]);
  const material = useMemo(() => new LineBasicMaterial({ color: '#bcc8d4', transparent: true, opacity: 0.4, depthWrite: false }), []);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { material.dispose(); }, [material]);

  useFrame((_, delta) => {
    const count = Math.round(DROP_COUNT * Math.min(1, Math.max(0, intensity)));
    geometry.setDrawRange(0, count * 2);
    if (count === 0) return;
    advanceRain(offsets, positions, Math.min(delta, MAX_STEP_S), camera.position.x, camera.position.y, camera.position.z, 0.12);
    geometry.getAttribute('position').needsUpdate = true;
  });

  return <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />;
}
