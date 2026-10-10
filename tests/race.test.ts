import { describe, expect, it } from 'vitest';
import type { PlanarPoint } from '../src/circuits/circuitGeometry';
import { deltaToProfile, formatDelta, formatLapTime, LapTimer, MAX_OFF_TRACK_S, type LapTimerEvent } from '../src/race/lapTimer';
import { loadRecords, MIN_PLAUSIBLE_LAP_S, recordKey, saveRecords, withLap, type KeyValueStorage } from '../src/race/records';
import { TrackProjector } from '../src/race/trackProjector';

const RADIUS_M = 300;
const SAMPLES = 628;
const LENGTH_M = 2 * Math.PI * RADIUS_M;
const WIDTH_M = 12;
const DT = 0.01;

const centerline: PlanarPoint[] = Array.from({ length: SAMPLES }, (_, i) => {
  const theta = (i / SAMPLES) * 2 * Math.PI;
  return { xM: RADIUS_M * Math.cos(theta), zM: RADIUS_M * Math.sin(theta) };
});

/** Position à l'abscisse sM, décalée de lateralM vers l'intérieur (côté gauche du sens de marche). */
const positionAt = (sM: number, lateralM = 0) => {
  const theta = sM / RADIUS_M;
  return { x: (RADIUS_M - lateralM) * Math.cos(theta), z: (RADIUS_M - lateralM) * Math.sin(theta) };
};

/** Fait rouler une voiture le long du circuit : sM(t) donné par la fonction, et renvoie les événements avec l'instant. */
function drive(timer: LapTimer, projector: TrackProjector, durationS: number, sAt: (t: number) => number, lateralM = 0, startT = 0) {
  const events: Array<{ t: number; event: LapTimerEvent }> = [];
  let hint: number | null = null;
  for (let t = startT; t < startT + durationS; t += DT) {
    const s = ((sAt(t) % LENGTH_M) + LENGTH_M) % LENGTH_M;
    const p = positionAt(s, lateralM);
    const projection = projector.project(p.x, p.z, hint);
    hint = projection.index;
    for (const event of timer.step(DT, projection.sM, projection.lateralM)) events.push({ t, event });
  }
  return events;
}

describe('TrackProjector', () => {
  const projector = new TrackProjector(centerline, LENGTH_M);

  it('retrouve l\'abscisse et l\'écart latéral signé', () => {
    for (const s of [0, 123.4, 900, 1700]) {
      const p = positionAt(s, 2.5);
      const projection = projector.project(p.x, p.z, null);
      expect(projection.sM).toBeCloseTo(s, 0);
      expect(projection.lateralM).toBeCloseTo(2.5, 1);
    }
    const right = positionAt(500, -3);
    expect(projector.project(right.x, right.z, null).lateralM).toBeCloseTo(-3, 1);
  });

  it('reste sur la portion locale et signale une recherche globale quand la voiture est très loin', () => {
    const near = positionAt(500);
    expect(projector.project(near.x, near.z, 160).global).toBe(false);
    const far = positionAt(1400);
    expect(projector.project(far.x, far.z, 100).global).toBe(true);
  });
});

