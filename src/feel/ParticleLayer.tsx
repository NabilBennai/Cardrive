import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  AdditiveBlending, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, NormalBlending, PlaneGeometry, ShaderMaterial,
} from 'three';
import type { ParticlePool } from './ParticlePool';

const VERTEX = /* glsl */ `
  attribute vec3 iPosition;
  attribute float iSize;
  attribute float iAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vAlpha = iAlpha;
    vec4 viewPosition = modelViewMatrix * vec4(iPosition, 1.0);
    // Panneau orienté vers la caméra : on décale dans le plan de l'écran, dans l'espace de la vue.
    viewPosition.xy += position.xy * iSize;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float soft = 1.0 - smoothstep(0.0, 1.0, d);
    float a = soft * soft * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

interface ParticleLayerProps {
  pool: ParticlePool;
  color: string;
  /** Mélange additif (étincelles, lumières) plutôt que normal (fumée, poussière). */
  additive?: boolean;
}

/**
 * Affiche un ParticlePool sous forme de panneaux instanciés orientés vers la caméra. Les panneaux (et non des points GL) n'ont
 * pas de limite de taille matérielle : une fumée de plusieurs mètres vue de près reste correcte sur tous les GPU. Les tableaux
 * du bassin sont partagés avec les attributs d'instance : un `needsUpdate` par image suffit, sans copie.
 */
export function ParticleLayer({ pool, color, additive = false }: ParticleLayerProps) {
  const geometry = useMemo(() => {
    const quad = new PlaneGeometry(1, 1);
    const instanced = new InstancedBufferGeometry();
    instanced.index = quad.index;
    instanced.setAttribute('position', quad.getAttribute('position'));
    instanced.setAttribute('uv', quad.getAttribute('uv'));
    instanced.setAttribute('iPosition', new InstancedBufferAttribute(pool.positions, 3).setUsage(DynamicDrawUsage));
    instanced.setAttribute('iSize', new InstancedBufferAttribute(pool.sizes, 1).setUsage(DynamicDrawUsage));
    instanced.setAttribute('iAlpha', new InstancedBufferAttribute(pool.alphas, 1).setUsage(DynamicDrawUsage));
    instanced.instanceCount = pool.capacity;
    return instanced;
  }, [pool]);

  const material = useMemo(() => new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uColor: { value: new Color(color) } },
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
  }), [color, additive]);

  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { material.dispose(); }, [material]);

  useFrame(() => {
    // Seuls les tableaux ont changé : on signale leur envoi au GPU (les trois attributs partagent la mémoire du bassin).
    geometry.getAttribute('iPosition').needsUpdate = true;
    geometry.getAttribute('iSize').needsUpdate = true;
    geometry.getAttribute('iAlpha').needsUpdate = true;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
}
