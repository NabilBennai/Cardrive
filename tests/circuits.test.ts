import { describe, expect, it } from 'vitest';
import { buildCircuitTrack, resampleClosed, roundClosedCorners, SAMPLE_SPACING_M, unblockedRuns } from '../src/circuits/circuitGeometry';
import { buildCircuitLayout } from '../src/circuits/circuitMesh';
import { F1_CIRCUITS_2026, type CircuitSource } from '../src/circuits/f1Circuits2026';
import { circuitOutlinePath } from '../src/circuits/outline';

describe('F1 2026 circuit catalogue', () => {
  it('lists the 24 rounds once each, with closed traced loops', () => {
    expect(F1_CIRCUITS_2026).toHaveLength(24);
    expect(F1_CIRCUITS_2026.map((c) => c.round).sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(new Set(F1_CIRCUITS_2026.map((c) => c.id)).size).toBe(24);
    for (const circuit of F1_CIRCUITS_2026) {
      const first = circuit.coordinates[0]; const last = circuit.coordinates[circuit.coordinates.length - 1];
      expect(first, circuit.id).toEqual(last);
    }
  });

  it('marks Bahrain and Saudi Arabia as cancelled', () => {
    expect(F1_CIRCUITS_2026.filter((c) => c.status === 'cancelled').map((c) => c.location).sort()).toEqual(['Jeddah', 'Sakhir']);
  });

  it('keeps every smoothed lap within 3% of the official length and the loop closed', () => {
    for (const circuit of F1_CIRCUITS_2026) {
      const track = buildCircuitTrack(circuit);
      // La longueur après arrondi des virages est la longueur de la polyligne arrondie, légèrement plus courte que le tracé brut.
      expect(Math.abs(track.lengthM - circuit.lengthM) / circuit.lengthM, circuit.id).toBeLessThan(0.03);
      const sampled = track.centerline.length * SAMPLE_SPACING_M;
      expect(Math.abs(sampled - track.lengthM) / track.lengthM, circuit.id).toBeLessThan(0.02);
    }
  });

  it('spawns a few metres before the start line, facing the direction of travel', () => {
    const track = buildCircuitTrack(F1_CIRCUITS_2026[0]);
    const toLine = { x: track.startLine.xM - track.spawn.xM, z: track.startLine.zM - track.spawn.zM };
    expect(Math.hypot(toLine.x, toLine.z)).toBeLessThan(12);
    // Le cap du spawn pointe vers la ligne de départ (produit scalaire positif).
    expect(Math.sin(track.spawn.headingRad) * toLine.x + Math.cos(track.spawn.headingRad) * toLine.z).toBeGreaterThan(0);
  });

  it('builds a layout with colliders for every circuit', () => {
    for (const circuit of F1_CIRCUITS_2026) {
      const layout = buildCircuitLayout(buildCircuitTrack(circuit));
      expect(layout.walls, circuit.id).not.toBeNull();
      expect(layout.asphalt.getAttribute('position').count).toBeGreaterThan(100);
    }
  });
});

describe('roundClosedCorners / resampleClosed', () => {
  it('keeps a long straight straight and only rounds the corners', () => {
    const rect = [{ xM: 0, zM: 0 }, { xM: 1000, zM: 0 }, { xM: 1000, zM: 100 }, { xM: 0, zM: 100 }];
    const rounded = roundClosedCorners(rect, 70);
    const onStraight = rounded.filter((p) => p.xM > 100 && p.xM < 900);
    expect(onStraight.length).toBe(0); // aucun point intermédiaire inventé sur la ligne droite
    const { points, lengthM } = resampleClosed(rounded, 3);
    for (const p of points.filter((q) => q.xM > 150 && q.xM < 850)) expect(Math.min(Math.abs(p.zM), Math.abs(p.zM - 100))).toBeLessThan(1e-6);
    expect(lengthM).toBeLessThan(2200);
    expect(lengthM).toBeGreaterThan(2000);
  });
});

describe('unblockedRuns on a figure-eight', () => {
  it('opens a gap in the wall where the track crosses itself', () => {
    // Huit : deux boucles qui se croisent en (0,0).
    const source: CircuitSource = {
      id: 'test-8', round: 1, grandPrix: 'Test', name: 'Huit', location: 'Nulle part', country: 'Test', lengthM: 0, status: 'scheduled', widthM: 12,
      coordinates: [[0, 0], [0.0012, 0.0012], [0.0024, 0], [0.0012, -0.0012], [0, 0], [-0.0012, 0.0012], [-0.0024, 0], [-0.0012, -0.0012], [0, 0]],
    };
    const track = buildCircuitTrack(source);
    const runs = unblockedRuns(track, 1, track.widthM / 2 + 7);
    expect(runs.length).toBeGreaterThan(0);
    const closedWhole = runs.length === 1 && runs[0][0] === runs[0][runs[0].length - 1];
    expect(closedWhole).toBe(false);
  });
});

describe('circuitOutlinePath', () => {
  it('fits the path in the square and closes it', () => {
    const path = circuitOutlinePath([[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]], 100, 10);
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    const numbers = (path.match(/-?\d+\.\d/g) ?? []).map(Number);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(10 - 0.1);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(90 + 0.1);
  });
});

describe('ribbon orientation', () => {
  it('builds asphalt and kerb faces whose normals point up', () => {
    const track = buildCircuitTrack(F1_CIRCUITS_2026[7]);
    const layout = buildCircuitLayout(track);
    for (const geometry of [layout.asphalt, layout.kerbs]) {
      expect(geometry).not.toBeNull();
      const normals = geometry!.getAttribute('normal');
      let up = 0;
      for (let i = 0; i < normals.count; i += 1) if (normals.getY(i) > 0) up += 1;
      expect(up / normals.count).toBeGreaterThan(0.99);
    }
  });
});
