import { Vector3 } from 'three';

type XZ = { xM: number; zM: number } | Vector3;

const xOf = (p: XZ) => ('xM' in p ? p.xM : p.x);
const zOf = (p: XZ) => ('zM' in p ? p.zM : p.z);

/**
 * Ajoute à `out` (positions xyz de triangles non indexés) un prisme le long d'une polyligne
 * ouverte, entre les décalages latéraux `offsetA` et `offsetB` (mètres, signés, par rapport à
 * l'axe ; normale gauche = (-tz, 0, tx), même convention que buildWayRibbon), de y=baseY à
 * y=baseY+heightM : dessus, deux flancs et deux extrémités. Non indexé donc normales plates
 * (computeVertexNormals), et directement utilisable comme maillage de collision.
 */
export function buildStripPrisms(out: number[], points: XZ[], offsetA: number, offsetB: number, heightM: number, baseY: number) {
  const count = points.length;
  if (count < 2) return;

  const ringA: Array<[number, number]> = [];
  const ringB: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    const prev = points[Math.max(0, i - 1)]; const next = points[Math.min(count - 1, i + 1)];
    let tx = xOf(next) - xOf(prev); let tz = zOf(next) - zOf(prev);
    const length = Math.hypot(tx, tz);
    if (length === 0) { tx = 0; tz = 1; } else { tx /= length; tz /= length; }
    const nx = -tz; const nz = tx;
    ringA.push([xOf(points[i]) + nx * offsetA, zOf(points[i]) + nz * offsetA]);
    ringB.push([xOf(points[i]) + nx * offsetB, zOf(points[i]) + nz * offsetB]);
  }

  const top = baseY + heightM;
  type P3 = [number, number, number];
  const v = (p: [number, number], y: number): P3 => [p[0], y, p[1]];
  const quad = (a: P3, b: P3, c: P3, d: P3) => { out.push(...a, ...b, ...c, ...a, ...c, ...d); };

  for (let i = 0; i < count - 1; i += 1) {
    quad(v(ringA[i], top), v(ringB[i], top), v(ringB[i + 1], top), v(ringA[i + 1], top));
    quad(v(ringA[i], baseY), v(ringA[i], top), v(ringA[i + 1], top), v(ringA[i + 1], baseY));
    quad(v(ringB[i], top), v(ringB[i], baseY), v(ringB[i + 1], baseY), v(ringB[i + 1], top));
  }
  quad(v(ringA[0], baseY), v(ringB[0], baseY), v(ringB[0], top), v(ringA[0], top));
  const last = count - 1;
  quad(v(ringB[last], baseY), v(ringA[last], baseY), v(ringA[last], top), v(ringB[last], top));
}

/** Transforme une liste de positions de triangles non indexés en tableaux prêts pour un TrimeshCollider. */
export function toTrimesh(positions: number[]): { vertices: Float32Array; indices: Uint32Array } {
  const vertices = new Float32Array(positions);
  const indices = new Uint32Array(vertices.length / 3);
  for (let i = 0; i < indices.length; i += 1) indices[i] = i;
  return { vertices, indices };
}
