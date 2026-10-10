import { Box3, BufferAttribute, Matrix4, Vector3, type BufferGeometry, type Mesh, type Object3D } from 'three';
import type { DamageState } from '../physics/damageModel';
import { crumplePoint, hasBodyDamage, type CrumpleBounds } from './crumple';

interface CrumpleTarget {
  mesh: Mesh;
  /** Transformation du repère du maillage vers le repère du véhicule (identité si les sommets sont déjà dans le repère du véhicule). */
  toRoot: Matrix4;
  fromRoot: Matrix4;
  original: Float32Array | null;
}

/**
 * Froisse les maillages d'une carrosserie selon l'état des dégâts. La géométrie d'origine est conservée : on la recopie (les
 * géométries des modèles chargés sont partagées entre toutes les voitures) à la première utilisation, puis on déplace les sommets
 * depuis les positions d'origine à chaque changement. N'a lieu qu'à l'arrivée d'un dégât ou d'une réparation, jamais à chaque image.
 */
export class CrumpleController {
  private readonly targets: CrumpleTarget[];
  private readonly bounds: CrumpleBounds;
  private appliedVersion = 0;
  private readonly scratch = new Vector3();

  /** `root` : objet dont le repère est celui du véhicule (x gauche, z avant) ; `include` filtre les maillages de carrosserie (pas les roues). */
  constructor(root: Object3D, include: (mesh: Mesh) => boolean) {
    root.updateWorldMatrix(true, true);
    const rootInverse = new Matrix4().copy(root.matrixWorld).invert();
    this.targets = [];
    root.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh || !include(mesh)) return;
      const toRoot = new Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
      this.targets.push({ mesh, toRoot, fromRoot: new Matrix4().copy(toRoot).invert(), original: null });
    });
    const box = new Box3();
    for (const target of this.targets) {
      target.mesh.geometry.computeBoundingBox();
      const local = target.mesh.geometry.boundingBox;
      if (local) box.union(local.clone().applyMatrix4(target.toRoot));
    }
    this.bounds = { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z };
  }

  /** Recalcule les sommets si la carrosserie a changé depuis le dernier appel. */
  sync(damage: DamageState): void {
    if (damage.bodyVersion === this.appliedVersion) return;
    this.appliedVersion = damage.bodyVersion;
    const damaged = hasBodyDamage(damage.body);
    for (const target of this.targets) {
      if (!damaged && target.original === null) continue;
      this.apply(target, damage, damaged);
    }
  }

  private apply(target: CrumpleTarget, damage: DamageState, damaged: boolean): void {
    const mesh = target.mesh;
    if (target.original === null) {
      mesh.geometry = mesh.geometry.clone() as BufferGeometry;
      target.original = Float32Array.from(mesh.geometry.getAttribute('position').array as ArrayLike<number>);
    }
    const attribute = mesh.geometry.getAttribute('position') as BufferAttribute;
    const original = target.original;
    const v = this.scratch;
    for (let i = 0; i < attribute.count; i += 1) {
      v.set(original[i * 3], original[i * 3 + 1], original[i * 3 + 2]);
      if (damaged) {
        v.applyMatrix4(target.toRoot);
        const q = crumplePoint({ x: v.x, y: v.y, z: v.z }, damage.body, this.bounds);
        v.set(q.x, q.y, q.z).applyMatrix4(target.fromRoot);
      }
      attribute.setXYZ(i, v.x, v.y, v.z);
    }
    attribute.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }
}
