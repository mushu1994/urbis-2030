/**
 * Projection isométrique 2,5D.
 * La grille logique (x, y) est la source de vérité ; ces fonctions ne servent qu'au rendu et au pointage.
 *
 * Repères :
 *  - « monde » : pixels de la scène avant transformation de caméra. (gridToWorld(x, y) = sommet nord de la case.)
 *  - « écran » : pixels CSS relatifs au canevas, après caméra (zoom + translation).
 */
export const TILE_W = 64;
export const TILE_H = 32;
/** Élévation (en pixels monde) d'un niveau d'altitude. */
export const HEIGHT_STEP = 12;

/** Projection de base sans hauteur (formule du cahier des charges). */
export function gridToScreen(x, y, tileWidth = TILE_W, tileHeight = TILE_H) {
  return {
    x: ((x - y) * tileWidth) / 2,
    y: ((x + y) * tileHeight) / 2
  };
}

/** Inverse de gridToScreen (sans hauteur). */
export function screenToGrid(screenX, screenY, tileWidth = TILE_W, tileHeight = TILE_H) {
  const gx = screenX / tileWidth + screenY / tileHeight;
  const gy = screenY / tileHeight - screenX / tileWidth;
  return { x: Math.floor(gx), y: Math.floor(gy) };
}

/** Coordonnées monde du sommet nord de la case (x, y) à l'altitude donnée. Accepte des coordonnées fractionnaires. */
export function gridToWorld(x, y, alt = 0) {
  return { x: ((x - y) * TILE_W) / 2, y: ((x + y) * TILE_H) / 2 - alt * HEIGHT_STEP };
}

/** Coordonnées de grille fractionnaires d'un point monde, sur le plan d'altitude donné. */
export function worldToGridFloat(wx, wy, alt = 0) {
  const y = wy + alt * HEIGHT_STEP;
  return { x: wx / TILE_W + y / TILE_H, y: y / TILE_H - wx / TILE_W };
}

/** Centre (monde) d'une case. */
export function tileCenter(x, y, alt = 0) {
  const p = gridToWorld(x, y, alt);
  return { x: p.x, y: p.y + TILE_H / 2 };
}

/**
 * Conversion écran → monde selon la caméra.
 * @param {{x:number, y:number, zoom:number}} camera centre de la vue en coordonnées monde et facteur de zoom
 * @param {{width:number, height:number}} view taille du canevas (pixels CSS)
 */
export function screenToWorld(sx, sy, camera, view) {
  return {
    x: (sx - view.width / 2) / camera.zoom + camera.x,
    y: (sy - view.height / 2) / camera.zoom + camera.y
  };
}

export function worldToScreen(wx, wy, camera, view) {
  return {
    x: (wx - camera.x) * camera.zoom + view.width / 2,
    y: (wy - camera.y) * camera.zoom + view.height / 2
  };
}

/**
 * Case pointée en tenant compte de l'altitude : on teste les plans du plus haut au plus bas
 * et on retient la première case dont l'altitude correspond (une colline masque ce qui est derrière).
 * @param {{width:number, height:number, altitude: Uint8Array}} grid
 * @returns {{x:number, y:number} | null}
 */
export function pickTile(grid, wx, wy, maxAlt = 4) {
  for (let h = maxAlt; h >= 0; h--) {
    const f = worldToGridFloat(wx, wy, h);
    const x = Math.floor(f.x);
    const y = Math.floor(f.y);
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
    const i = y * grid.width + x;
    // Un pont est pointé à hauteur de son tablier.
    const alt = grid.bridge?.[i] ? grid.bridge[i] - 1 : grid.altitude[i];
    if (alt === h) return { x, y };
  }
  const f = worldToGridFloat(wx, wy, 0);
  const x = Math.floor(f.x);
  const y = Math.floor(f.y);
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  return { x, y };
}

/** Pointage complet écran → case. */
export function screenToTile(grid, sx, sy, camera, view, maxAlt = 4) {
  const w = screenToWorld(sx, sy, camera, view);
  return pickTile(grid, w.x, w.y, maxAlt);
}