describe('LapTimer', () => {
  const speed = 50;
  const lapS = LENGTH_M / speed;

  it('démarre à la ligne, puis chronomètre des tours réguliers avec trois secteurs', () => {
    const timer = new LapTimer(LENGTH_M, WIDTH_M);
    const projector = new TrackProjector(centerline, LENGTH_M);
    const events = drive(timer, projector, lapS * 2.5, (t) => LENGTH_M - 6 + speed * t);
    expect(events.filter((e) => e.event.type === 'lap-start')).toHaveLength(3);
    const laps = events.map((e) => e.event).filter((e): e is Extract<LapTimerEvent, { type: 'lap'; valid: true }> => e.type === 'lap' && e.valid);
    expect(laps).toHaveLength(2);
    expect(laps[0].lapS).toBeCloseTo(lapS, 1);
    expect(laps[1].lapS).toBeCloseTo(lapS, 1);
    expect(laps[0].sectorS).toHaveLength(3);
    expect(laps[0].sectorS.reduce((a, b) => a + b, 0)).toBeCloseTo(laps[0].lapS, 6);
    expect(laps[0].profileS[0]).toBe(0);
    expect(laps[0].profileS.at(-1)).toBeCloseTo(laps[0].lapS, 6);
    expect(laps[0].profileS).toHaveLength(61);
    expect(events.filter((e) => e.event.type === 'sector')).toHaveLength(5) // 2 intermédiaires par tour (le 3e secteur se ferme sur la ligne) : 2 + 2 + 1;
  });

  it('mesure le temps au pas près : le franchissement est interpolé dans le pas', () => {
    const timer = new LapTimer(LENGTH_M, WIDTH_M);
    const projector = new TrackProjector(centerline, LENGTH_M);
    // Vitesse telle que la ligne tombe au milieu d'un pas : 6,005 m avant la ligne à t = 0.
    const events = drive(timer, projector, lapS * 2.2, (t) => LENGTH_M - 6.005 + speed * t);
    const laps = events.map((e) => e.event).filter((e) => e.type === 'lap' && e.valid) as Array<{ lapS: number }>;
    expect(Math.abs(laps[0].lapS - lapS)).toBeLessThan(0.002);
  });

  it('ne compte pas un tour quand on recule sur la ligne puis qu\'on la repasse', () => {
    const timer = new LapTimer(LENGTH_M, WIDTH_M);
    const projector = new TrackProjector(centerline, LENGTH_M);
    // Avance jusqu'à 30 m après la ligne, recule de 60 m, repart : la ligne ne doit pas relancer ni terminer de tour.
    const path = (t: number) => {
      if (t < 1.2) return LENGTH_M - 6 + speed * t; // franchit la ligne (t ≈ 0,12 s) puis ≈ 54 m
      if (t < 2.4) return LENGTH_M - 6 + speed * 1.2 - speed * (t - 1.2); // recule
      return LENGTH_M - 6 + speed * (t - 1.2 * 2 + 0) - 0; // repart vers l'avant
    };
    const events = drive(timer, projector, 5, path);
    expect(events.filter((e) => e.event.type === 'lap-start')).toHaveLength(1);
    expect(events.filter((e) => e.event.type === 'lap')).toHaveLength(0);
  });

  it('invalide un tour dont la progression saute (raccourci) mais redémarre proprement au tour suivant', () => {
    const timer = new LapTimer(LENGTH_M, WIDTH_M);
    const projector = new TrackProjector(centerline, LENGTH_M);
    const cut = (t: number) => {
      const base = LENGTH_M - 6 + speed * t;
      return t > lapS * 0.3 ? base + 300 : base; // 300 m gagnés d'un coup
    };
    const events = drive(timer, projector, lapS * 2.6, cut);
    const kinds = events.map((e) => e.event);
    expect(kinds.some((e) => e.type === 'invalid' && e.reason === 'raccourci')).toBe(true);
    const completed = kinds.filter((e) => e.type === 'lap');
    expect(completed[0]).toMatchObject({ valid: false, reason: 'raccourci' });
    expect(completed.at(-1)).toMatchObject({ valid: true });
  });

  it('invalide un tour passé trop longtemps hors piste', () => {
    const timer = new LapTimer(LENGTH_M, WIDTH_M);
    const projector = new TrackProjector(centerline, LENGTH_M);
    const offStart = 4;
    const events: Array<{ t: number; event: LapTimerEvent }> = [];
    let hint: number | null = null;
    for (let t = 0; t < lapS * 1.2; t += DT) {
      const s = (LENGTH_M - 6 + speed * t) % LENGTH_M;
      const off = t > offStart && t < offStart + MAX_OFF_TRACK_S + 2;
      const p = positionAt(s, off ? WIDTH_M : 0);
      const projection = projector.project(p.x, p.z, hint);
      hint = projection.index;
      for (const event of timer.step(DT, projection.sM, projection.lateralM)) events.push({ t, event });
    }
    const lap = events.map((e) => e.event).find((e) => e.type === 'lap');
    expect(lap).toMatchObject({ valid: false, reason: 'hors piste' });
  });

  it('tolère une sortie brève hors piste', () => {
    const timer = new LapTimer(LENGTH_M, WIDTH_M);
    const projector = new TrackProjector(centerline, LENGTH_M);
    const events: LapTimerEvent[] = [];
    let hint: number | null = null;
    for (let t = 0; t < lapS * 1.2; t += DT) {
      const s = (LENGTH_M - 6 + speed * t) % LENGTH_M;
      const p = positionAt(s, t > 5 && t < 8 ? WIDTH_M : 0);
      const projection = projector.project(p.x, p.z, hint);
      hint = projection.index;
      events.push(...timer.step(DT, projection.sM, projection.lateralM));
    }
    expect(events.find((e) => e.type === 'lap')).toMatchObject({ valid: true });
  });

  it('un repositionnement perd le tour et attend la ligne pour repartir', () => {
    const timer = new LapTimer(LENGTH_M, WIDTH_M);
    const projector = new TrackProjector(centerline, LENGTH_M);
    const first = drive(timer, projector, lapS * 0.5, (t) => LENGTH_M - 6 + speed * t);
    expect(first.some((e) => e.event.type === 'lap-start')).toBe(true);
    timer.reposition();
    expect(timer.snapshot().started).toBe(false);
    const second = drive(timer, projector, lapS * 1.3, (t) => LENGTH_M - 6 + speed * (t - lapS * 0.5), 0, lapS * 0.5);
    const kinds = [...first, ...second].map((e) => e.event);
    expect(kinds.filter((e) => e.type === 'invalid')).toHaveLength(1);
    expect(kinds.filter((e) => e.type === 'lap' && e.valid)).toHaveLength(1);
  });

  it('calcule l\'écart au tour de référence par interpolation du profil', () => {
    const profile = [0, 10, 20, 30];
    expect(deltaToProfile(profile, 0.5, 15.5)).toBeCloseTo(0.5 + (15 - 15), 6);
    expect(deltaToProfile(profile, 1 / 3, 9)).toBeCloseTo(-1, 6);
    expect(deltaToProfile([0], 0.5, 3)).toBeNull();
  });

  it('formate les temps', () => {
    expect(formatLapTime(83.456)).toBe('1:23.456');
    expect(formatLapTime(5)).toBe('0:05.000');
    expect(formatLapTime(null)).toBe('–:––.–––');
    expect(formatDelta(-0.12)).toBe('−0.120');
    expect(formatDelta(0.3125)).toBe('+0.313');
    expect(formatDelta(null)).toBe('');
  });
});

