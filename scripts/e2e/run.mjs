// Tests de bout en bout : sert le build (vite preview), pilote Chrome, parcourt menu → garage → circuits → conduite → pause,
// échoue sur toute erreur de console, tout écran vide, toute régression visuelle des écrans d'interface, tout dépassement
// grossier du budget physique. Usage : npm run e2e  |  npm run e2e:update (rafraîchit les images de référence)
//   Options : --update  --gpu (rendu matériel : seul mode où les FPS sont représentatifs)  --network (scénario ville réelle)
//             --full-lap (un tour complet de Monaco piloté par le pilote automatique : chrono, record, fantôme)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchPage, sleep } from './cdp.mjs';
import { answerNominatim, answerOverpass, OBSTACLE, setObstacle } from './syntheticCity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const baselineDir = join(here, 'baseline');
const outputDir = join(here, 'output');
const args = new Set(process.argv.slice(2));
/** --only=texte : n'exécute que les scénarios dont le nom contient ce texte. */
const ONLY = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
const UPDATE = args.has('--update');
const GPU = args.has('--gpu');
const NETWORK = args.has('--network');
/** --full-lap : ajoute un tour complet piloté par le pilote automatique (≈ 4 min) : chrono, record, fantôme. */
const FULL_LAP = args.has('--full-lap');
/** Le catalogue = le prototype procédural + un modèle GLB par véhicule du kit. */
const VEHICLE_COUNT = readdirSync(join(root, 'public', 'models', 'cars')).filter((name) => name.endsWith('.glb')).length + 1;
const CIRCUIT_COUNT = 24;
/** Durée de la conduite prolongée du scénario ville (--drive=secondes) : franchir le seuil de recentrage demande ~1,3 km. */
const DRIVE_MS = Number(process.argv.find((arg) => arg.startsWith('--drive='))?.slice('--drive='.length) ?? 45) * 1_000;
const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/`;
/** Proportion maximale de pixels différents d'une capture d'interface par rapport à sa référence. */
const MAX_DIFFERENT_PIXELS = 0.004;
/** Les budgets physiques sont relâchés ×3 ici : en rendu logiciel le même processeur dessine ET simule. */
const E2E_PHYSICS_BUDGET_FACTOR = 3;

mkdirSync(baselineDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });

let currentPage = null;
const results = [];
/** Repart toujours d'une page neuve (état d'application et stockage local conservés) : un scénario qui échoue n'en fait pas échouer d'autres. */
async function home(page) {
  await page.goto(URL);
  await page.waitFor("document.querySelector('.menu-row')", 'le menu principal');
}

async function scenario(name, run) {
  if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  const start = Date.now();
  try {
    const detail = await run();
    results.push({ name, ok: true, detail: detail ?? '', seconds: ((Date.now() - start) / 1000).toFixed(1) });
  } catch (error) {
    // Capture de l'état au moment de l'échec, pour le diagnostic.
    try { writeFileSync(join(outputDir, `echec-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`), await currentPage?.screenshot()); } catch { /* page indisponible */ }
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error), seconds: ((Date.now() - start) / 1000).toFixed(1) });
  }
}

async function startPreview() {
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(URL)).ok) return server; } catch { /* démarrage */ }
    await sleep(150);
  }
  server.kill();
  throw new Error('vite preview n\'a pas démarré (build manquant ? lancer npm run build).');
}

/** Écart entre deux PNG calculé dans la page (canvas) : aucune bibliothèque d'image nécessaire. */
async function differentPixelRatio(page, expected, actual) {
  const toUrl = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
  return page.eval(`(async () => {
    const load = (src) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
    const [a, b] = await Promise.all([load(${JSON.stringify(toUrl(expected))}), load(${JSON.stringify(toUrl(actual))})]);
    if (a.width !== b.width || a.height !== b.height) return 1;
    const read = (image) => { const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const x = c.getContext('2d'); x.drawImage(image, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const da = read(a); const db = read(b);
    let different = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 10 || Math.abs(da[i + 1] - db[i + 1]) > 10 || Math.abs(da[i + 2] - db[i + 2]) > 10) different += 1;
    return different / (da.length / 4);
  })()`);
}

/** Statistiques de luminance d'une capture : détecte un écran vide (noir uni) ou un rendu 3D absent. */
async function luminanceSpread(page, buffer) {
  return page.eval(`(async () => {
    const image = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = ${JSON.stringify(`data:image/png;base64,${buffer.toString('base64')}`)}; });
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const x = c.getContext('2d'); x.drawImage(image, 0, 0);
    const data = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0; let sumSq = 0; const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) { const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; sum += l; sumSq += l * l; }
    const mean = sum / n; return { mean, deviation: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
  })()`);
}

async function checkBaseline(page, name) {
  await sleep(700); // fin des transitions CSS
  const actual = await page.screenshot();
  writeFileSync(join(outputDir, `${name}.png`), actual);
  const baselinePath = join(baselineDir, `${name}.png`);
  if (UPDATE || !existsSync(baselinePath)) {
    writeFileSync(baselinePath, actual);
    return `référence ${UPDATE ? 'mise à jour' : 'créée'}`;
  }
  const ratio = await differentPixelRatio(page, readFileSync(baselinePath), actual);
  if (ratio > MAX_DIFFERENT_PIXELS) throw new Error(`${(ratio * 100).toFixed(2)} % de pixels différents de la référence (max ${(MAX_DIFFERENT_PIXELS * 100).toFixed(1)} %) — voir scripts/e2e/output/${name}.png`);
  return `écart ${(ratio * 100).toFixed(3)} %`;
}

/** Erreurs de console attendues d'un service tiers instable (miroirs Overpass publics : CORS sur une page 500, 504, délais) : l'application les contourne. */
const THIRD_PARTY_NOISE = /overpass|nominatim|openstreetmap|CORS policy|Failed to load resource/i;
const assertNoProblems = (page, where, { ignoreThirdParty = false } = {}) => {
  const found = page.problems.splice(0).filter((problem) => !(ignoreThirdParty && THIRD_PARTY_NOISE.test(problem)));
  if (found.length > 0) throw new Error(`${where} : ${found.length} problème(s) de console :\n  - ${found.slice(0, 5).join('\n  - ')}`);
};

/** Ouvre ou ferme le panneau de performance (F3) selon son état courant. */
async function setPerfOverlay(page, open) {
  const isOpen = await page.eval("Boolean(document.querySelector('[data-perf-overlay]'))");
  if (isOpen !== open) await page.tap('F3', 'F3');
  if (open) await page.waitFor("document.querySelector('[data-perf-overlay]')", 'le panneau de performance (F3)');
}

/** Lit la ligne « Son » du panneau : état du contexte audio, fréquence du moteur (Hz), crissement, niveau de sortie (dBFS). */
async function readAudio(page) {
  const text = await page.eval("document.querySelector('[data-perf=\"audio\"]')?.textContent ?? ''");
  const [state, hz, squeal, level] = text.replace(/[\s\u202f\u00a0]/g, '').replace(/−/g, '-').split('·');
  return { state, hz: Number.parseFloat(hz), squeal: Number.parseFloat(squeal), level: level?.includes('∞') ? -120 : Number.parseFloat(level), text };
}

async function readPerf(page) {
  await setPerfOverlay(page, true);
  await sleep(1_800);
  const read = (id) => page.eval(`document.querySelector('[data-perf="${id}"]')?.textContent ?? ''`);
  // Le séparateur de milliers français est une espace insécable fine (U+202F) : on retire toutes les espaces avant d'extraire les nombres.
  const numbers = (text) => (text.replace(/[\s\u202f\u00a0]/g, '').match(/[\d.,]+/g) ?? []).map((value) => Number.parseFloat(value.replace(',', '.')));
  const [fps] = numbers(await read('fps'));
  const [, frameP95] = numbers(await read('frame-p95'));
  const [physicsAverage] = numbers(await read('physics-ms'));
  const [vehicleSolver] = numbers(await read('vehicle-ms'));
  const [triangles] = numbers(await read('triangles'));
  const [drawCalls] = numbers(await read('draw-calls'));
  const audioText = (await readAudio(page)).text;
  await setPerfOverlay(page, false);
  return { fps, frameP95, physicsAverage, vehicleSolver, triangles, drawCalls, audioText };
}

async function driveAndCheck(page, label, options = {}) {
  let audioSummary;
  await page.waitFor("document.querySelector('.hud-layer')", 'le tableau de bord', 90_000);
  await page.waitFor("document.querySelector('.game-canvas canvas')", 'le canevas 3D');
  // La scène (chargement paresseux du moteur 3D, WebAssembly, modèles) met plusieurs secondes à devenir active en rendu
  // logiciel : on maintient l'accélérateur jusqu'à voir la vitesse monter, au lieu d'attendre une durée fixe.
  await page.waitFor("!document.querySelector('.scene-loading')", 'la fin du chargement de la scène', 90_000);
  await setPerfOverlay(page, true);
  await sleep(1_200);
  // En rendu logiciel, la scène met du temps à produire ses premières images : le contexte audio ne démarre qu'alors.
  let idleAudio = await readAudio(page);
  for (let attempt = 0; attempt < 40 && idleAudio.state !== 'running'; attempt += 1) { await sleep(500); idleAudio = await readAudio(page); }
  const startedAt = Date.now();
  await page.key('keyDown', 'KeyW', 'w');
  let speed = 0;
  const trace = [];
  while (Date.now() - startedAt < 40_000 && speed < 25) {
    await sleep(250);
    speed = Number(await page.eval("document.querySelector('.speed b')?.textContent ?? '0'"));
    trace.push(`${((Date.now() - startedAt) / 1000).toFixed(1)}s:${speed}`);
  }
  const secondsToTwentyFive = (Date.now() - startedAt) / 1000;
  if (!(speed >= 25)) {
    await page.key('keyUp', 'KeyW', 'w');
    throw new Error(`${label} : la voiture n'a pas accéléré (vitesse affichée ${speed} km/h après ${secondsToTwentyFive.toFixed(0)} s de plein gaz). Trace : ${trace.filter((_, i) => i % 12 === 0).join(' ')}`);
  }
  await sleep(1_500);
  const drivingAudio = await readAudio(page);
  await page.key('keyUp', 'KeyW', 'w');
  await setPerfOverlay(page, false);
  // Le son doit exister (contexte en marche, niveau de sortie audible) et suivre le moteur : plus aigu en accélérant qu'au ralenti.
  if (idleAudio.state !== 'running' || drivingAudio.state !== 'running') throw new Error(`${label} : le contexte audio n'est pas en marche (${idleAudio.state} / ${drivingAudio.state}).`);
  if (!(drivingAudio.level > -50)) throw new Error(`${label} : aucun son audible en conduite (niveau ${drivingAudio.level} dBFS).`);
  if (!(drivingAudio.hz > idleAudio.hz * 1.5)) throw new Error(`${label} : le moteur ne monte pas en hauteur (${idleAudio.hz} Hz au ralenti, ${drivingAudio.hz} Hz en accélérant).`);
  audioSummary = `moteur ${idleAudio.hz.toFixed(0)} → ${drivingAudio.hz.toFixed(0)} Hz, niveau ${drivingAudio.level.toFixed(0)} dBFS`;
  const shot = await page.screenshot();
  writeFileSync(join(outputDir, `${label}.png`), shot);
  const spread = await luminanceSpread(page, shot);
  if (spread.deviation < 12) throw new Error(`${label} : rendu quasi uniforme (écart-type de luminance ${spread.deviation.toFixed(1)}) — scène vide ?`);
  assertNoProblems(page, label, options);
  const perf = await readPerf(page);
  if (perf.vehicleSolver > 1 * E2E_PHYSICS_BUDGET_FACTOR) throw new Error(`${label} : solveur véhicule ${perf.vehicleSolver} ms/pas (budget ${E2E_PHYSICS_BUDGET_FACTOR} ms).`);
  if (perf.physicsAverage > 4 * E2E_PHYSICS_BUDGET_FACTOR) throw new Error(`${label} : pas physique ${perf.physicsAverage} ms (budget ${4 * E2E_PHYSICS_BUDGET_FACTOR} ms).`);
  return `${audioSummary} · 25 km/h atteints en ${secondsToTwentyFive.toFixed(1)} s · ${perf.fps.toFixed(0)} img/s · pas physique ${perf.physicsAverage.toFixed(2)} ms · solveur ${perf.vehicleSolver.toFixed(3)} ms · ${perf.triangles.toLocaleString('fr-FR')} triangles`;
}


