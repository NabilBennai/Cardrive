import { useEffect, useRef } from 'react';
import { unprojectFromLocal, type GeoAnchor } from '../geo/projection';
import { geoToTilePixel, TILE_SIZE_PX, type TileCoord } from '../map/tileMath';

// tile.openstreetmap.org : tuiles standard, usage léger et ponctuel (une grille 3×3 rechargée
// seulement quand le véhicule change de tuile centrale, pas par frame) — même diligence
// d'attribution/quota que pour Overpass. Attribution affichée sous la mini-carte.
const TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ZOOM = 17;
const GRID = 3; // grille 3x3 autour de la tuile centrale, recomposée seulement au changement de tuile
const VIEW_SIZE_PX = 150;

interface MinimapProps {
  anchor: GeoAnchor;
  positionM: { xM: number; zM: number };
  headingRad: number;
}

function loadTileImage(tile: TileCoord): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Tuile OSM introuvable (${tile.z}/${tile.x}/${tile.y}).`));
    image.src = TILE_URL_TEMPLATE.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y));
  });
}

export function Minimap({ anchor, positionM, headingRad }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridOriginRef = useRef<TileCoord | null>(null);
  const loadingCenterKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const geoPoint = unprojectFromLocal({ xM: positionM.xM, yM: 0, zM: positionM.zM }, anchor);
    const { tile: centerTile, pixelX, pixelY } = geoToTilePixel(geoPoint, ZOOM);
    const centerKey = `${centerTile.z}/${centerTile.x}/${centerTile.y}`;

    if (loadingCenterKeyRef.current !== centerKey) {
      loadingCenterKeyRef.current = centerKey;
      const origin: TileCoord = { z: centerTile.z, x: centerTile.x - 1, y: centerTile.y - 1 };
      if (!gridCanvasRef.current) gridCanvasRef.current = document.createElement('canvas');
      const grid = gridCanvasRef.current;
      grid.width = GRID * TILE_SIZE_PX;
      grid.height = GRID * TILE_SIZE_PX;
      const gridContext = grid.getContext('2d');
      const tiles: Array<{ coord: TileCoord; col: number; row: number }> = [];
      for (let row = 0; row < GRID; row += 1) {
        for (let col = 0; col < GRID; col += 1) {
          tiles.push({ coord: { z: origin.z, x: origin.x + col, y: origin.y + row }, col, row });
        }
      }
      Promise.allSettled(tiles.map(({ coord }) => loadTileImage(coord))).then((results) => {
        if (loadingCenterKeyRef.current !== centerKey || !gridContext) return;
        results.forEach((result, index) => {
          if (result.status !== 'fulfilled') return;
          const { col, row } = tiles[index];
          gridContext.drawImage(result.value, col * TILE_SIZE_PX, row * TILE_SIZE_PX);
        });
        gridOriginRef.current = origin;
        drawView();
      });
    }

    drawView();

    function drawView() {
      const canvas = canvasRef.current;
      const origin = gridOriginRef.current;
      const grid = gridCanvasRef.current;
      if (!canvas || !origin || !grid) return;
      const context = canvas.getContext('2d');
      if (!context) return;

      const globalPixelX = (centerTile.x - origin.x) * TILE_SIZE_PX + pixelX;
      const globalPixelY = (centerTile.y - origin.y) * TILE_SIZE_PX + pixelY;
      const sourceX = globalPixelX - VIEW_SIZE_PX / 2;
      const sourceY = globalPixelY - VIEW_SIZE_PX / 2;
      const outOfBounds = sourceX < 0 || sourceY < 0 || sourceX + VIEW_SIZE_PX > grid.width || sourceY + VIEW_SIZE_PX > grid.height;
      if (outOfBounds) return; // la nouvelle grille 3x3 est en cours de chargement, on garde la dernière image affichée

      context.clearRect(0, 0, VIEW_SIZE_PX, VIEW_SIZE_PX);
      context.drawImage(grid, sourceX, sourceY, VIEW_SIZE_PX, VIEW_SIZE_PX, 0, 0, VIEW_SIZE_PX, VIEW_SIZE_PX);

      // Carte orientée nord en haut : la flèche de cap est dessinée pointant vers le bas (sud,
      // +Z monde à cap 0) puis tournée de -headingRad. Dérivation : forward=+X monde (est, cap
      // π/2) doit pointer à droite sur un canvas nord-en-haut ; rotate(-π/2) appliqué à un
      // vecteur "bas" (0,1) donne bien (1,0) = droite. Vérifié aussi pour cap 0 (sud = bas) et
      // cap π (nord = haut).
      const centerX = VIEW_SIZE_PX / 2;
      const centerY = VIEW_SIZE_PX / 2;
      context.save();
      context.translate(centerX, centerY);
      context.rotate(-headingRad);
      context.beginPath();
      context.moveTo(0, 9);
      context.lineTo(-6, -7);
      context.lineTo(0, -3);
      context.lineTo(6, -7);
      context.closePath();
      context.fillStyle = '#3b7dd8';
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.5;
      context.fill();
      context.stroke();
      context.restore();
    }
  }, [anchor, positionM.xM, positionM.zM, headingRad]);

  return <canvas ref={canvasRef} width={VIEW_SIZE_PX} height={VIEW_SIZE_PX} className="minimap-canvas" aria-label="Position en temps réel" />;
}