describe('records', () => {
  const memory = (): KeyValueStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  };
  const lap = { bestS: 90, sectorS: [30, 30, 30], profileS: [0, 45, 90] };

  it('enregistre un meilleur tour seulement s\'il bat le précédent', () => {
    const key = recordKey('monaco', 'sedan');
    const first = withLap({}, key, lap, 1);
    expect(first.improved).toBe(true);
    expect(withLap(first.book, key, { ...lap, bestS: 91 }, 2).improved).toBe(false);
    const better = withLap(first.book, key, { ...lap, bestS: 89.5 }, 3);
    expect(better.improved).toBe(true);
    expect(better.book[key].bestS).toBe(89.5);
  });

  it('rejette un tour implausible', () => {
    expect(withLap({}, 'a|b', { ...lap, bestS: MIN_PLAUSIBLE_LAP_S - 1 }, 0).improved).toBe(false);
  });

  it('sauvegarde et relit, et ignore les données corrompues ou d\'une autre version', () => {
    const storage = memory();
    const book = withLap({}, 'a|b', lap, 5).book;
    saveRecords(book, storage);
    expect(loadRecords(storage)['a|b']?.bestS).toBe(90);
    storage.data.set('cardrive.records', '{pas du json');
    expect(loadRecords(storage)).toEqual({});
    storage.data.set('cardrive.records', JSON.stringify({ version: 99, records: { 'a|b': lap } }));
    expect(loadRecords(storage)).toEqual({});
    storage.data.set('cardrive.records', JSON.stringify({ version: 1, records: { bad: { bestS: 'x' }, ok: { ...lap, setAtMs: 1 } } }));
    expect(Object.keys(loadRecords(storage))).toEqual(['ok']);
  });

  it('ne plante pas sans stockage ou si l\'écriture échoue', () => {
    expect(loadRecords(null)).toEqual({});
    expect(() => saveRecords({}, null)).not.toThrow();
    const broken: KeyValueStorage = { getItem: () => { throw new Error('refusé'); }, setItem: () => { throw new Error('plein'); } };
    expect(loadRecords(broken)).toEqual({});
    expect(() => saveRecords({}, broken)).not.toThrow();
  });
});

