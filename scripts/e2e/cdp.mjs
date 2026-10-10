// Pilote Chrome minimal par le protocole DevTools (CDP), sans dépendance : lancement, navigation, clics par texte,
// touches, captures, console. Utilise le WebSocket intégré à Node 22.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error('Chrome introuvable : définir CHROME_PATH.');
  return found;
}

/**
 * Lance Chrome sans interface. `gpu: false` (défaut) force le rendu logiciel SwiftShader : lent mais identique d'une machine
 * à l'autre, donc adapté aux assertions. `gpu: true` laisse Chrome utiliser la carte graphique : seul mode où les FPS mesurés
 * ont un sens.
 */
export async function launchPage({ width = 1280, height = 720, gpu = false } = {}) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), 'cardrive-e2e-'));
  const args = [
    '--headless=new', `--remote-debugging-port=${port}`, `--window-size=${width},${height}`, '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--no-default-browser-check', '--disable-extensions', '--force-device-scale-factor=1', `--user-data-dir=${profile}`,
    ...(gpu ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']),
    'about:blank',
  ];
  const chrome = spawn(findChrome(), args, { stdio: 'ignore' });

  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((entry) => entry.type === 'page');
    } catch { /* Chrome démarre */ }
    if (!target) await sleep(150);
  }
  if (!target) { chrome.kill(); throw new Error('Chrome n\'a pas répondu sur le port de débogage.'); }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  let onRequestPaused = null;
  /** Messages de console de niveau error, exceptions non rattrapées et échecs de chargement de ressources locales. */
  const problems = [];
  const consoleLog = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
      consoleLog.push(`${message.params.type}: ${text}`);
      if (message.params.type === 'error') problems.push(`console.error: ${text}`);
    } else if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      problems.push(`exception: ${details.exception?.description ?? details.text}`);
    } else if (message.method === 'Fetch.requestPaused') {
      onRequestPaused?.(message.params);
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      problems.push(`log: ${message.params.entry.text} ${message.params.entry.url ?? ''}`);
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');

  const page = {
    problems,
    consoleLog,
    send,
    /**
     * Intercepte les requêtes dont l'URL correspond à `patterns`. `page.mock` désigne le gestionnaire courant :
     * `({ url, method, body }) => { status, contentType, body }` pour répondre localement, ou null / undefined pour laisser
     * passer la requête vers le réseau réel. Les réponses portent `Access-Control-Allow-Origin: *` comme les services remplacés.
     */
    mock: null,
    async intercept(patterns) {
      onRequestPaused = (params) => {
        const { requestId, request } = params;
        const answer = page.mock?.({ url: request.url, method: request.method, body: request.postData ?? '' });
        if (!answer) { send('Fetch.continueRequest', { requestId }); return; }
        const payload = Buffer.isBuffer(answer.body) ? answer.body : Buffer.from(answer.body);
        send('Fetch.fulfillRequest', {
          requestId,
          responseCode: answer.status ?? 200,
          responseHeaders: [
            { name: 'Content-Type', value: answer.contentType ?? 'application/json' },
            { name: 'Access-Control-Allow-Origin', value: '*' },
          ],
          body: payload.toString('base64'),
        });
      };
      await send('Fetch.enable', { patterns: patterns.map((urlPattern) => ({ urlPattern })) });
    },
    async goto(url) { await send('Page.navigate', { url }); await sleep(400); },
    async eval(expression) {
      const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.result?.exceptionDetails) throw new Error(`eval: ${response.result.exceptionDetails.exception?.description ?? 'erreur'}`);
      return response.result?.result?.value;
    },
    /** Attend qu'une expression JS devienne vraie ; échoue avec `what` au bout de `timeoutMs`. */
    async waitFor(expression, what, timeoutMs = 20_000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (await page.eval(`Boolean(${expression})`).catch(() => false)) return;
        await sleep(150);
      }
      throw new Error(`Délai dépassé en attendant : ${what}`);
    },
    /** Clique sur le premier bouton dont le texte contient `text` ; renvoie false s'il n'existe pas. */
    click(text) {
      return page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
    },
    async key(type, code, key) {
      await send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : { Escape: 27, F3: 114 }[key] ?? 0 });
    },
    async tap(code, key) { await page.key('keyDown', code, key); await sleep(60); await page.key('keyUp', code, key); },
    /** Maintient une touche `ms` millisecondes. */
    async hold(code, key, ms) { await page.key('keyDown', code, key); await sleep(ms); await page.key('keyUp', code, key); },
    async screenshot() {
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(result.data, 'base64');
    },
    async close() {
      try { socket.close(); } catch { /* déjà fermé */ }
      chrome.kill();
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* verrou Windows : sans importance */ }
    },
  };
  return page;
}
