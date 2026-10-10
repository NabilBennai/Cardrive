import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Box3, Group, Mesh, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VehicleConfig } from '../../shared/types';
import type { DamageState } from '../physics/damageModel';
import type { WheelPose } from '../physics/useVehiclePhysics';
import { CrumpleController } from './crumpleObject';

/** Largeur visuelle maximale visée, en multiple de la largeur du collider : les modèles Kenney sont volontairement larges. */
const MAX_VISUAL_WIDTH_RATIO = 1.14;
const WHEEL_SUSPENSION_ANCHOR_M = 0.08;

interface WheelRig {
  /** Pivot de direction (rotation Y) placé à la position de la roue ; la roue d'origine est son enfant et tourne en X. */
  steer: Group;
  wheel: Object3D;
  radiusModelM: number;
}

interface KenneyCarModelProps {
  url: string;
  config: VehicleConfig;
  wheelPosesRef: React.RefObject<WheelPose[]>;
  /** Hauteur du sol sous l'origine du châssis (négative), identique à celle de la carrosserie procédurale. */
  groundOffsetM: number;
  /** Dégâts de la voiture : la carrosserie (hors roues) se froisse quand ils changent. Absent : jamais de froissement. */
  damage?: Readonly<DamageState>;
}

/** Associe chaque roue physique (avant/arrière, gauche/droite) au nœud « wheel-… » du modèle ; +X est la gauche (xM > 0) pour un véhicule orienté vers +Z. */
function matchWheel(root: Object3D, front: boolean, xSign: number): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((node) => {
    // Nom exact : le SUV a aussi un nœud « wheel-back » (roue de secours fixe) qui ne doit pas être animé.
    const match = /^wheel-(front|back)-(left|right)$/.exec(node.name);
    if (found || !match) return;
    if ((match[1] === 'front') === front && (match[2] === 'left') === (xSign > 0)) found = node;
  });
  return found;
}

/**
 * Carrosserie issue d'un GLB du Car Kit de Kenney, animée par les poses de roues de la
 * simulation (suspension, braquage, rotation) exactement comme les roues procédurales de
 * GenericCar. Le modèle est mis à l'échelle (uniforme) pour tenir dans le gabarit du collider
 * Rapier : sa longueur ne dépasse pas celle du châssis physique, sa largeur reste proche.
 */
/** Vrai pour un maillage qui appartient à une roue du modèle (nœuds « wheel-… ») : il n'est jamais froissé. */
const isWheelPart = (mesh: Mesh): boolean => {
  for (let node: Object3D | null = mesh; node; node = node.parent) if (/^wheel/.test(node.name)) return true;
  return false;
};

export function KenneyCarModel({ url, config, wheelPosesRef, groundOffsetM, damage }: KenneyCarModelProps) {
  const gltf = useLoader(GLTFLoader, url);

  const { root, scale, rigs } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((node) => {
      if ((node as Mesh).isMesh) { node.castShadow = true; node.receiveShadow = true; }
    });

    const box = new Box3().setFromObject(clone);
    const size = box.getSize(new Vector3());
    const fit = Math.min(config.dimensionsM.lengthM / size.z, (config.dimensionsM.widthM * MAX_VISUAL_WIDTH_RATIO) / size.x);

    const wheelRigs: Array<WheelRig | null> = config.wheelMounts.map((mount) => {
      const wheel = matchWheel(clone, mount.front, Math.sign(mount.xM));
      if (!wheel || !wheel.parent) return null;
      const wheelBox = new Box3().setFromObject(wheel);
      const radiusModelM = (wheelBox.max.y - wheelBox.min.y) / 2;
      const steer = new Group();
      steer.position.copy(wheel.position);
      wheel.position.set(0, 0, 0);
      wheel.parent.add(steer);
      steer.add(wheel);
      return { steer, wheel, radiusModelM };
    });
    return { root: clone, scale: fit, rigs: wheelRigs };
  }, [gltf, config]);

  // Pas de nettoyage manuel du clone : R3F le détache avec le <primitive>, et en StrictMode (montage/démontage/remontage) un removeFromParent() le ferait disparaître définitivement. gltf.scene, partagé par le cache du loader, n'est jamais modifié.

  const crumple = useRef<CrumpleController | null>(null);
  useEffect(() => { crumple.current = null; }, [root]);

  useFrame(() => {
    if (damage && (damage.bodyVersion > 0 || crumple.current)) {
      crumple.current ??= new CrumpleController(root, (mesh) => !isWheelPart(mesh));
      crumple.current.sync(damage);
    }
    rigs.forEach((rig, index) => {
      if (!rig) return;
      const pose = wheelPosesRef.current[index];
      // Centre de roue physique au-dessus du sol, puis corrigé de l'écart de rayon visuel/physique
      // pour que le bas du pneu reste exactement au sol quelle que soit la taille de la roue du modèle.
      const centerAboveGroundM = (-WHEEL_SUSPENSION_ANCHOR_M - pose.suspensionM - groundOffsetM) + (rig.radiusModelM * scale - config.wheelRadiusM);
      rig.steer.position.y = centerAboveGroundM / scale;
      rig.steer.rotation.y = pose.steeringRad;
      rig.wheel.rotation.x = pose.spinRad;
    });
  });

  return <primitive object={root} position={[0, groundOffsetM, 0]} scale={scale} />;
}