describe('fantôme', () => {
  it('enregistre à 20 Hz, s\'encode, se décode et se rejoue par interpolation', async () => {
    const { GhostRecorder, encodeGhost, decodeGhost, sampleGhost, GHOST_HZ } = await import('../src/race/ghost');
    const recorder = new GhostRecorder();
    const dt = 1 / 60;
    const lapS = 10;
    for (let t = 0; t <= lapS; t += dt) recorder.add(t, 10 * t, 3 * Math.sin(t), 0.1 * t - 0.5);
    const ghost = recorder.finish(lapS);
    expect(ghost.samples.length).toBeGreaterThanOrEqual(lapS * GHOST_HZ);
    expect(ghost.samples.length).toBeLessThanOrEqual(lapS * GHOST_HZ + 2);
    const decoded = decodeGhost(JSON.parse(JSON.stringify(encodeGhost(ghost, 1))));
    expect(decoded.samples).toHaveLength(ghost.samples.length);
    const at = sampleGhost(decoded, 4.37)!;
    expect(at.xM).toBeCloseTo(43.7, 0);
    expect(at.zM).toBeCloseTo(3 * Math.sin(4.37), 0);
    expect(at.headingRad).toBeCloseTo(0.1 * 4.37 - 0.5, 1);
    expect(sampleGhost(decoded, -1)).toBeNull();
    expect(sampleGhost(decoded, lapS + 5)).toBeNull();
  });

  it('interpole le cap par le plus court chemin autour de ±π', async () => {
    const { sampleGhost } = await import('../src/race/ghost');
    const ghost = { lapS: 1, samples: [{ xM: 0, zM: 0, headingRad: Math.PI - 0.1 }, { xM: 0, zM: 0, headingRad: -Math.PI + 0.1 }] };
    const mid = sampleGhost(ghost, 1 / 40)!;
    expect(Math.abs(Math.abs(mid.headingRad) - Math.PI)).toBeLessThan(1e-9);
  });

  it('limite le nombre de fantômes conservés et ignore les données corrompues', async () => {
    const { loadGhosts, saveGhosts, withGhost, MAX_GHOSTS } = await import('../src/race/ghost');
    let book = {};
    for (let i = 0; i < MAX_GHOSTS + 3; i += 1) book = withGhost(book, `k${i}`, { lapS: 60, d: [0, 0, 0, 1, 1, 1], setAtMs: i });
    expect(Object.keys(book)).toHaveLength(MAX_GHOSTS);
    expect(Object.keys(book)).not.toContain('k0');
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    expect(saveGhosts(book, storage)).toBe(true);
    expect(Object.keys(loadGhosts(storage))).toHaveLength(MAX_GHOSTS);
    data.set('cardrive.ghosts', JSON.stringify({ version: 1, ghosts: { bad: { lapS: 1, d: [1, 2] }, ok: { lapS: 60, d: [0, 0, 0, 1, 1, 1], setAtMs: 1 } } }));
    expect(Object.keys(loadGhosts(storage))).toEqual(['ok']);
    expect(saveGhosts({}, null)).toBe(false);
  });
});

