import { useLayoutEffect, useMemo, useRef } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, Euler, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';

const SAMPLE_COUNT = 144;
const ROAD_WIDTH = 15;
const RAIL_OFFSET = ROAD_WIDTH / 2 + 0.6;
const curve = new CatmullRomCurve3(
  Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2;
    return new Vector3(38 * Math.cos(angle), 0, 25 * Math.sin(angle));
  }),
  true,
  'centripetal',
);

function GuardrailVisuals({ segments }: { segments: Array<{ position: [number, number, number]; rotation: [number, number, number] }> }) {
  const railMeshRef = useRef<InstancedMesh>(null);
  const matrices = useMemo(() => ({
    transform: new Matrix4(),
    position: new Vector3(),
    rotation: new Quaternion(),
    euler: new Euler(),
    scale: new Vector3(1, 1, 1),
    light: new Color('#e2e6d2'),
    dark: new Color('#e46643'),
  }), []);

  useLayoutEffect(() => {
    const mesh = railMeshRef.current;
    if (!mesh) return;
    segments.forEach((segment, index) => {
      matrices.position.fromArray(segment.position);
      matrices.euler.set(...segment.rotation);
      matrices.rotation.setFromEuler(matrices.euler);
      matrices.transform.compose(matrices.position, matrices.rotation, matrices.scale);
      mesh.setMatrixAt(index, matrices.transform);
      mesh.setColorAt(index, index % 8 < 4 ? matrices.light : matrices.dark);
    });
    mesh.count = segments.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices, segments]);

  return (
    <instancedMesh ref={railMeshRef} args={[undefined, undefined, segments.length]} castShadow receiveShadow>
      <boxGeometry args={[0.68, 1.04, (2 * Math.PI * 30.5) / SAMPLE_COUNT + 0.08]} />
      <meshStandardMaterial roughness={0.48} />
    </instancedMesh>
  );
}

function makeRibbon(halfWidth: number, y: number, segments = SAMPLE_COUNT) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).setY(0).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    positions.push(
      point.x + normal.x * halfWidth, y, point.z + normal.z * halfWidth,
      point.x - normal.x * halfWidth, y, point.z - normal.z * halfWidth,
    );
    if (index < segments) {
      const vertex = index * 2;
      indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function DemoTrack() {
  const road = useMemo(() => makeRibbon(ROAD_WIDTH / 2, 0.008), []);
  const laneLine = useMemo(() => makeRibbon(0.055, 0.018), []);
  const kerbInner = useMemo(() => makeRibbon(0.22, 0.025), []);
  const railSegments = useMemo(() => Array.from({ length: SAMPLE_COUNT }, (_, index) => {
    const t = index / SAMPLE_COUNT;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).setY(0).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const yaw = Math.atan2(tangent.x, tangent.z);
    return [-1, 1].map((side) => ({
      position: [point.x + normal.x * RAIL_OFFSET * side, 0.48, point.z + normal.z * RAIL_OFFSET * side] as [number, number, number],
      rotation: [0, yaw, 0] as [number, number, number],
    }));
  }).flat(), []);

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.101, 0]} receiveShadow>
          <planeGeometry args={[220, 180]} />
          <meshStandardMaterial color="#202b28" roughness={0.94} />
        </mesh>
        <CuboidCollider position={[0, -0.05, 0]} args={[110, 0.05, 90]} />
      </RigidBody>

      <mesh geometry={road} receiveShadow>
        <meshStandardMaterial color="#333b3b" roughness={0.86} side={2} />
      </mesh>
      <mesh geometry={laneLine}>
        <meshBasicMaterial color="#f2ead2" transparent opacity={0.42} side={2} />
      </mesh>
      <mesh geometry={kerbInner}>
        <meshBasicMaterial color="#d4ed55" side={2} />
      </mesh>

      <RigidBody type="fixed" colliders={false}>
        {railSegments.map((segment, index) => (
          <CuboidCollider key={index} position={segment.position} rotation={segment.rotation} args={[0.34, 0.52, (2 * Math.PI * 30.5) / SAMPLE_COUNT]} />
        ))}
      </RigidBody>
      <GuardrailVisuals segments={railSegments} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]}>
        <ringGeometry args={[29.6, 30.1, 96]} />
        <meshBasicMaterial color="#d4ed55" transparent opacity={0.12} />
      </mesh>
      <group position={[38, 0.02, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.2, ROAD_WIDTH]} />
          <meshBasicMaterial color="#eee9d9" />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <planeGeometry args={[0.3, ROAD_WIDTH]} />
          <meshBasicMaterial color="#e46643" />
        </mesh>
      </group>
    </group>
  );
}
