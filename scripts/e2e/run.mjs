// Tests de bout en bout : sert le build (vite preview), pilote Chrome, parcourt menu → garage → circuits → conduite → pause,
// échoue sur toute erreur de console, tout écran vide, toute régression visuelle des écrans d'interface, tout dépassement
// grossier du budget physique. Usage : npm run e2e  |  npm run e2e:update (rafraîchit les images de référence)
//   Options : --update  --gpu (rendu matériel : seul mode où les FPS sont représentatifs)  --network (scénario ville réelle)
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

async function readPerf(page) {
  await page.tap('F3', 'F3');
  await page.waitFor("document.querySelector('[data-perf-overlay]')", 'le panneau de performance (F3)');
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
  await page.tap('F3', 'F3');
  return { fps, frameP95, physicsAverage, vehicleSolver, triangles, drawCalls };
}

async function driveAndCheck(page, label, options = {}) {
  await page.waitFor("document.querySelector('.hud-layer')", 'le tableau de bord', 90_000);
  await page.waitFor("document.querySelector('.game-canvas canvas')", 'le canevas 3D');
  // La scène (chargement paresseux du moteur 3D, WebAssembly, modèles) met plusieurs secondes à devenir active en rendu
  // logiciel : on maintient l'accélérateur jusqu'à voir la vitesse monter, au lieu d'attendre une durée fixe.
  await page.waitFor("!document.querySelector('.scene-loading')", 'la fin du chargement de la scène', 90_000);
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
  await page.key('keyUp', 'KeyW', 'w');
  const shot = await page.screenshot();
  writeFileSync(join(outputDir, `${label}.png`), shot);
  const spread = await luminanceSpread(page, shot);
  if (spread.deviation < 12) throw new Error(`${label} : rendu quasi uniforme (écart-type de luminance ${spread.deviation.toFixed(1)}) — scène vide ?`);
  assertNoProblems(page, label, options);
  const perf = await readPerf(page);
  if (perf.vehicleSolver > 1 * E2E_PHYSICS_BUDGET_FACTOR) throw new Error(`${label} : solveur véhicule ${perf.vehicleSolver} ms/pas (budget ${E2E_PHYSICS_BUDGET_FACTOR} ms).`);
  if (perf.physicsAverage > 4 * E2E_PHYSICS_BUDGET_FACTOR) throw new Error(`${label} : pas physique ${perf.physicsAverage} ms (budget ${4 * E2E_PHYSICS_BUDGET_FACTOR} ms).`);
  return `25 km/h atteints en ${secondsToTwentyFive.toFixed(1)} s · ${perf.fps.toFixed(0)} img/s · pas physique ${perf.physicsAverage.toFixed(2)} ms · solveur ${perf.vehicleSolver.toFixed(3)} ms · ${perf.triangles.toLocaleString('fr-FR')} triangles`;
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

  await scenario('Pause et reprise', async () => {
    await home(page);
    await page.click('Jouer');
    await page.waitFor("document.querySelector('.hud-layer')", 'le tableau de bord', 60_000);
    await sleep(800);
    await page.tap('Escape', 'Escape');
    await page.waitFor("document.querySelector('.pause-panel h2')?.textContent === 'Pause'", 'le panneau de pause');
    if (!(await page.click('Reprendre'))) throw new Error('Bouton « Reprendre » introuvable.');
    await page.waitFor("!document.querySelector('.pause-panel')", 'la fermeture de la pause');
    assertNoProblems(page, 'pause');
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