describe('grille de départ', () => {
  it('place les voitures sur la piste, derrière la ligne, sans chevauchement', async () => {
    const { buildGrid } = await import('../src/race/grid');
    const { buildCircuitTrack } = await import('../src/circuits/circuitGeometry');
    const { F1_CIRCUITS_2026 } = await import('../src/circuits/f1Circuits2026');
    for (const id of ['mc-1929', 'jp-1962', 'sg-2008']) {
      const track = buildCircuitTrack(F1_CIRCUITS_2026.find((c) => c.id === id)!);
      const slots = buildGrid(track, 8);
      const projector = new TrackProjector(track.centerline, track.lengthM);
      expect(slots).toHaveLength(8);
      slots.forEach((slot) => {
        const projection = projector.project(slot.xM, slot.zM, null);
        // Sur la piste : écart latéral sous la demi-largeur.
        expect(Math.abs(projection.lateralM)).toBeLessThan(track.widthM / 2);
        // Derrière la ligne : l'abscisse projetée vaut la longueur du tour moins la distance à la ligne.
        const behind = (track.lengthM - projection.sM) % track.lengthM;
        expect(behind).toBeCloseTo(-slot.sM, 0);
        expect(slot.sM).toBeLessThan(0);
      });
      for (let i = 0; i < slots.length; i += 1) {
        for (let j = i + 1; j < slots.length; j += 1) {
          expect(Math.hypot(slots[i].xM - slots[j].xM, slots[i].zM - slots[j].zM)).toBeGreaterThan(4.5);
        }
      }
      // La pole est la plus proche de la ligne.
      expect(slots[0].sM).toBeGreaterThan(slots[7].sM);
    }
  });
});

