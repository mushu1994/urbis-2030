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

/**
 * Vue de la carte (v0.9) : orientation par quarts de tour et vue de dessus.
 * - rot : 0 à 3, la carte tourne de 90° dans le sens des aiguilles d'une montre à chaque cran ;
 * - top : vue de dessus (plan) au lieu de la vue isométrique ;
 * - w, h : taille de la grille (pour la rotation).
 * Toutes les fonctions de projection en tiennent compte : le dessin et le pointage suivent sans autre changement.
 */
export const VIEW = { rot: 0, top: false, w: 64, h: 64 };
/** Taille d'une case (pixels monde) en vue de dessus. */
export const TOP_TILE = 40;

export function setView({ rot = VIEW.rot, top = VIEW.top, width = VIEW.w, height = VIEW.h } = {}) {
  VIEW.rot = ((rot % 4) + 4) % 4;
  VIEW.top = !!top;
  VIEW.w = width;
  VIEW.h = height;
}

/** Hauteur à l'écran d'un niveau d'altitude (nulle en vue de dessus). */
export function heightStep() {
  return VIEW.top ? 0 : HEIGHT_STEP;
}

/** Coordonnées de grille (continues) → coordonnées tournées. */
export function rotatePoint(x, y) {
  switch (VIEW.rot) {
    case 1:
      return [VIEW.h - y, x];
    case 2:
      return [VIEW.w - x, VIEW.h - y];
    case 3:
      return [y, VIEW.w - x];
    default:
      return [x, y];
  }
}

/** Coordonnées tournées → coordonnées de grille. */
export function unrotatePoint(rx, ry) {
  switch (VIEW.rot) {
    case 1:
      return [ry, VIEW.h - rx];
    case 2:
      return [VIEW.w - rx, VIEW.h - ry];
    case 3:
      return [VIEW.w - ry, rx];
    default:
      return [rx, ry];
  }
}

/** Indices tournés d'une case entière (x, y). */
export function rotateTile(x, y) {
  switch (VIEW.rot) {
    case 1:
      return [VIEW.h - 1 - y, x];
    case 2:
      return [VIEW.w - 1 - x, VIEW.h - 1 - y];
    case 3:
      return [y, VIEW.w - 1 - x];
    default:
      return [x, y];
  }
}

/** Case de la grille correspondant aux indices tournés. */
export function unrotateTile(rx, ry) {
  switch (VIEW.rot) {
    case 1:
      return [ry, VIEW.h - 1 - rx];
    case 2:
      return [VIEW.w - 1 - rx, VIEW.h - 1 - ry];
    case 3:
      return [VIEW.w - 1 - ry, rx];
    default:
      return [rx, ry];
  }
}

/** Dimensions de la grille tournée. */
export function rotatedSize() {
  return VIEW.rot % 2 ? { w: VIEW.h, h: VIEW.w } : { w: VIEW.w, h: VIEW.h };
}

/** Déplacement de grille correspondant à un déplacement (dx, dy) dans le repère tourné. */
export function gridDir(dx, dy) {
  const [ax, ay] = unrotatePoint(0, 0);
  const [bx, by] = unrotatePoint(dx, dy);
  return [Math.round(bx - ax), Math.round(by - ay)];
}

/** Profondeur d'affichage d'une case (ordre du peintre) : diagonale dans le repère tourné. */
export function depthOf(x, y) {
  const [rx, ry] = rotateTile(x, y);
  return rx + ry;
}

/** Profondeur de la case la plus en avant d'une emprise. */
export function footDepth(x, y, w = 1, h = 1) {
  return Math.max(depthOf(x, y), depthOf(x + w - 1, y), depthOf(x, y + h - 1), depthOf(x + w - 1, y + h - 1));
}

/** Coordonnées monde d'un coin de case (x, y) à l'altitude donnée. Accepte des coordonnées fractionnaires. */
export function gridToWorld(x, y, alt = 0) {
  const [rx, ry] = rotatePoint(x, y);
  if (VIEW.top) return { x: rx * TOP_TILE, y: ry * TOP_TILE };
  return { x: ((rx - ry) * TILE_W) / 2, y: ((rx + ry) * TILE_H) / 2 - alt * HEIGHT_STEP };
}

/** Coordonnées de grille fractionnaires d'un point monde, sur le plan d'altitude donné. */
export function worldToGridFloat(wx, wy, alt = 0) {
  let rx;
  let ry;
  if (VIEW.top) {
    rx = wx / TOP_TILE;
    ry = wy / TOP_TILE;
  } else {
    const y = wy + alt * HEIGHT_STEP;
    rx = wx / TILE_W + y / TILE_H;
    ry = y / TILE_H - wx / TILE_W;
  }
  const [x, gy] = unrotatePoint(rx, ry);
  return { x, y: gy };
}

/** Centre (monde) d'une case. */
export function tileCenter(x, y, alt = 0) {
  return gridToWorld(x + 0.5, y + 0.5, alt);
}

/** Les quatre coins au sol d'un rectangle de grille, rangés par position à l'écran : haut, droite, bas, gauche. */
export function screenCorners(x, y, w, h, alt = 0) {
  const pts = [gridToWorld(x, y, alt), gridToWorld(x + w, y, alt), gridToWorld(x + w, y + h, alt), gridToWorld(x, y + h, alt)];
  if (VIEW.top) {
    // Plan : coins haut-gauche, haut-droit, bas-droit, bas-gauche rendus dans le même ordre T, R, B, L
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    return { T: { x: minX, y: minY }, R: { x: maxX, y: minY }, B: { x: maxX, y: maxY }, L: { x: minX, y: maxY } };
  }
  let T = pts[0];
  let R = pts[0];
  let B = pts[0];
  let L = pts[0];
  for (const p of pts) {
    if (p.y < T.y) T = p;
    if (p.y > B.y) B = p;
    if (p.x > R.x) R = p;
    if (p.x < L.x) L = p;
  }
  return { T, R, B, L };
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
    if (VIEW.top) return { x, y };
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
