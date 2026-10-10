// Ville synthétique servie à la place d'Overpass et de Nominatim pendant les tests de bout en bout : déterministe, hors ligne,
// et conçue pour exercer le streaming — une longue avenue droite (aucun virage : la voiture qui accélère sans tourner ne sort
// pas de la route), des immeubles de part et d'autre, un étang hors chaussée. Les coordonnées sont celles d'un lieu
// quelconque ; seule la géométrie locale compte.
export const SYNTHETIC_PLACE = { latitude: 46.15, longitude: -1.15, label: 'Avenue de test, Ville synthétique' };

const EARTH_RADIUS_M = 6_378_137;
const degToRad = (deg) => (deg * Math.PI) / 180;
const radToDeg = (rad) => (rad * 180) / Math.PI;

/** Même projection que src/geo/projection.ts (x = est, z = sud), centrée sur le lieu. */
const toLocal = (latitude, longitude) => ({
  x: EARTH_RADIUS_M * Math.cos(degToRad(SYNTHETIC_PLACE.latitude)) * degToRad(longitude - SYNTHETIC_PLACE.longitude),
  z: -EARTH_RADIUS_M * degToRad(latitude - SYNTHETIC_PLACE.latitude),
});
const toGeo = (x, z) => ({
  latitude: SYNTHETIC_PLACE.latitude + radToDeg(-z / EARTH_RADIUS_M),
  longitude: SYNTHETIC_PLACE.longitude + radToDeg(x / (EARTH_RADIUS_M * Math.cos(degToRad(SYNTHETIC_PLACE.latitude)))),
});

/** Avenue est-ouest à 100 m au sud du lieu (dans le chunk d'apparition {0,0}), longueur 5 km vers l'est. */
export const ROAD = { z: 100, startX: -200, endX: 5_000, wayLengthM: 300, nodeSpacingM: 50 };

let nextId = 1;
const id = () => nextId++;

function buildWorld() {
  nextId = 1;
  const roads = []; // { id, points: [[x, z]...] }
  for (let start = ROAD.startX; start < ROAD.endX; start += ROAD.wayLengthM) {
    const points = [];
    for (let x = start; x <= Math.min(start + ROAD.wayLengthM, ROAD.endX); x += ROAD.nodeSpacingM) points.push([x, ROAD.z]);
    roads.push({ id: id(), points });
  }
  const buildings = []; // anneaux fermés [[x, z]...]
  for (let x = ROAD.startX; x < ROAD.endX; x += 70) {
    for (const side of [-1, 1]) {
      const zCenter = ROAD.z + side * 28;
      buildings.push({ id: id(), ring: [[x, zCenter - 9], [x + 22, zCenter - 9], [x + 22, zCenter + 9], [x, zCenter + 9], [x, zCenter - 9]], levels: 3 + ((x / 70) % 4) });
    }
  }
  // Étang hors chaussée (au nord de l'avenue, jamais sur la trajectoire).
  const pond = { id: id(), ring: [[1_000, -140], [1_200, -140], [1_200, -40], [1_000, -40], [1_000, -140]] };
  return { roads, buildings, pond };
}

const world = buildWorld();

/** Mur de 6 m d'épaisseur en travers de l'avenue (toute la largeur de la route), activable pour les tests de collision. */
export const OBSTACLE = { x: Number(process.env.E2E_WALL_X ?? 2_500), thicknessM: 6 };
let obstacleEnabled = false;
export const setObstacle = (enabled) => { obstacleEnabled = enabled; };
const obstacleBuilding = () => ({
  id: 9_000_001,
  ring: [[OBSTACLE.x, ROAD.z - 14], [OBSTACLE.x + OBSTACLE.thicknessM, ROAD.z - 14], [OBSTACLE.x + OBSTACLE.thicknessM, ROAD.z + 14], [OBSTACLE.x, ROAD.z + 14], [OBSTACLE.x, ROAD.z - 14]],
  levels: 3,
});

const inBox = (point, box) => point[0] >= box.west && point[0] <= box.east && point[1] >= box.north && point[1] <= box.south;

/** Boîte locale (mètres) d'une emprise géographique `(sud,ouest,nord,est)`. */
function boxFromBounds(south, west, north, east) {
  const a = toLocal(north, west); // coin nord-ouest : plus petit z
  const b = toLocal(south, east);
  return { west: a.x, east: b.x, north: a.z, south: b.z };
}

const intersects = (points, box) => points.some((point) => inBox(point, box)) || (Math.min(...points.map((p) => p[0])) <= box.east && Math.max(...points.map((p) => p[0])) >= box.west && Math.min(...points.map((p) => p[1])) <= box.south && Math.max(...points.map((p) => p[1])) >= box.north);

/** Réponse Overpass (JSON) à une requête de l'application, déduite du texte de la requête. */
export function answerOverpass(queryText) {
  const bounds = /\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(queryText);
  if (!bounds) return { elements: [] };
  const box = boxFromBounds(...bounds.slice(1, 5).map(Number));
  const elements = [];

  if (/waterway|natural/.test(queryText)) {
    // Eau : `out geom` (géométrie inline, pas de nœuds séparés).
    if (intersects(world.pond.ring, box)) {
      elements.push({ type: 'way', id: world.pond.id, tags: { natural: 'water' }, geometry: world.pond.ring.map(([x, z]) => { const g = toGeo(x, z); return { lat: g.latitude, lon: g.longitude }; }) });
    }
    return { elements };
  }

  const wanted = /"building"/.test(queryText) ? (obstacleEnabled ? [...world.buildings, obstacleBuilding()] : world.buildings).map((b) => ({ id: b.id, points: b.ring, tags: { building: 'yes', 'building:levels': String(b.levels) } }))
    : world.roads.map((r) => ({ id: r.id, points: r.points, tags: { highway: 'primary', lanes: '2' } }));
  for (const way of wanted) {
    if (!intersects(way.points, box)) continue;
    const nodeIds = [];
    const closed = way.points.length > 3 && way.points[0][0] === way.points[way.points.length - 1][0] && way.points[0][1] === way.points[way.points.length - 1][1];
    for (const [index, [x, z]] of way.points.entries()) {
      // Un anneau fermé OSM réutilise le MÊME nœud pour son premier et son dernier point (sinon l'application le rejette : « anneau ouvert »).
      if (closed && index === way.points.length - 1) { nodeIds.push(nodeIds[0]); continue; }
      const nodeId = id();
      const g = toGeo(x, z);
      elements.push({ type: 'node', id: nodeId, lat: g.latitude, lon: g.longitude });
      nodeIds.push(nodeId);
    }
    elements.push({ type: 'way', id: way.id, nodes: nodeIds, tags: way.tags });
  }
  return { elements };
}

export const answerNominatim = () => [{ display_name: SYNTHETIC_PLACE.label, lat: String(SYNTHETIC_PLACE.latitude), lon: String(SYNTHETIC_PLACE.longitude) }];
