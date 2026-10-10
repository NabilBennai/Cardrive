// Prototype de lecture d'altitudes (R-4.1) : télécharge les tuiles Terrarium autour d'un circuit, échantillonne le profil le long du tracé
// et mesure ce qu'il faut savoir pour décider : taille, mémoire, bruit, plausibilité. Usage : node scripts/elevation/probe.mjs [id-du-circuit] [zoom]
// Réseau requis (AWS S3). Ne fait pas partie des tests.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ElevationField, ElevationTile, pixelSizeM, profileStats, smoothClosedProfile, tilesCovering, tileUrl } from '../../src/geo/elevation.ts';
import { decodePng } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const circuitId = process.argv[2] ?? 'be-1925';
const zoom = Number(process.argv[3] ?? 13);
const source = readFileSync(join(here, '..', '..', 'src', 'circuits', 'f1Circuits2026.ts'), 'utf8');
const line = source.split('\n').find((candidate) => candidate.startsWith(`{"id":"${circuitId}"`));
if (!line) throw new Error(`Circuit ${circuitId} introuvable.`);
const circuit = JSON.parse(line.replace(/,\s*$/, ''));
const coordinates = circuit.coordinates; // [longitude, latitude]

const lats = coordinates.map((c) => c[1]);
const lons = coordinates.map((c) => c[0]);
const south = Math.min(...lats); const north = Math.max(...lats); const west = Math.min(...lons); const east = Math.max(...lons);
const tiles = tilesCovering(south - 0.002, west - 0.002, north + 0.002, east + 0.002, zoom);

const field = new ElevationField(zoom);
let downloadedBytes = 0;
const started = Date.now();
for (const tile of tiles) {
  const response = await fetch(tileUrl(tile));
  if (!response.ok) throw new Error(`Tuile ${tileUrl(tile)} : HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  downloadedBytes += buffer.length;
  const image = decodePng(buffer);
  field.add(new ElevationTile(tile, image.rgba));
}
const downloadMs = Date.now() - started;

// Profil le long du tracé, rééchantillonné tous les 5 m (distance approchée par projection équirectangulaire locale).
const lat0 = (south + north) / 2;
const mPerDegLat = 111_320;
const mPerDegLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
const points = coordinates.map(([lon, lat]) => ({ lat, lon }));
const spacingM = 5;
const profile = [];
let carried = 0;
for (let i = 0; i < points.length; i += 1) {
  const a = points[i]; const b = points[(i + 1) % points.length];
  const length = Math.hypot((b.lon - a.lon) * mPerDegLon, (b.lat - a.lat) * mPerDegLat);
  let along = carried;
  while (along < length) {
    const t = along / length;
    const value = field.sample({ latitudeDeg: a.lat + (b.lat - a.lat) * t, longitudeDeg: a.lon + (b.lon - a.lon) * t });
    if (value === null) throw new Error('Point hors des tuiles chargées.');
    profile.push(value);
    along += spacingM;
  }
  carried = along - length;
}

const raw = profileStats(profile, spacingM);
const smooth = smoothClosedProfile(profile, spacingM, 40);
const filtered = profileStats(smooth, spacingM);
// Bruit : écart quadratique moyen entre le profil brut et lissé.
const noise = Math.sqrt(profile.reduce((sum, v, i) => sum + (v - smooth[i]) ** 2, 0) / profile.length);

console.log(JSON.stringify({
  circuit: circuit.name,
  zoom,
  pixelM: Number(pixelSizeM(zoom, lat0).toFixed(2)),
  tiles: tiles.length,
  downloadKiB: Math.round(downloadedBytes / 1024),
  downloadSeconds: Number((downloadMs / 1000).toFixed(1)),
  memoryKiB: Math.round(field.memoryBytes / 1024),
  samples: profile.length,
  lengthM: profile.length * spacingM,
  raw: { minM: Number(raw.minM.toFixed(1)), maxM: Number(raw.maxM.toFixed(1)), ascentM: Math.round(raw.ascentM), maxGradePercent: Number((raw.maxGrade * 100).toFixed(1)) },
  smoothed40m: { ascentM: Math.round(filtered.ascentM), maxGradePercent: Number((filtered.maxGrade * 100).toFixed(1)) },
  noiseRmsM: Number(noise.toFixed(2)),
  closureErrorM: Number(raw.closureErrorM.toFixed(2)),
}, null, 2));
