import { describe, expect, it } from 'vitest';
import { ParticlePool, type ParticleSpawn } from '../src/feel/ParticlePool';
import { SkidBuffer } from '../src/feel/SkidBuffer';

const smoke: ParticleSpawn = { x: 1, y: 0, z: 2, vx: 0, vy: 1, vz: 0, life: 1, sizeStart: 0.5, sizeEnd: 2, alpha: 0.4 };

describe('ParticlePool', () => {
  it('lives, fades out and dies after its lifetime', () => {
    const pool = new ParticlePool(8, { gravityY: 0, drag: 0, fadeIn: 0.1 });
    pool.spawn(smoke);
    pool.update(0.5);
    expect(pool.active).toBe(1);
    expect(pool.alphas[0]).toBeGreaterThan(0);
    expect(pool.sizes[0]).toBeGreaterThan(0.5);
    expect(pool.positions[1]).toBeCloseTo(0.5, 5);
    pool.update(0.6);
    expect(pool.active).toBe(0);
    expect(pool.alphas[0]).toBe(0);
    expect(pool.sizes[0]).toBe(0);
  });

  it('fades monotonically after its rise, and grows (smoke) or shrinks (sparks) with age', () => {
    const pool = new ParticlePool(2, { gravityY: 0, drag: 0, fadeIn: 0.1 });
    pool.spawn({ ...smoke, life: 2, sizeStart: 0.1, sizeEnd: 0.02 });
    let previousAlpha = Infinity;
    let previousSize = Infinity;
    for (let step = 0; step < 20; step += 1) {
      pool.update(0.08);
      if (step >= 3) {
        expect(pool.alphas[0]).toBeLessThanOrEqual(previousAlpha);
        expect(pool.sizes[0]).toBeLessThanOrEqual(previousSize);
        previousAlpha = pool.alphas[0];
        previousSize = pool.sizes[0];
      }
    }
  });

  it('applies gravity and air drag', () => {
    const falling = new ParticlePool(1, { gravityY: -10, drag: 0, fadeIn: 0 });
    falling.spawn({ ...smoke, vy: 0, life: 5 });
    falling.update(0.5); falling.update(0.5);
    expect(falling.positions[1]).toBeLessThan(-3);
    const damped = new ParticlePool(1, { gravityY: 0, drag: 4, fadeIn: 0 });
    damped.spawn({ ...smoke, vx: 10, life: 5 });
    for (let i = 0; i < 60; i += 1) damped.update(1 / 60);
    expect(damped.positions[0] - 1).toBeLessThan(2.6); // sans frottement : 10 m
  });

  it('overwrites the oldest particle when full and never exceeds its capacity', () => {
    const pool = new ParticlePool(3, { gravityY: 0, drag: 0, fadeIn: 0 });
    for (let i = 0; i < 7; i += 1) pool.spawn({ ...smoke, x: i });
    pool.update(0.01);
    expect(pool.active).toBe(3);
    expect(Array.from(pool.positions).filter((_, index) => index % 3 === 0).sort()).toEqual([4, 5, 6]);
  });

  it('shifts only live particles by the origin offset', () => {
    const pool = new ParticlePool(2, { gravityY: 0, drag: 0, fadeIn: 0 });
    pool.spawn({ ...smoke, x: 100, z: 50, vy: 0 });
    pool.update(0.01);
    pool.shift(60, 0, 20);
    expect(pool.positions[0]).toBeCloseTo(40, 3);
    expect(pool.positions[2]).toBeCloseTo(30, 3);
    expect(pool.positions[3]).toBe(0); // la place libre n'a pas bougé
    pool.clear();
    expect(pool.active).toBe(0);
  });
});

describe('SkidBuffer', () => {
  it('starts a strip on the first point and adds a quad per new segment', () => {
    const buffer = new SkidBuffer(10, 4);
    expect(buffer.extend(0, 0, 0, 0, 0.5)).toBe(false);
    expect(buffer.extend(0, 0, 0, 1, 0.5)).toBe(true);
    expect(buffer.extend(0, 0, 0, 2, 0.5)).toBe(true);
    expect(buffer.visibleQuads).toBe(2);
    expect(buffer.dirty).toBe(true);
  });

  it('draws a quad of the requested width across the direction of travel', () => {
    const buffer = new SkidBuffer(4, 1, 0.2);
    buffer.extend(0, 0, 0, 0, 0.4);
    buffer.extend(0, 0, 0, 1, 0.4); // avance vers +z : la largeur s'étend sur x
    const xs = [0, 3, 6, 9].map((i) => buffer.positions[i]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.4, 5);
    expect(buffer.colors[3]).toBeCloseTo(0.4, 5); // opacité des sommets de départ
  });

  it('ignores tiny movements, and breaks the strip after a teleport or an explicit break', () => {
    const buffer = new SkidBuffer(10, 1);
    buffer.extend(0, 0, 0, 0, 0.5);
    expect(buffer.extend(0, 0, 0, 0.01, 0.5)).toBe(false); // sous le seuil de longueur
    expect(buffer.extend(0, 0, 0, 50, 0.5)).toBe(false); // saut de 50 m : ni trait ni raccord
    expect(buffer.visibleQuads).toBe(0);
    buffer.extend(0, 0, 0, 50.5, 0.5);
    expect(buffer.visibleQuads).toBe(1);
    buffer.breakStrip(0);
    expect(buffer.extend(0, 9, 0, 9, 0.5)).toBe(false); // nouvelle bande : pas de trait vers le point précédent
    expect(buffer.visibleQuads).toBe(1);
  });

  it('keeps strips of different wheels independent, and wraps around when full', () => {
    const buffer = new SkidBuffer(3, 2);
    buffer.extend(0, 0, 0, 0, 0.5); buffer.extend(1, 5, 0, 0, 0.5);
    buffer.extend(0, 0, 0, 1, 0.5);
    buffer.extend(1, 5, 0, 1, 0.5);
    expect(buffer.visibleQuads).toBe(2);
    for (let z = 2; z < 8; z += 1) buffer.extend(0, 0, 0, z, 0.5);
    expect(buffer.visibleQuads).toBe(3);
    expect(buffer.written).toBeGreaterThan(3);
  });

  it('shifts every mark and the open strip ends with the origin', () => {
    const buffer = new SkidBuffer(4, 1);
    buffer.extend(0, 100, 0, 100, 0.5);
    buffer.extend(0, 100, 0, 101, 0.5);
    buffer.shift(100, 0, 100);
    expect(Math.abs(buffer.positions[2])).toBeLessThan(2);
    buffer.extend(0, 0, 0, 2, 0.5); // continue la bande dans le nouveau repère : un trait continu, pas un saut de 100 m
    expect(buffer.visibleQuads).toBe(2);
  });
});
