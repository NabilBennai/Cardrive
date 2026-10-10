import { describe, expect, it } from 'vitest';
import { CAR_CATALOG, DEFAULT_CAR_ID } from '../src/vehicle/catalog/carCatalog';
import { genericVehicle } from '../src/vehicle/configs/genericVehicle';
import { groundDistanceM, PROFILE_IDS, restSuspensionM, summarizeVehicle, vehicleConfigFor } from '../src/vehicle/configs/vehicleProfiles';
import { vehicleColliderMassProperties, vehicleColliderOffsetY } from '../src/vehicle/physics/vehicleBody';

const summary = (id: string) => summarizeVehicle(vehicleConfigFor(id));
const powerToWeight = (id: string) => summary(id).powerKw / summary(id).massKg;

describe('vehicle profiles', () => {
  it('gives every catalogue car except the prototype its own profile, and keeps the prototype untouched', () => {
    const modelIds = CAR_CATALOG.filter((car) => car.id !== DEFAULT_CAR_ID).map((car) => car.id);
    expect([...PROFILE_IDS].sort()).toEqual([...modelIds].sort());
    expect(vehicleConfigFor(DEFAULT_CAR_ID)).toBe(genericVehicle);
    expect(vehicleConfigFor('inconnu')).toBe(genericVehicle);
    expect(vehicleConfigFor(null)).toBe(genericVehicle);
  });

  it('derives valid, cached configurations (four wheels, a driven axle, ordered torque curve)', () => {
    for (const id of PROFILE_IDS) {
      const config = vehicleConfigFor(id);
      expect(vehicleConfigFor(id), id).toBe(config);
      expect(config.wheelMounts, id).toHaveLength(4);
      expect(config.wheelMounts.some((wheel) => wheel.driven), id).toBe(true);
      expect(config.gearRatios.every((ratio, i, all) => i === 0 || ratio < all[i - 1]), id).toBe(true);
      expect(config.upshiftRpm, id).toBeLessThan(config.maximumRpm);
    }
  });

  it('makes performance follow the nature of the vehicle', () => {
    expect(powerToWeight('race')).toBeGreaterThan(powerToWeight('sedan-sports'));
    expect(powerToWeight('sedan-sports')).toBeGreaterThan(powerToWeight('sedan'));
    expect(powerToWeight('sedan')).toBeGreaterThan(powerToWeight('truck'));
    expect(powerToWeight('truck')).toBeGreaterThan(powerToWeight('firetruck') * 0.9);
    expect(summary('firetruck').massKg).toBeGreaterThan(summary('truck').massKg);
    expect(summary('kart-oobi').massKg).toBeLessThan(summary('sedan').massKg / 4);
    // L'adhérence, le freinage et la direction suivent aussi la nature du véhicule.
    expect(vehicleConfigFor('race').tireGrip).toBeGreaterThan(vehicleConfigFor('sedan').tireGrip);
    expect(vehicleConfigFor('sedan').tireGrip).toBeGreaterThan(vehicleConfigFor('firetruck').tireGrip);
    expect(vehicleConfigFor('race').serviceBrakeForceN / vehicleConfigFor('race').massKg)
      .toBeGreaterThan(vehicleConfigFor('truck').serviceBrakeForceN / vehicleConfigFor('truck').massKg);
    expect(vehicleConfigFor('firetruck').maxSteeringRad).toBeLessThan(vehicleConfigFor('sedan').maxSteeringRad);
    expect(vehicleConfigFor('tractor').finalDriveRatio * vehicleConfigFor('tractor').gearRatios[0])
      .toBeGreaterThan(vehicleConfigFor('race').finalDriveRatio * vehicleConfigFor('race').gearRatios[0]);
  });

  it('assigns the drive layout from the vehicle type', () => {
    expect(summary('sedan').drive).toBe('Traction');
    expect(summary('sedan-sports').drive).toBe('Propulsion');
    expect(summary('suv').drive).toBe('Intégrale');
    expect(summary('race-future').drive).toBe('Intégrale');
    expect(DEFAULT_CAR_ID && summarizeVehicle(genericVehicle).drive).toBe('Propulsion');
  });

  it('keeps the chassis collider clear of the ground and the centre of mass inside the body', () => {
    for (const id of [DEFAULT_CAR_ID, ...PROFILE_IDS]) {
      const config = vehicleConfigFor(id);
      const bottom = vehicleColliderOffsetY(config) - config.dimensionsM.heightM / 2;
      expect(bottom, id).toBeGreaterThan(-groundDistanceM(config));
      const comLocal = vehicleColliderMassProperties(config).centerOfMass.y;
      expect(Math.abs(comLocal), id).toBeLessThan(config.dimensionsM.heightM / 2);
      expect(restSuspensionM(config), id).toBeGreaterThan(config.minimumSuspensionLengthM);
    }
  });
});