const TRANSPARENT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Réponses locales de la ville synthétique (voir syntheticCity.mjs) aux requêtes Overpass, Nominatim et aux tuiles OSM. */
const syntheticServices = ({ url, body }) => {
  if (url.includes('nominatim')) return { body: JSON.stringify(answerNominatim()) };
  if (url.includes('overpass')) return { body: JSON.stringify(answerOverpass(decodeURIComponent(body.replace(/^data=/, '').replaceAll('+', ' ')))) };
  if (url.includes('tile.openstreetmap.org')) return { contentType: 'image/png', body: TRANSPARENT_PNG };
  return null;
};

/**
 * Conduite en ville. `live = false` : ville synthétique servie localement (déterministe, hors ligne) avec assertions strictes
 * sur le streaming : franchissements de frontières de chunks, recentrage de l'origine flottante, aucun chunk en échec.
 * `live = true` (--network) : vraie ville via Overpass et Nominatim, assertions assouplies (les services publics sont instables).
 */
async function cityScenario(live) {
  const name = live ? 'Ville réelle (réseau : Overpass, Nominatim)' : 'Ville synthétique (streaming, franchissements, recentrage)';
  await scenario(name, async () => {
    page.mock = live ? null : syntheticServices;
    try {
      // Véhicule fixé (le prototype) : le résultat ne dépend pas des scénarios précédents, qui mémorisent leur choix (camion : 120 km/h max).
      await home(page);
      await page.eval("localStorage.setItem('cardrive.selectedCar', 'prototype')");
      await home(page);
      await page.click('Lieu réel');
      await page.waitFor("document.querySelector('input[type=search]')", 'le champ de recherche');
      const query = live ? 'Rue de Rivoli, Paris' : 'Avenue de test';
      await page.eval(`(() => { const input = document.querySelector('input[type=search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ${JSON.stringify(query)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await page.waitFor("document.querySelector('.option')", "une suggestion d'adresse", 30_000);
      await page.eval("document.querySelector('.option').click()");
      // Les miroirs Overpass publics échouent souvent (500, 504, CORS sur une page d'erreur) : comme un utilisateur, on clique sur
      // « Réessayer » quand l'écran d'erreur apparaît (jusqu'à 4 tentatives), et on ne juge que le résultat final.
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await page.waitFor("document.querySelector('.hud-layer') || document.querySelector('.scene-error')", "le chargement de la ville ou un écran d'erreur", 120_000);
        if (await page.eval("Boolean(document.querySelector('.hud-layer'))")) break;
        const errorText = await page.eval("document.querySelector('.scene-error')?.innerText ?? ''");
        if (attempt === 4) throw new Error(`Le chargement de la ville a échoué ${attempt} fois de suite. Dernier écran d'erreur : « ${errorText.split(String.fromCharCode(10)).join(' / ')} ». Console : ${page.consoleLog.slice(-6).join(' | ')} ${page.problems.slice(-3).join(' | ')}`);
        await page.click('Réessayer');
      }
      const label = live ? 'ville-paris' : 'ville-synthetique';
      const detail = await driveAndCheck(page, label, { ignoreThirdParty: live });
      // Conduite prolongée : franchir plusieurs frontières de chunks (256 m) et le seuil de recentrage de l'origine flottante (1 km).
      await page.tap('F3', 'F3');
      await page.waitFor("document.querySelector('[data-perf-overlay]')", 'le panneau de performance');
      const readWorld = async () => {
        const chunks = await page.eval("document.querySelector('[data-perf=\"chunks\"]')?.textContent ?? ''");
        const build = await page.eval("document.querySelector('[data-perf=\"chunk-build\"]')?.textContent ?? ''");
        const [active, failed, crossings, recenters] = chunks.replace(/[\s\u202f\u00a0]/g, '').split('·').map(Number);
        const maxBuild = Number.parseFloat((build.split('·')[1] ?? '0').replace(',', '.'));
        const [recenterJump, steadyJump] = (await page.eval("document.querySelector('[data-perf=\"jump\"]')?.textContent ?? ''")).replace(',', '.').match(/[\d.]+/g)?.map(Number) ?? [0, 0];
        return { active, failed, crossings, recenters, maxBuild, recenterJump, steadyJump };
      };
      const before = await readWorld();
      const startedAt = Date.now();
      await page.key('keyDown', 'KeyW', 'w');
      let unavailable = false;
      let topSpeed = 0;
      while (Date.now() - startedAt < DRIVE_MS) {
        await sleep(1_000);
        topSpeed = Math.max(topSpeed, Number(await page.eval("document.querySelector('.speed b')?.textContent ?? '0'")));
        if (await page.eval("Boolean(document.querySelector('.toast'))")) unavailable = true;
      }
      // Capture en fin de conduite, voiture encore loin de l'origine : permet de vérifier à l'œil que l'éclairage et les ombres suivent la voiture.
      writeFileSync(join(outputDir, `${label}-fin.png`), await page.screenshot());
      await page.key('keyUp', 'KeyW', 'w');
      await sleep(600);
      const after = await readWorld();
      await page.tap('F3', 'F3');
      assertNoProblems(page, `${label} (conduite prolongée)`, { ignoreThirdParty: live });
      const crossed = after.crossings - before.crossings;
      const recentered = after.recenters - before.recenters;
      if (!(after.active >= 9)) throw new Error(`Moins de 9 chunks actifs (le voisinage physique 3×3 doit toujours être chargé) : ${after.active}.`);
      if (after.maxBuild > 100) throw new Error(`Génération d'un chunk trop longue : ${after.maxBuild} ms (budget indicatif 25 ms, alerte à 100 ms).`);
      if (!live) {
        if (topSpeed < 100) throw new Error(`Sur une avenue droite la voiture aurait dû dépasser 100 km/h (max ${topSpeed} km/h) : elle s'est arrêtée (chunk manquant, collision ?).`);
        if (crossed < 3) throw new Error(`Au moins 3 frontières de chunk attendues, ${crossed} franchies.`);
        if (after.recenterJump > 5) throw new Error(`Discontinuité visuelle au recentrage : le vecteur voiture→caméra saute de ${after.recenterJump} m entre deux images (conduite normale : ${after.steadyJump} m).`);
        if (recentered < 1) throw new Error(`Aucun recentrage de l'origine flottante (seuil 1 km) malgré ${crossed} frontières franchies.`);
        if (after.failed > 0) throw new Error(`${after.failed} chunk(s) en échec alors que le service est local.`);
        if (unavailable) throw new Error('Le bandeau « zone suivante indisponible » est apparu.');
      }
      return `${detail}\n    conduite ${DRIVE_MS / 1000} s : vitesse max ${topSpeed} km/h · chunks actifs ${before.active} → ${after.active} · en échec ${after.failed} · frontières de chunk franchies ${crossed} · recentrages ${recentered} · génération max ${after.maxBuild} ms · saut caméra au recentrage ${after.recenterJump} m (conduite normale : ${after.steadyJump} m)${unavailable ? ' · AVERTISSEMENT « zone indisponible » affiché' : ''}`;
    } finally {
      page.mock = null;
    }
  });
}