describe('RaceTracker', () => {
  const lengthM = 1000;

  async function make(laps = 2) {
    const { RaceTracker } = await import('../src/race/raceModel');
    const tracker = new RaceTracker(lengthM, laps);
    ['a', 'b', 'c'].forEach((id) => tracker.addCar(id));
    return tracker;
  }

  it('allume les feux puis donne le départ au bout du délai', async () => {
    const { RaceTracker } = await import('../src/race/raceModel');
    const tracker = await make();
    expect(tracker.currentPhase).toBe('countdown');
    expect(tracker.lightsOn).toBe(1);
    for (let t = 0; t < 1.0; t += 0.01) tracker.tick(0.01);
    expect(tracker.lightsOn).toBe(2);
    for (let t = 0; t < RaceTracker.countdownS; t += 0.01) tracker.tick(0.01);
    expect(tracker.currentPhase).toBe('racing');
    expect(tracker.lightsOn).toBe(0);
    expect(tracker.raceTimeS).toBeGreaterThanOrEqual(0);
  });

  it('classe par distance, compte les tours et fixe l\'arrivée', async () => {
    const { RaceTracker } = await import('../src/race/raceModel');
    const tracker = await make(2);
    tracker.update('a', 994, 0, 0); tracker.update('b', 988, 0, 0); tracker.update('c', 982, 0, 0); // grille : -6, -12, -18 m
    for (let t = 0; t < RaceTracker.countdownS + 0.1; t += 0.01) tracker.tick(0.01);
    // a roule à 40 m/s, b à 35, c à 30 : 2 tours = 2000 m.
    const speeds: Record<string, number> = { a: 40, b: 35, c: 30 };
    const start: Record<string, number> = { a: -6, b: -12, c: -18 };
    for (let t = 0; t < 60; t += 0.05) {
      tracker.tick(0.05);
      for (const id of ['a', 'b', 'c']) {
        const distance = start[id] + speeds[id] * t;
        tracker.update(id, ((distance % lengthM) + lengthM) % lengthM, 0, 0);
      }
    }
    const standings = tracker.standings();
    expect(standings.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(standings[0].finishS).not.toBeNull();
    expect(standings[0].finishS!).toBeCloseTo((2000 + 6) / 40, 0);
    expect(standings[1].finishS).not.toBeNull();
    expect(standings[2].finishS).toBeNull(); // c : 2018 m à 30 m/s = 67 s, pas encore arrivé après 60 s
  });

  it('un faux départ ajoute une pénalité et reclasse', async () => {
    const { RaceTracker, FALSE_START_PENALTY_S } = await import('../src/race/raceModel');
    const tracker = await make(1);
    tracker.update('a', 994, 0, 0); tracker.update('b', 988, 5, 0); tracker.update('c', 982, 10, 0);
    tracker.tick(0.5);
    tracker.update('a', 999, 6, 0); // a bouge de 6 m avant le départ
    expect(tracker.progressOf('a')!.falseStart).toBe(true);
    expect(tracker.progressOf('a')!.penaltyS).toBe(FALSE_START_PENALTY_S);
    expect(tracker.progressOf('b')!.falseStart).toBe(false);
    void RaceTracker;
  });

  it('ne perd pas la distance au passage de la ligne', async () => {
    const { RaceTracker } = await import('../src/race/raceModel');
    const tracker = await make(3);
    tracker.update('a', 990, 0, 0);
    for (let t = 0; t < RaceTracker.countdownS + 0.1; t += 0.01) tracker.tick(0.01);
    tracker.update('a', 5, 0, 0); // franchit la ligne
    expect(tracker.progressOf('a')!.distanceM).toBeCloseTo(5, 6); // grille à -10 m, +15 m parcourus
    tracker.update('a', 999, 0, 0); // recule jusqu'avant la ligne
    expect(tracker.progressOf('a')!.distanceM).toBeCloseTo(-1, 6);
  });
});

describe('réglages de course', () => {
  it('assainit des réglages invalides et retombe sur les valeurs par défaut', async () => {
    const { sanitizeRaceSetup, DEFAULT_RACE_SETUP, loadRaceSetup, saveRaceSetup } = await import('../src/race/raceSetup');
    expect(sanitizeRaceSetup(null)).toEqual(DEFAULT_RACE_SETUP);
    expect(sanitizeRaceSetup({ mode: 'race', laps: 99, rivals: 7, difficulty: 'hard' })).toEqual({ mode: 'race', laps: 3, rivals: 7, difficulty: 'hard' });
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    saveRaceSetup({ mode: 'race', laps: 5, rivals: 3, difficulty: 'easy' }, storage);
    expect(loadRaceSetup(storage)).toEqual({ mode: 'race', laps: 5, rivals: 3, difficulty: 'easy' });
    data.set('cardrive.raceSetup', '{pas du json');
    expect(loadRaceSetup(storage)).toEqual(DEFAULT_RACE_SETUP);
  });

  it('construit une grille : adversaires devant du plus au moins rapide, joueur en dernier', async () => {
    const { buildRaceField } = await import('../src/race/raceSetup');
    const { buildCircuitTrack } = await import('../src/circuits/circuitGeometry');
    const { F1_CIRCUITS_2026 } = await import('../src/circuits/f1Circuits2026');
    const track = buildCircuitTrack(F1_CIRCUITS_2026.find((c) => c.id === 'mc-1929')!);
    const field = buildRaceField({ mode: 'race', laps: 3, rivals: 5, difficulty: 'normal' }, track);
    expect(field.opponents).toHaveLength(5);
    expect(field.opponents.map((o) => o.id)).toEqual(['ai-1', 'ai-2', 'ai-3', 'ai-4', 'ai-5']);
    const skills = field.opponents.map((o) => o.skill);
    expect([...skills].sort((a, b) => b - a)).toEqual(skills);
    expect(skills.every((s) => s >= 0 && s <= 1)).toBe(true);
    expect(field.playerSlot.index).toBe(5);
    expect(field.playerSlot.sM).toBeLessThan(field.opponents[4].slot.sM);
  });
});
