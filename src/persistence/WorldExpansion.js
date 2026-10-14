import { Grid, LAYER_SPECS } from '../world/Grid.js';
import { generateWorld, generateFullWorld, copyRegion } from '../world/WorldGenerator.js';
import { TERRAIN } from '../world/Terrain.js';
import { PARCEL, MAX_WORLD } from '../world/Land.js';
import { TRAFFIC_ARRAYS } from './SaveService.js';

/**
 * Agrandit une partie sauvegardée (v0.6) : la grille passe au rectangle englobant `box` (en parcelles du monde
 * possible). L'ancienne carte est recopiée à l'identique ; les nouvelles cases viennent du générateur, calculé dans
 * le monde complet généré à la création (v0.7, sans couture) ou, pour les parties plus anciennes, du générateur
 * calculé dans le repère du monde complet puis raccordé en douceur au relief existant.
 * Toutes les coordonnées et tous les indices de case enregistrés sont décalés.
 *
 * Fonction pure sur les données de sauvegarde : la partie est ensuite rechargée normalement.
 * @param {any} data sauvegarde sérialisée (serializeState)
 * @param {{catalog: import('../data/Catalog.js').Catalog, box:{x0:number,y0:number,x1:number,y1:number}}} p
 */
export function expandSave(data, { catalog, box }) {
  const out = structuredClone(data);
  const old = out.land.box;
  const W0 = out.world.width;
  const H0 = out.world.height;
  const W1 = (box.x1 - box.x0 + 1) * PARCEL;
  const H1 = (box.y1 - box.y0 + 1) * PARCEL;
  const dx = (old.x0 - box.x0) * PARCEL;
  const dy = (old.y0 - box.y0) * PARCEL;
  if (W1 > MAX_WORLD || H1 > MAX_WORLD || dx < 0 || dy < 0 || W1 < W0 + dx || H1 < H0 + dy) throw new Error('Extension de territoire invalide');

  const before = Grid.deserialize(out.world);
  const grid = new Grid(W1, H1);
  // v0.7 : le monde complet a été généré à la création de la partie ; on en recopie simplement les cases
  const seamless = out.meta.worldGen === 2 && out.meta.worldCore;
  if (seamless) {
    const world = generateFullWorld(Grid, { seed: out.meta.seed, params: out.meta.mapParams ?? {}, core: out.meta.worldCore, size: MAX_WORLD });
    copyRegion(world, grid, box.x0 * PARCEL, box.y0 * PARCEL);
  } else {
    generateWorld(grid, {
      seed: out.meta.seed,
      highwayRoadCode: catalog.road('road_highway').code,
      params: out.meta.mapParams ?? {},
      frame: { x: box.x0 * PARCEL, y: box.y0 * PARCEL, width: MAX_WORLD, height: MAX_WORLD }
    });
  }
  const fresh = new Uint8Array(grid.size).fill(1);
  for (const name of Object.keys(LAYER_SPECS)) {
    const src = before[name];
    const dst = grid[name];
    for (let y = 0; y < H0; y++) {
      const row = y * W0;
      const to = (y + dy) * W1 + dx;
      for (let x = 0; x < W0; x++) dst[to + x] = src[row + x];
    }
  }
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) fresh[(y + dy) * W1 + dx + x] = 0;

  for (let i = 0; i < grid.size; i++) if (fresh[i]) grid.tileVersion[i] = 1;

  const remap = (i) => {
    if (!Number.isInteger(i) || i < 0) return i;
    return ((i / W0) | 0) * W1 + dx + (i % W0) + dy * W1;
  };

  // Accès autoroutier : s'il n'est plus au bord, l'autoroute est prolongée jusqu'au nouveau bord
  const highway = catalog.road('road_highway').code;
  out.entries = out.entries.map((e) => {
    const ox = e % W0;
    const oy = (e / W0) | 0;
    let x = ox + dx;
    let y = oy + dy;
    const alt = grid.altitude[y * W1 + x];
    const stepTo = (tx, ty, sx, sy) => {
      while (x !== tx || y !== ty) {
        x += sx;
        y += sy;
        const i = y * W1 + x;
        fresh[i] = 0;
        grid.road[i] = highway;
        grid.zone[i] = 0;
        if (seamless && grid.terrain[i] === TERRAIN.WATER) {
          // Pont au-dessus de l'eau : le plan d'eau du monde reste intact
          grid.altitude[i] = 0;
          grid.bridge[i] = alt + 1;
          continue;
        }
        grid.terrain[i] = TERRAIN.GRASS;
        grid.altitude[i] = alt;
        grid.bridge[i] = 0;
      }
    };
    if (ox === 0 && dx > 0) stepTo(0, y, -1, 0);
    else if (ox === W0 - 1 && x < W1 - 1) stepTo(W1 - 1, y, 1, 0);
    else if (oy === 0 && dy > 0) stepTo(x, 0, 0, -1);
    else if (oy === H0 - 1 && y < H1 - 1) stepTo(x, H1 - 1, 0, 1);
    return y * W1 + x;
  });

  // Raccord du relief : au plus un niveau d'écart entre voisins ; les cases anciennes et l'autoroute ne bougent pas.
  // (Avec le monde complet de la v0.7, seules les abords de l'autoroute prolongée et les bords terrassés sont concernés.)
  const nb = new Int32Array(4);
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < grid.size; i++) {
      if (!fresh[i] || grid.terrain[i] === TERRAIN.WATER) continue;
      const n = grid.neighbors4(i, nb);
      let lo = 99;
      let hi = 0;
      for (let k = 0; k < n; k++) {
        const j = nb[k];
        if (grid.terrain[j] === TERRAIN.WATER) continue;
        lo = Math.min(lo, grid.altitude[j]);
        hi = Math.max(hi, grid.altitude[j]);
      }
      if (lo === 99) continue;
      let a = grid.altitude[i];
      if (a > lo + 1) a = lo + 1;
      if (a < hi - 1) a = hi - 1;
      grid.altitude[i] = Math.max(1, a);
    }
  }
  out.world = grid.serialize();
  for (const b of out.buildings) {
    b.x += dx;
    b.y += dy;
    b.access = remap(b.access);
  }
  for (const c of [...(out.crises?.active ?? []), ...(out.crises?.history ?? [])]) {
    if (Number.isInteger(c.x)) {
      c.x += dx;
      c.y += dy;
    }
    if (Array.isArray(c.tiles)) c.tiles = c.tiles.map(remap);
  }
  // Trafic : recalculé sur le nouveau réseau
  const stats = out.traffic?.stats ?? {};
  out.traffic = { cursor: 0, origins: [], acc: null, cycle: 0, stats };
  for (const k of Object.keys(TRAFFIC_ARRAYS)) out.traffic[k] = null;
  out.land.box = { ...box };
  out.revisions = { ...(out.revisions ?? {}), roads: (out.revisions?.roads ?? 0) + 1 };
  out.dirty = { ...(out.dirty ?? {}), roads: true, roadReach: true, utilities: true, environment: true, modifiers: true };
  return { data: out, offset: { dx, dy } };
}
