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
 * @param {{seed:number, highwayRoadCode:number, river?:boolean}} opts
 * @returns {{entries:number[]}}
 */
export function generateWorld(grid, { seed, highwayRoadCode, river = true }) {
  const { width: W, height: H } = grid;
  const rng = new Rng(seed ^ 0x5eed);
  const cx = W / 2;
  const cy = H / 2;
  const scale = 22;

  // 1. Relief brut
  const elev = new Float32Array(grid.size);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let e = fbm(x / scale, y / scale, seed);
      // Le centre de la carte est aplani pour offrir une première zone constructible.
      const d = Math.hypot((x - cx) / W, (y - cy) / H) * 2;
      const flat = Math.max(0, 1 - d * 1.6);
      e = e * (1 - flat) + 0.5 * flat;
      elev[grid.idx(x, y)] = e;
    }
  }

  // 2. Eau et altitude en terrasses
  for (let i = 0; i < grid.size; i++) {
    const e = elev[i];
    if (e < 0.3) {
      grid.terrain[i] = TERRAIN.WATER;
      grid.altitude[i] = 0;
    } else {
      grid.terrain[i] = TERRAIN.GRASS;
      grid.altitude[i] = Math.min(MAX_ALTITUDE - 1, Math.max(1, Math.floor((e - 0.3) * 7) + 1));
    }
  }

  // 3. Rivière sinueuse du nord au sud, décalée du centre
  if (river) {
    let x = Math.floor(W * (0.62 + rng.next() * 0.15));
    for (let y = 0; y < H; y++) {
      const drift = valueNoise(y / 9, 3.7, seed + 77) - 0.5;
      x = Math.max(3, Math.min(W - 4, x + Math.round(drift * 2.2)));
      const width = 2 + (valueNoise(y / 6, 9.1, seed + 13) > 0.6 ? 1 : 0);
      for (let k = 0; k < width; k++) {
        const i = grid.idx(x + k, y);
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
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = grid.idx(x, y);
      if (grid.terrain[i] === TERRAIN.WATER) continue;
      const n = grid.neighbors4(i, nb);
      let nearWater = false;
      for (let k = 0; k < n; k++) if (grid.terrain[nb[k]] === TERRAIN.WATER) nearWater = true;
      const d = Math.hypot(x - cx, y - cy);
      if (nearWater && hash2(x, y, seed + 5) < 0.55) grid.terrain[i] = TERRAIN.SAND;
      else if (grid.altitude[i] >= 3 && hash2(x, y, seed + 9) < 0.18) grid.terrain[i] = TERRAIN.ROCK;
      else if (fbm(x / 9, y / 9, seed + 333, 3) > 0.58 && d > 6) grid.terrain[i] = TERRAIN.FOREST;
    }
  }

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
