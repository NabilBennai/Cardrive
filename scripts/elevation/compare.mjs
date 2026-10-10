// Compare les altitudes des tuiles Terrarium à celles de l'API Open-Meteo sur 40 points du tracé (diagnostic de R-4.1, réseau requis).
// Usage : node scripts/elevation/compare.mjs [id-du-circuit]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ElevationField, ElevationTile, tilesCovering, tileUrl } from '../../src/geo/elevation.ts';
import { decodePng } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const circuitId = process.argv[2] ?? 'be-1925';
const source = readFileSync(join(here, '..', '..', 'src', 'circuits', 'f1Circuits2026.ts'), 'utf8');
const line = source.split('\n').find((candidate) => candidate.startsWith(`{"id":"${circuitId}"`));
const circuit = JSON.parse(line.replace(/,\s*$/, ''));
const points = circuit.coordinates.filter((_, i) => i % Math.ceil(circuit.coordinates.length / 40) === 0).map(([lon, lat]) => ({ lat, lon }));
const lats = points.map((p) => p.lat); const lons = points.map((p) => p.lon);
const field = new ElevationField(13);
for (const tile of tilesCovering(Math.min(...lats) - 0.002, Math.min(...lons) - 0.002, Math.max(...lats) + 0.002, Math.max(...lons) + 0.002, 13)) {
  const response = await fetch(tileUrl(tile));
  field.add(new ElevationTile(tile, decodePng(Buffer.from(await response.arrayBuffer())).rgba));
}
const meteo = await (await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`)).json();
const diffs = points.map((p, i) => field.sample({ latitudeDeg: p.lat, longitudeDeg: p.lon }) - meteo.elevation[i]);
const rms = Math.sqrt(diffs.reduce((sum, d) => sum + d * d, 0) / diffs.length);
console.log(JSON.stringify({ circuit: circuit.name, points: points.length, rmsDifferenceM: Number(rms.toFixed(1)), maxAbsDifferenceM: Number(Math.max(...diffs.map(Math.abs)).toFixed(1)), terrariumRangeM: [Math.min(...points.map((p) => field.sample({ latitudeDeg: p.lat, longitudeDeg: p.lon }))), Math.max(...points.map((p) => field.sample({ latitudeDeg: p.lat, longitudeDeg: p.lon })))].map((v) => Number(v.toFixed(1))), openMeteoRangeM: [Math.min(...meteo.elevation), Math.max(...meteo.elevation)] }));
