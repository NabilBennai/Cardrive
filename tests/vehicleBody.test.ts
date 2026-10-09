import { describe, expect, it } from 'vitest';
import { translateVehicleBody } from '../src/vehicle/physics/vehicleBody';

// Faux RapierRigidBody minimal : ne fournit QUE translation()/setTranslation(). Une régression
// qui appellerait setLinvel/setAngvel/resetForces/resetTorques planterait immédiatement au
// lieu de passer silencieusement — c'est exactement ce que ce test vérifie (doc §6 : « Le
// décalage ne modifie pas la vitesse », contrairement à resetVehicleBody).
function makeMinimalBody(initial: { x: number; y: number; z: number }) {
  let position = initial;
  const captured: { setTranslation: Array<{ x: number; y: number; z: number }> } = { setTranslation: [] };
  const body = {
    translation: () => position,
    setTranslation: (next: { x: number; y: number; z: number }) => {
      captured.setTranslation.push(next);
      position = next;
    },
  };
  return { body, captured };
}

describe('translateVehicleBody', () => {
  it('subtracts the offset from the current translation and nothing else', () => {
    const { body, captured } = makeMinimalBody({ x: 10, y: 0.8, z: 5 });
    // @ts-expect-error faux RapierRigidBody minimal, volontairement incomplet (voir commentaire ci-dessus)
    translateVehicleBody(body, { xM: 3, yM: 0, zM: -2 });
    expect(captured.setTranslation).toHaveLength(1);
    expect(captured.setTranslation[0]).toEqual({ x: 7, y: 0.8, z: 7 });
  });

  it('does not throw on a body lacking setLinvel/setAngvel/resetForces/resetTorques', () => {
    const { body } = makeMinimalBody({ x: 0, y: 0, z: 0 });
    // @ts-expect-error faux RapierRigidBody minimal, volontairement incomplet
    expect(() => translateVehicleBody(body, { xM: 1, yM: 0, zM: 1 })).not.toThrow();
  });
});