const server = await startPreview();
const page = await launchPage({ gpu: GPU });
currentPage = page;
await page.intercept(['*overpass*', '*nominatim*', '*tile.openstreetmap.org*']);
try {
  await page.goto(URL);
  await scenario('Menu principal', async () => {
    await home(page);
    await page.waitFor("document.querySelector('h1')?.textContent.includes('Prenez la route.')", 'le titre du menu');
    assertNoProblems(page, 'menu');
    const rows = await page.eval("document.querySelectorAll('.menu-row').length");
    if (rows !== 4) throw new Error(`4 entrées de menu attendues, ${rows} trouvées.`);
    return checkBaseline(page, 'menu');
  });

  await scenario(`Garage (${VEHICLE_COUNT} véhicules, caractéristiques)`, async () => {
    await home(page);
    if (!(await page.click('Garage'))) throw new Error('Entrée « Garage » introuvable.');
    await page.waitFor(`document.querySelectorAll('.car-card').length === ${VEHICLE_COUNT}`, `${VEHICLE_COUNT} cartes de véhicules`);
    const specs = await page.eval("[...document.querySelectorAll('.car-card-specs')].every((node) => /\\d+ kW · .* kg/.test(node.textContent))");
    if (!specs) throw new Error('Une carte n\'affiche pas puissance et masse.');
    await page.waitFor("[...document.images].every((image) => image.complete && image.naturalWidth > 0)", 'les vignettes');
    assertNoProblems(page, 'garage');
    const detail = await checkBaseline(page, 'garage');
    await page.eval("document.querySelector('.back-button').click()");
    return detail;
  });

  await scenario(`Catalogue de circuits (${CIRCUIT_COUNT})`, async () => {
    await home(page);
    if (!(await page.click('Circuits F1 2026'))) throw new Error('Entrée « Circuits F1 2026 » introuvable.');
    await page.waitFor(`document.querySelectorAll('.circuit-card').length === ${CIRCUIT_COUNT}`, `${CIRCUIT_COUNT} cartes de circuits`);
    assertNoProblems(page, 'circuits');
    const detail = await checkBaseline(page, 'circuits');
    return detail;
  });

  await scenario('Conduite sur un circuit (Monaco)', async () => {
    await home(page);
    await page.click('Circuits F1 2026');
    await page.waitFor("document.querySelector('.circuit-card')", 'le catalogue de circuits');
    if (!(await page.click('Monaco'))) throw new Error('Circuit de Monaco introuvable.');
    const detail = await driveAndCheck(page, 'circuit-monaco');
    const minimap = await page.eval("Boolean(document.querySelector('.minimap-canvas'))");
    if (!minimap) throw new Error('Mini-carte du circuit absente.');
    return detail;
  });

  await scenario('Dérapage (grincement, fumée, traces) et sourdine', async () => {
    await home(page);
    await page.click('Circuits F1 2026');
    await page.waitFor("document.querySelector('.circuit-card')", 'le catalogue de circuits');
    if (!(await page.click('Singapour'))) throw new Error('Circuit de Singapour introuvable.');
    await page.waitFor("document.querySelector('.hud-layer')", 'le tableau de bord', 90_000);
    await page.waitFor("!document.querySelector('.scene-loading')", 'la fin du chargement de la scène', 90_000);
    await setPerfOverlay(page, true);
    await page.key('keyDown', 'KeyW', 'w');
    await page.waitFor("Number(document.querySelector('.speed b')?.textContent ?? 0) >= 90", '90 km/h', 60_000);
    // Frein à main + volant : les roues arrière se bloquent et la voiture part en travers.
    await page.key('keyDown', 'KeyD', 'd');
    await page.key('keyDown', 'Space', ' ');
    let loudestSqueal = 0;
    for (let i = 0; i < 8; i += 1) {
      await sleep(250);
      loudestSqueal = Math.max(loudestSqueal, (await readAudio(page)).squeal);
    }
    writeFileSync(join(outputDir, 'derapage.png'), await page.screenshot());
    await page.key('keyUp', 'Space', ' ');
    await page.key('keyUp', 'KeyD', 'd');
    await page.key('keyUp', 'KeyW', 'w');
    // Sourdine (M) : la sortie doit retomber au silence.
    await page.tap('KeyM', 'm');
    // Le panneau n'est rafraîchi que toutes les 6 images : en rendu logiciel, le silence met quelques secondes à s'afficher.
    let muted = await readAudio(page);
    for (let i = 0; i < 20 && !(muted.level < -70); i += 1) { await sleep(300); muted = await readAudio(page); }
    await page.tap('KeyM', 'm');
    await setPerfOverlay(page, false);
    assertNoProblems(page, 'derapage');
    if (!(loudestSqueal > 0.05)) throw new Error(`Aucun grincement de pneus audible en dérapage (gain max ${loudestSqueal.toFixed(3)}).`);
    if (!(muted.level < -70)) throw new Error(`La sourdine (M) ne coupe pas le son (niveau ${muted.level.toFixed(0)} dBFS).`);
    return `grincement max ${loudestSqueal.toFixed(2)} · sourdine ${muted.level.toFixed(0)} dBFS`;
  });

  await scenario('Hors piste : gravier et herbe détectés, poussière', async () => {
    await home(page);
    await page.click('Circuits F1 2026');
    await page.waitFor("document.querySelector('.circuit-card')", 'le catalogue de circuits');
    if (!(await page.click('Singapour'))) throw new Error('Circuit de Singapour introuvable.');
    await page.waitFor("document.querySelector('.lap-hud')", 'le chrono');
    await page.waitFor("!document.querySelector('.scene-loading')", 'la fin du chargement de la scène', 90_000);
    await setPerfOverlay(page, true);
    const loosePercent = async () => Number.parseInt(await page.eval("document.querySelector('[data-perf=\"surface\"]')?.textContent ?? ''"), 10);
    await sleep(800);
    const onTrack = await loosePercent();
    if (onTrack !== 0) throw new Error(`Sur la grille, aucune roue ne devrait être sur sol meuble (${onTrack} %).`);
    // Plein gaz en braquant à droite : la voiture quitte la piste.
    await page.key('keyDown', 'KeyW', 'w');
    await page.key('keyDown', 'KeyD', 'd');
    const startedAt = Date.now();
    let off = 0;
    while (Date.now() - startedAt < 20_000 && off < 100) { await sleep(250); off = await loosePercent(); }
    await sleep(1_200);
    writeFileSync(join(outputDir, 'hors-piste.png'), await page.screenshot());
    await page.key('keyUp', 'KeyD', 'd');
    await page.key('keyUp', 'KeyW', 'w');
    if (off < 100) throw new Error(`La voiture n'a pas quitté la piste (sol meuble : ${off} %).`);
    await setPerfOverlay(page, false);
    assertNoProblems(page, 'hors-piste');
    return `quitté la piste en ${((Date.now() - startedAt) / 1000).toFixed(1)} s, 100 % des roues sur sol meuble`;
  });

  await scenario('Chronométrage : ligne de départ, tour lancé, repositionnement, record affiché', async () => {
    await home(page);
    // Un record enregistré (Singapour, prototype) doit apparaître sur la carte du circuit.
    await page.eval(`localStorage.setItem('cardrive.records', JSON.stringify({ version: 1, records: { 'sg-2008|prototype': { bestS: 95.123, sectorS: [30, 35, 30.123], profileS: [0, 47, 95.123], setAtMs: 1 } } }))`);
    await home(page);
    await page.click('Circuits F1 2026');
    await page.waitFor("document.querySelector('.circuit-card')", 'le catalogue de circuits');
    const badge = await page.eval("[...document.querySelectorAll('.circuit-record')].map((node) => node.textContent).join('|')");
    if (!badge.includes('1:35.123')) throw new Error(`Le record enregistré n'apparaît pas sur la carte (« ${badge} »).`);
    if (!(await page.click('Singapour'))) throw new Error('Circuit de Singapour introuvable.');
    await page.waitFor("document.querySelector('.lap-hud')", 'le chrono');
    await page.waitFor("!document.querySelector('.scene-loading')", 'la fin du chargement de la scène', 90_000);
    const waiting = await page.eval("document.querySelector('.lap-label')?.textContent ?? ''");
    if (!/Franchissez la ligne/.test(waiting)) throw new Error(`Le chrono devrait attendre la ligne (« ${waiting} »).`);
    const best = await page.eval("document.querySelector('[data-lap=\"best\"]')?.textContent ?? ''");
    if (best !== '1:35.123') throw new Error(`Meilleur tour affiché « ${best} » au lieu de 1:35.123.`);
    // La voiture démarre à quelques mètres avant la ligne : en accélérant, le chrono se lance.
    await page.key('keyDown', 'KeyW', 'w');
    await page.waitFor("/Tour 1/.test(document.querySelector('.lap-label')?.textContent ?? '')", 'le départ du tour 1', 30_000);
    const first = await page.eval("document.querySelector('[data-lap=\"current\"]')?.textContent ?? ''");
    await sleep(1_500);
    const second = await page.eval("document.querySelector('[data-lap=\"current\"]')?.textContent ?? ''");
    writeFileSync(join(outputDir, 'chrono.png'), await page.screenshot());
    await page.key('keyUp', 'KeyW', 'w');
    if (first === second) throw new Error(`Le chrono n'avance pas (${first} → ${second}).`);
    // Repositionner (R) perd le tour : le chrono attend de nouveau la ligne.
    await page.tap('KeyR', 'r');
    await page.waitFor("/Franchissez la ligne/.test(document.querySelector('.lap-label')?.textContent ?? '')", 'le retour en attente après repositionnement', 15_000);
    assertNoProblems(page, 'chrono');
    return `chrono ${first} → ${second} en 1,5 s, remis en attente par R`;
  });

  await scenario('Course : feux de départ, adversaires pilotés, classement, retour au menu', async () => {
    try {
    await home(page);
    await page.click('Circuits F1 2026');
    await page.waitFor("document.querySelector('.circuit-card')", 'le catalogue de circuits');
    if (!(await page.click('Course'))) throw new Error('Bouton « Course » introuvable.');
    if (!(await page.click('Monaco'))) throw new Error('Circuit de Monaco introuvable.');
    await page.waitFor("document.querySelector('.race-status')", 'le rang de course', 90_000);
    await page.waitFor("!document.querySelector('.scene-loading')", 'la fin du chargement de la scène', 90_000);
    // Les feux s'allument un à un (temps de simulation), puis s'éteignent.
    await page.waitFor("document.querySelector('.start-lights')", 'les feux de départ');
    await page.waitFor("document.querySelector('.start-lights')?.dataset.lights === '3'", 'les trois feux allumés', 20_000);
    const startPosition = await page.eval("document.querySelector('[data-race=\"position\"]')?.textContent ?? ''");
    if (startPosition !== '6e') throw new Error(`Le joueur devrait partir en dernière position (6e), pas « ${startPosition} ».`);
    writeFileSync(join(outputDir, 'course-grille.png'), await page.screenshot());
    await page.waitFor("!document.querySelector('.start-lights')", 'le départ (feux éteints)', 20_000);
    // Départ : plein gaz ; les adversaires partent aussi, donc un écart se creuse devant nous.
    await page.key('keyDown', 'KeyW', 'w');
    await sleep(12_000);
    const gapText = await page.eval("document.querySelector('[data-race=\"gap\"]')?.textContent ?? ''");
    writeFileSync(join(outputDir, 'course.png'), await page.screenshot());
    const lapText = await page.eval("document.querySelector('[data-race=\"lap\"]')?.textContent ?? ''");
    await page.key('keyUp', 'KeyW', 'w');
    const falseStart = await page.eval("Boolean(document.querySelector('.false-start'))");
    if (falseStart) throw new Error('Faux départ signalé alors que le joueur attendait les feux.');
    if (!/Tour 1 \/ 3/.test(lapText)) throw new Error(`Compteur de tours inattendu : « ${lapText} ».`);
    if (!/devant : \d+ m/.test(gapText)) throw new Error(`Écart à la voiture précédente absent (« ${gapText} »).`);
    // Pause → retour au menu.
    await page.tap('Escape', 'Escape');
    await page.waitFor("document.querySelector('.pause-panel')", 'le panneau de pause');
    if (!(await page.click('Quitter vers le menu'))) throw new Error('Bouton « Quitter vers le menu » introuvable.');
    await page.waitFor("document.querySelector('.menu-row')", 'le menu principal');
    assertNoProblems(page, 'course');
    return `départ 6e, ${lapText}, ${gapText}`;
    } finally {
      // Le mode de jeu est mémorisé : les scénarios suivants doivent retrouver le contre-la-montre.
      await page.eval("localStorage.removeItem('cardrive.raceSetup')");
    }
  });

  if (FULL_LAP) {
    await scenario('Tour complet piloté (Monaco) : chrono, secteurs, record sauvegardé, fantôme du tour suivant', async () => {
      try {
        await page.goto(`${URL}?autopilot=1`);
        await page.waitFor("document.querySelector('.menu-row')", 'le menu principal');
        await page.eval("localStorage.removeItem('cardrive.records'); localStorage.removeItem('cardrive.ghosts'); localStorage.removeItem('cardrive.raceSetup')");
        await page.click('Circuits F1 2026');
        await page.waitFor("document.querySelector('.circuit-card')", 'le catalogue de circuits');
        if (!(await page.click('Monaco'))) throw new Error('Circuit de Monaco introuvable.');
        await page.waitFor("document.querySelector('.lap-hud')", 'le chrono');
        await page.waitFor("!document.querySelector('.scene-loading')", 'la fin du chargement de la scène', 90_000);
        // Tour 1 démarre à la ligne ; il se termine environ 3 minutes plus tard : on attend l'affichage du « dernier tour ».
        await page.waitFor("/Tour 1/.test(document.querySelector('.lap-label')?.textContent ?? '')", 'le départ du tour 1', 60_000);
        const sectors = [];
        const lapDone = String.raw`/^\d+:\d\d\.\d{3}$/.test(document.querySelector('[data-lap="last"]')?.textContent ?? '')`;
        const startedAt = Date.now();
        while (!(await page.eval(lapDone))) {
          if (Date.now() - startedAt > 420_000) throw new Error('Le tour 1 ne se termine pas (7 minutes écoulées).');
          const notice = await page.eval("document.querySelector('.lap-notice')?.textContent ?? ''");
          if (/^Secteur/.test(notice) && !sectors.includes(notice.slice(0, 9))) sectors.push(notice.slice(0, 9));
          await sleep(1_000);
        }
        const lastText = await page.eval("document.querySelector('[data-lap=\"last\"]')?.textContent ?? ''");
        const bestText = await page.eval("document.querySelector('[data-lap=\"best\"]')?.textContent ?? ''");
        const stored = JSON.parse(await page.eval("localStorage.getItem('cardrive.records') ?? '{}'"));
        const record = stored.records?.['mc-1929|prototype'];
        if (!record) throw new Error('Aucun record enregistré après le premier tour.');
        const ghosts = JSON.parse(await page.eval("localStorage.getItem('cardrive.ghosts') ?? '{}'"));
        const ghost = ghosts.ghosts?.['mc-1929|prototype'];
        if (!ghost || ghost.d.length < 300) throw new Error('Aucun fantôme enregistré (ou trace trop courte) après le premier tour.');
        if (Math.abs(record.bestS - ghost.lapS) > 0.001) throw new Error(`Record (${record.bestS}) et fantôme (${ghost.lapS}) ne correspondent pas.`);
        if (lastText !== bestText) throw new Error(`Dernier (${lastText}) et meilleur (${bestText}) devraient être égaux après le premier tour.`);
        if (sectors.length < 2) throw new Error(`Seulement ${sectors.length} message(s) de secteur vu(s) pendant le tour (2 attendus).`);
        // Tour 2 : l'écart au record et le fantôme apparaissent.
        await page.waitFor("/Tour 2/.test(document.querySelector('.lap-label')?.textContent ?? '')", 'le départ du tour 2', 20_000);
        await sleep(15_000);
        const delta = await page.eval("document.querySelector('[data-lap=\"delta\"]')?.textContent ?? ''");
        writeFileSync(join(outputDir, 'tour-complet.png'), await page.screenshot());
        if (!/^[+−]\d+\.\d{3}$/.test(delta)) throw new Error(`Écart au meilleur tour absent ou mal formé en tour 2 (« ${delta} »).`);
        assertNoProblems(page, 'tour-complet');
        const sectorMs = record.sectorS.map((value) => value.toFixed(1)).join(' / ');
        return `tour 1 en ${lastText} (secteurs ${sectorMs} s), ${(ghost.d.length / 3)} points de fantôme, écart en tour 2 : ${delta}`;
      } finally {
        await page.eval("localStorage.removeItem('cardrive.records'); localStorage.removeItem('cardrive.ghosts')");
      }
    });
  }

  await scenario('Pause et reprise', async () => {
    await home(page);
    await page.click('Jouer');
    await page.waitFor("document.querySelector('.hud-layer')", 'le tableau de bord', 60_000);
    await sleep(800);
    await page.tap('Escape', 'Escape');
    await page.waitFor("document.querySelector('.pause-panel h2')?.textContent === 'Pause'", 'le panneau de pause');
    // Aides à la conduite : le contrôle de traction se règle (moyen par défaut) et le choix est mémorisé.
    const defaultLevel = await page.eval("document.querySelector('[aria-label=\"Contrôle de traction\"] [aria-pressed=\"true\"]')?.textContent ?? ''");
    if (defaultLevel !== 'Moyenne') throw new Error(`Contrôle de traction par défaut : « ${defaultLevel} » au lieu de « Moyenne ».`);
    if (!(await page.click('Complète'))) throw new Error('Choix « Complète » introuvable.');
    const saved = await page.eval("localStorage.getItem('cardrive.assists') ?? ''");
    await page.eval("localStorage.removeItem('cardrive.assists')");
    if (!saved.includes('full')) throw new Error(`Réglage non mémorisé (« ${saved} »).`);
    if (!(await page.click('Reprendre'))) throw new Error('Bouton « Reprendre » introuvable.');
    await page.waitFor("!document.querySelector('.pause-panel')", 'la fermeture de la pause');
    assertNoProblems(page, 'pause');
  });

  await scenario('Boîte manuelle : le rapport est tenu, E et C changent de rapport', async () => {
    try {
      await home(page);
      await page.click('Jouer');
      await page.waitFor("document.querySelector('.hud-layer')", 'le tableau de bord', 60_000);
      await sleep(800);
      await page.tap('Escape', 'Escape');
      await page.waitFor("document.querySelector('.pause-panel')", 'le panneau de pause');
      if (!(await page.click('Manuelle'))) throw new Error('Choix « Manuelle » introuvable.');
      if (!(await page.click('Reprendre'))) throw new Error('Bouton « Reprendre » introuvable.');
      await page.waitFor("!document.querySelector('.pause-panel')", 'la fermeture de la pause');
      const gear = async () => Number.parseInt(await page.eval("document.querySelector('.gear')?.textContent ?? ''"), 10);
      await page.key('keyDown', 'KeyW', 'w');
      await sleep(2_500);
      const held = await gear();
      if (held !== 1) throw new Error(`En boîte manuelle, le rapport devait rester en 1re (rapport ${held}).`);
      await page.tap('KeyE', 'e');
      await sleep(600);
      const up = await gear();
      if (up !== 2) throw new Error(`E devait passer la 2e (rapport ${up}, texte « ${await page.eval("document.querySelector(\".cluster\")?.textContent ?? \"\"")} »).`);
      await page.tap('KeyC', 'c');
      await sleep(600);
      const down = await gear();
      await page.key('keyUp', 'KeyW', 'w');
      if (down !== 1) throw new Error(`C devait revenir en 1re (rapport ${down}).`);
      assertNoProblems(page, 'manuelle');
      return 'rapport tenu en 1re, E → 2e, C → 1re';
    } finally {
      await page.eval("localStorage.removeItem('cardrive.assists')");
    }
  });

  await scenario('Usure des pneus et carburant : affichés dans les détails, remise à neuf depuis la pause', async () => {
    await home(page);
    await page.click('Jouer');
    await page.waitFor("document.querySelector('.hud-layer')", 'le tableau de bord', 60_000);
    await sleep(800);
    await page.key('keyDown', 'KeyW', 'w');
    await sleep(3_000);
    await page.key('keyUp', 'KeyW', 'w');
    await page.tap('KeyT', 't');
    await page.waitFor("document.querySelector('.details-panel')", 'les détails du véhicule');
    const details = await page.eval("document.querySelector('.details-panel')?.textContent ?? ''");
    if (!/Carburant\d+%·\d+kg/.test(details.replace(/[\s\u202f\u00a0]/g, ''))) throw new Error(`Carburant absent des détails (« ${details} »).`);
    if (!/usure \d+ %/.test(details)) throw new Error(`Usure des pneus absente des détails (« ${details} »).`);
    await page.tap('Escape', 'Escape');
    await page.waitFor("document.querySelector('.pause-panel')", 'le panneau de pause');
    if (!(await page.click('Pneus neufs et plein'))) throw new Error('Bouton « Pneus neufs et plein » introuvable.');
    await page.waitFor("!document.querySelector('.pause-panel')", 'la reprise après l\'arrêt au stand');
    assertNoProblems(page, 'usure');
    return details.replace(/\s+/g, ' ').slice(0, 120);
  });

  await scenario('Pluie : piste détrempée, gerbes d\'eau, météo mémorisée', async () => {
    try {
      await home(page);
      await page.click('Circuits F1 2026');
      await page.waitFor("document.querySelector('.circuit-card')", 'le catalogue de circuits');
      if (!(await page.click('Forte pluie'))) throw new Error('Choix « Forte pluie » introuvable.');
      const saved = await page.eval("localStorage.getItem('cardrive.weather') ?? ''");
      if (!saved.includes('heavy')) throw new Error(`Météo non mémorisée (« ${saved} »).`);
      if (!(await page.click('Singapour'))) throw new Error('Circuit de Singapour introuvable.');
      await page.waitFor("document.querySelector('.lap-hud')", 'le chrono');
      await page.waitFor("!document.querySelector('.scene-loading')", 'la fin du chargement de la scène', 90_000);
      await page.waitFor("document.querySelector('.wet-pill')", 'le message de piste mouillée', 20_000);
      const message = await page.eval("document.querySelector('.wet-pill')?.textContent ?? ''");
      if (!/détrempée/.test(message)) throw new Error(`Message inattendu : « ${message} ».`);
      await page.key('keyDown', 'KeyW', 'w');
      await sleep(4_000);
      writeFileSync(join(outputDir, 'pluie.png'), await page.screenshot());
      await setPerfOverlay(page, true);
      await sleep(1_800);
      const perf = await readPerf(page);
      await setPerfOverlay(page, false);
      await page.key('keyUp', 'KeyW', 'w');
      assertNoProblems(page, 'pluie');
      return `${message} · ${perf.fps.toFixed(0)} img/s sous forte pluie avec gerbes d'eau`;
    } finally {
      await page.eval("localStorage.removeItem('cardrive.weather')");
    }
  });

  await scenario('Dégâts : un choc contre le mur abîme moteur et direction, « Réparer » remet à neuf', async () => {
    try {
      await home(page);
      await page.eval(`localStorage.setItem('cardrive.assists', JSON.stringify({ tractionControl: 'medium', transmission: 'auto', wearAndFuel: true, damage: true }))`);
      await home(page);
      await page.click('Circuits F1 2026');
      await page.waitFor("document.querySelector('.circuit-card')", 'le catalogue de circuits');
      if (!(await page.click('Singapour'))) throw new Error('Circuit de Singapour introuvable.');
      await page.waitFor("document.querySelector('.lap-hud')", 'le chrono');
      await page.waitFor("!document.querySelector('.scene-loading')", 'la fin du chargement de la scène', 90_000);
      await page.tap('KeyT', 't');
      await page.waitFor("document.querySelector('.details-panel')", 'les détails du véhicule');
      const power = async () => Number.parseInt((await page.eval("[...document.querySelectorAll('.detail-row')].find((row) => row.textContent.startsWith('Moteur'))?.textContent ?? ''")).replace(/\D+/, ''), 10);
      await page.waitFor("[...document.querySelectorAll('.detail-row')].some((row) => row.textContent.startsWith('Moteur'))", 'la ligne « Moteur » des détails', 15_000);
      const healthy = await power();
      if (healthy !== 100) throw new Error(`Moteur sain attendu à 100 % de puissance (« ${healthy} »).`);
      // Plein gaz tout droit : la voiture finit contre le mur de la première courbe.
      await page.key('keyDown', 'KeyW', 'w');
      const startedAt = Date.now();
      let damaged = 100;
      while (Date.now() - startedAt < 25_000 && damaged >= 100) { await sleep(500); damaged = await power(); }
      await page.key('keyUp', 'KeyW', 'w');
      if (damaged >= 100) throw new Error('Aucun dégât après un choc contre le mur.');
      await page.tap('Escape', 'Escape');
      await page.waitFor("document.querySelector('.pause-panel')", 'le panneau de pause');
      if (!(await page.click('Réparer la voiture'))) throw new Error('Bouton « Réparer la voiture » introuvable.');
      await page.waitFor("!document.querySelector('.pause-panel')", 'la reprise après réparation');
      await sleep(600);
      const repaired = await power();
      if (repaired !== 100) throw new Error(`Moteur non réparé (${repaired} % de puissance).`);
      assertNoProblems(page, 'degats');
      return `moteur ${healthy} % → ${damaged} % après le choc, réparé à ${repaired} %`;
    } finally {
      await page.eval("localStorage.removeItem('cardrive.assists')");
    }
  });

  await scenario("Choix d'un véhicule (Camion) et conduite à Singapour", async () => {
    await home(page);
    await page.click('Garage');
    await page.waitFor(`document.querySelectorAll('.car-card').length === ${VEHICLE_COUNT}`, 'le garage');
    if (!(await page.click('Camion'))) throw new Error('Carte « Camion » introuvable.');
    await page.eval("document.querySelector('.screen-footer .btn').click()");
    await page.waitFor("document.querySelector('.menu-row.primary')", 'le menu');
    const subtitle = await page.eval("[...document.querySelectorAll('.menu-row')].find((row) => row.textContent.includes('Garage'))?.querySelector('span')?.textContent");
    if (subtitle !== 'Camion') throw new Error(`Le menu devrait afficher le véhicule choisi « Camion », trouvé « ${subtitle} ».`);
    // Un camion de 7,5 m ne tient pas sur le petit ovale de la piste d'essai (il heurte les barrières au départ) : on le conduit sur un circuit.
    await page.click('Circuits F1 2026');
    await page.waitFor("document.querySelector('.circuit-card')", 'le catalogue de circuits');
    if (!(await page.click('Singapour'))) throw new Error('Circuit de Singapour introuvable.');
    const detail = await driveAndCheck(page, 'circuit-camion');
    const saved = await page.eval("localStorage.getItem('cardrive.selectedCar')");
    if (saved !== 'truck') throw new Error(`Véhicule mémorisé attendu « truck », trouvé « ${saved} ».`);
    return detail;
  });

  await cityScenario(false);
  await scenario('Collision contre un mur à 2,5 km, après deux recentrages (colliders des chunks)', async () => {
    page.mock = syntheticServices;
    setObstacle(true);
    try {
      await home(page);
      // Le cache IndexedDB d'un scénario précédent contiendrait des chunks sans le mur : on le vide avant de lancer la partie.
      await page.eval("new Promise((resolve) => { const request = indexedDB.deleteDatabase('cardrive-geo-cache'); request.onsuccess = request.onerror = request.onblocked = () => resolve(true); })");
      await page.eval("localStorage.setItem('cardrive.selectedCar', 'prototype')");
      await home(page);
      await page.click('Lieu réel');
      await page.waitFor("document.querySelector('input[type=search]')", 'le champ de recherche');
      await page.eval("(() => { const input = document.querySelector('input[type=search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, 'Avenue de test'); input.dispatchEvent(new Event('input', { bubbles: true })); })()");
      await page.waitFor("document.querySelector('.option')", "une suggestion d'adresse", 30_000);
      await page.eval("document.querySelector('.option').click()");
      await page.waitFor("document.querySelector('.hud-layer')", 'le tableau de bord', 90_000);
      await page.waitFor("!document.querySelector('.scene-loading')", 'la fin du chargement', 90_000);
      await page.tap('F3', 'F3');
      await page.waitFor("document.querySelector('[data-perf-overlay]')", 'le panneau de performance');
      const read = async (id) => Number.parseFloat((await page.eval(`document.querySelector('[data-perf="${id}"]')?.textContent ?? '0'`)).replace(/[\s\u202f\u00a0]/g, '').replace(',', '.'));
      await page.key('keyDown', 'KeyW', 'w');
      const startedAt = Date.now();
      let reachedSpeed = 0;
      let stoppedAtX = null;
      let recenters = 0;
      while (Date.now() - startedAt < 90_000) {
        await sleep(300);
        const speed = Number(await page.eval("document.querySelector('.speed b')?.textContent ?? '0'"));
        reachedSpeed = Math.max(reachedSpeed, speed);
        const x = await read('world-x');
        if (reachedSpeed > 100 && speed < 15) { stoppedAtX = x; break; }
        if (x > OBSTACLE.x + 400) break; // dépassé le mur sans s'arrêter
      }
      // La position affichée est rafraîchie toutes les 0,4 s : on attend qu'elle rattrape la voiture arrêtée contre le mur.
      await sleep(1_500);
      const restX = await read('world-x');
      await page.key('keyUp', 'KeyW', 'w');
      const chunks = (await page.eval("document.querySelector('[data-perf=\"chunks\"]')?.textContent ?? ''")).replace(/[\s\u202f\u00a0]/g, '').split('·').map(Number);
      recenters = chunks[3];
      await page.tap('F3', 'F3');
      assertNoProblems(page, 'collision');
      if (stoppedAtX === null) throw new Error(`La voiture n'a pas été arrêtée par le mur à x = ${OBSTACLE.x} m (vitesse max ${reachedSpeed} km/h) : les colliders des bâtiments ne suivent pas le recentrage.`);
      const requiredRecenters = OBSTACLE.x >= 2_000 ? 2 : 0; // E2E_WALL_X=600 : témoin sans recentrage
      if (recenters < requiredRecenters) throw new Error(`Seulement ${recenters} recentrage(s) avant le mur : le test ne couvre pas le cas visé (${requiredRecenters} requis).`);
      // L'avant de la voiture (2 m devant son centre) touche le mur à x = 2500 : le centre du châssis atteint ≈ 2498 au plus.
      // Des colliders restés dans l'ancien repère décaleraient l'impact de ≈ 1 000 m par recentrage, pas de quelques mètres.
      if (process.env.E2E_WALL_PROBE) return `SONDE : repos à x = ${restX.toFixed(1)} m (mur à ${OBSTACLE.x} m, écart ${(restX - OBSTACLE.x).toFixed(1)} m) après ${recenters} recentrages`;
      // Contre le mur : le centre du châssis est à ≈ 2,2 m devant lui (demi-longueur 1,93 m + débattement), au plus quelques mètres de rebond.
      // Des colliders restés dans l'ancien repère décaleraient cet arrêt de ≈ 1 000 m par recentrage, pas de quelques mètres.
      if (restX < OBSTACLE.x - 8 || restX > OBSTACLE.x) throw new Error(`Arrêt à x = ${restX.toFixed(0)} m au lieu d'environ ${(OBSTACLE.x - 2.5).toFixed(0)} m : colliders décalés (${recenters} recentrages).`);
      return `arrêt contre le mur à x = ${restX.toFixed(0)} m (mur à ${OBSTACLE.x} m) après ${recenters} recentrages, ${reachedSpeed} km/h atteints`;
    } finally {
      setObstacle(false);
      page.mock = null;
    }
  });
  if (NETWORK) await cityScenario(true);
} finally {
  await page.close();
  server.kill();
}

console.log('\nTests de bout en bout (' + (GPU ? 'rendu matériel' : 'rendu logiciel') + ')\n');
for (const result of results) console.log(`${result.ok ? '✓' : '✗'} ${result.name} (${result.seconds} s)${result.detail ? `\n    ${String(result.detail).replace(/\n/g, '\n    ')}` : ''}`);
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} scénarios réussis.`);
process.exit(failed.length > 0 ? 1 : 0);
