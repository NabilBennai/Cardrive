import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAR_CATALOG, DEFAULT_CAR_ID, findCar } from '../src/vehicle/catalog/carCatalog';

describe('car catalog', () => {
  it('has unique ids and starts with the procedural default', () => {
    expect(new Set(CAR_CATALOG.map((car) => car.id)).size).toBe(CAR_CATALOG.length);
    expect(CAR_CATALOG[0].id).toBe(DEFAULT_CAR_ID);
    expect(CAR_CATALOG[0].modelFile).toBeNull();
  });

  it('falls back to the default for an unknown id', () => {
    expect(findCar('nope').id).toBe(DEFAULT_CAR_ID);
    expect(findCar(null).id).toBe(DEFAULT_CAR_ID);
  });

  it('ships every referenced model and preview, and each model has its four named wheel nodes', () => {
    for (const car of CAR_CATALOG) {
      if (!car.modelFile) continue;
      const glb = `public/models/cars/${car.modelFile}`;
      expect(existsSync(glb), glb).toBe(true);
      expect(existsSync(`public/models/cars/previews/${car.previewFile}`)).toBe(true);
      const buffer = readFileSync(glb);
      const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8')) as { nodes: Array<{ name?: string }> };
      const wheels = json.nodes.filter((node) => /^wheel-(front|back)-(left|right)$/.test(node.name ?? '')).map((node) => node.name);
      expect(wheels.sort(), car.id).toEqual(['wheel-back-left', 'wheel-back-right', 'wheel-front-left', 'wheel-front-right']);
    }
  });
});
