import { hash2, Rng } from '../util/rng.js';
import { TERRAIN, MAX_ALTITUDE } from './Terrain.js';

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Bruit de valeur 2D lissé, déterministe pour une graine donnée. */
function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function fbm(x, y, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Génère le terrain : relief en terrasses, rivière, lacs, plages, forêts, accès autoroutier.
 * Entièrement déterministe pour une graine donnée.
 *
 * @param {import('./Grid.js').Grid} grid
 * Paramètres de carte (v0.6, éditeur de l'écran d'accueil) en pourcentage, 50 = réglage d'origine :
 * eau (niveau des lacs, rivière), relief (hauteur des terrasses), roche (gisements), forêt (couvert boisé).
 *
 * @param {{seed:number, highwayRoadCode:number, river?:boolean, params?:{water?:number, relief?:number, rock?:number, forest?:number},
 *          frame?:{x:number, y:number, width:number, height:number}}} opts
 *   frame : la grille n'est qu'une fenêtre d'un monde plus grand (extensions de territoire) ; le relief et les
 *   centres sont calculés dans le repère de ce monde.
 * @returns {{entries:number[]}}
 */
export function generateWorld(grid, { seed, highwayRoadCode, river = true, params = {}, frame = null }) {
  const { width: W0, height: H0 } = grid;
  const fx = frame?.x ?? 0;
  const fy = frame?.y ?? 0;
  const W = frame?.width ?? W0;
  const H = frame?.height ?? H0;
  const p = { water: 50, relief: 50, rock: 50, forest: 50, ...params };
  const waterLevel = p.water === 50 ? 0.3 : 0.16 + (p.water / 100) * 0.28;
  const reliefScale = p.relief === 50 ? 7 : 1 + (p.relief / 100) * 12;
  const rockChance = p.rock === 50 ? 0.18 : Math.min(0.7, (p.rock / 50) * 0.18);
  const rockMinAlt = p.rock > 70 ? 2 : 3;
  const forestThreshold = p.forest === 50 ? 0.58 : 0.72 - (p.forest / 100) * 0.28;
  if (p.water < 8) river = false;
  const rng = new Rng(seed ^ 0x5eed);
  const cx = W / 2;
  const cy = H / 2;
  const scale = 22;

  // 1. Relief brut
  const elev = new Float32Array(grid.size);
  for (let gy = 0; gy < H0; gy++) {
    for (let gx = 0; gx < W0; gx++) {
      const x = gx + fx;
      const y = gy + fy;
      let e = fbm(x / scale, y / scale, seed);
      // Le centre de la carte est aplani pour offrir une première zone constructible.
      const d = Math.hypot((x - cx) / W, (y - cy) / H) * 2;
      const flat = Math.max(0, 1 - d * 1.6);
      e = e * (1 - flat) + 0.5 * flat;
      elev[grid.idx(gx, gy)] = e;
    }
  }

  // 2. Eau et altitude en terrasses
  for (let i = 0; i < grid.size; i++) {
    const e = elev[i];
    if (e < waterLevel) {
      grid.terrain[i] = TERRAIN.WATER;
      grid.altitude[i] = 0;
    } else {
      grid.terrain[i] = TERRAIN.GRASS;
      grid.altitude[i] = Math.min(MAX_ALTITUDE - 1, Math.max(1, Math.floor((e - waterLevel) * reliefScale) + 1));
    }
  }

  // 3. Rivière sinueuse du nord au sud, décalée du centre
  if (river) {
    let x = Math.floor(W * (0.62 + rng.next() * 0.15));
    const extra = p.water > 75 ? 1 : 0;
    for (let y = 0; y < H; y++) {
      const drift = valueNoise(y / 9, 3.7, seed + 77) - 0.5;
      x = Math.max(3, Math.min(W - 4, x + Math.round(drift * 2.2)));
      const width = 2 + extra + (valueNoise(y / 6, 9.1, seed + 13) > 0.6 ? 1 : 0);
      if (y < fy || y >= fy + H0) continue;
      for (let k = 0; k < width; k++) {
        if (x + k < fx || x + k >= fx + W0) continue;
        const i = grid.idx(x + k - fx, y - fy);
        grid.terrain[i] = TERRAIN.WATER;
        grid.altitude[i] = 0;
      }
    }
  }

  // 4. Lissage : différence d'altitude maximale de 1 entre voisins ; berges à l'altitude 1
  const nb = new Int32Array(4);
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < grid.size; i++) {
      if (grid.terrain[i] === TERRAIN.WATER) continue;
      const n = grid.neighbors4(i, nb);
      let minN = 99;
      for (let k = 0; k < n; k++) minN = Math.min(minN, grid.altitude[nb[k]]);
      if (grid.altitude[i] > minN + 1) grid.altitude[i] = minN + 1;
      if (grid.altitude[i] < 1) grid.altitude[i] = 1;
    }
  }

  // 5. Plages, forêts et roche
  for (let gy = 0; gy < H0; gy++) {
    for (let gx = 0; gx < W0; gx++) {
      const x = gx + fx;
      const y = gy + fy;
      const i = grid.idx(gx, gy);
      if (grid.terrain[i] === TERRAIN.WATER) continue;
      const n = grid.neighbors4(i, nb);
      let nearWater = false;
      for (let k = 0; k < n; k++) if (grid.terrain[nb[k]] === TERRAIN.WATER) nearWater = true;
      const d = Math.hypot(x - cx, y - cy);
      if (nearWater && hash2(x, y, seed + 5) < 0.55) grid.terrain[i] = TERRAIN.SAND;
      else if (grid.altitude[i] >= rockMinAlt && hash2(x, y, seed + 9) < rockChance) grid.terrain[i] = TERRAIN.ROCK;
      else if (fbm(x / 9, y / 9, seed + 333, 3) > forestThreshold && d > 6) grid.terrain[i] = TERRAIN.FOREST;
    }
  }
  if (frame) return { entries: [] };

  // 6. Accès autoroutier sur le bord ouest, sur la ligne terrestre la plus proche du centre
  const entries = [];
  const entryLen = 3;
  let row = -1;
  for (let off = 0; off < H / 2 && row < 0; off++) {
    for (const y of [Math.floor(cy) + off, Math.floor(cy) - off]) {
      if (y < 1 || y >= H - 1) continue;
      let ok = true;
      for (let x = 0; x <= entryLen + 1; x++) if (grid.terrain[grid.idx(x, y)] === TERRAIN.WATER) ok = false;
      if (ok) {
        row = y;
        break;
      }
    }
  }
  if (row < 0) row = Math.floor(cy);
  const alt = Math.max(1, grid.altitude[grid.idx(entryLen, row)]);
  for (let x = 0; x < entryLen; x++) {
    const i = grid.idx(x, row);
    grid.terrain[i] = TERRAIN.GRASS;
    grid.altitude[i] = alt;
    grid.road[i] = highwayRoadCode;
    if (x === 0) entries.push(i);
  }
  return { entries };
}
