import { PARCEL, WORLD_PARCELS, landOf } from '../world/Land.js';
import { hash2 } from '../util/rng.js';
import { featureUnlocked } from './Milestones.js';

/**
 * Quartiers (v0.8) : chaque parcelle de 32 × 32 cases de la commune forme un quartier, avec un nom stable et des
 * taux d'imposition propres (écart en points par rapport au taux de la commune, de −5 à +5).
 *
 * Effets d'un écart de taux dans un quartier :
 *  - recettes : chaque bâtiment est imposé au taux de son quartier ;
 *  - satisfaction des habitants : la taxe d'habitation locale remplace celle de la commune ;
 *  - implantation et montée de niveau : un quartier moins taxé attire les constructions de son secteur
 *    (jusqu'à +35 %), un quartier plus taxé les décourage (jusqu'à −35 %) ;
 *  - demande et popularité : elles suivent le taux moyen effectivement payé dans la ville.
 */

export const DISTRICT_NAMES = [
  'Les Tilleuls', 'Bellevue', 'La Gare', 'Les Coteaux', 'Le Port', 'Les Prés', 'Les Vignes', 'La Forge',
  'Le Moulin', 'Les Jardins', 'La Croix-Blanche', 'Les Sablons', 'Le Plateau', 'Les Hauts', 'Le Faubourg', 'Les Rives',
  'La Clairière', 'Les Charmilles', 'Le Marché', 'Les Peupliers', 'La Fontaine', 'Les Brosses', 'Le Champ-Fleuri', 'Les Écluses',
  'La Roseraie', 'Le Belvédère', 'Les Ormes', 'La Prairie', 'Les Terrasses', 'Le Verger', 'Les Acacias', 'La Butte',
  'Le Pré-Vert', 'Les Bruyères', 'La Source', 'Les Marronniers', 'Le Val', 'Les Carrières', 'La Pinède', 'Les Glycines',
  'Le Bourg', 'Les Saules', 'La Cité-Jardin', 'Les Lilas', 'Le Clos', 'Les Fontaines', 'La Garenne', 'Les Chênes',
  'Le Mail', 'Les Hirondelles', 'La Chapelle', 'Les Platanes', 'Le Bois-Joli', 'Les Cerisiers', 'La Plaine', 'Les Iris',
  'Le Canal', 'Les Aulnes', 'La Tour', 'Les Frênes', 'Le Parc', 'Les Mimosas', 'La Colline', 'Les Bleuets'
];

/** Écart maximal du taux d'un quartier par rapport à celui de la commune (points). */
export const TAX_DELTA_MAX = 5;
/** Effet d'un point d'écart sur l'implantation des constructions du secteur. */
export const GROWTH_PER_POINT = 0.07;
export const SECTORS = ['R', 'C', 'O', 'I'];

export function defaultDistricts() {
  return { names: {}, tax: {}, rev: 0 };
}

export function districtsOf(state) {
  state.districts ??= defaultDistricts();
  return state.districts;
}

/** Clé de quartier (coordonnées de la parcelle dans le monde) d'une case de la carte. */
export function districtKeyAt(state, x, y) {
  const lb = landOf(state).box;
  return `${lb.x0 + Math.floor(x / PARCEL)},${lb.y0 + Math.floor(y / PARCEL)}`;
}

const permCache = new Map();
/** Permutation stable des 64 parcelles du monde selon la graine de la partie (noms uniques). */
function namePerm(seed) {
  let p = permCache.get(seed);
  if (!p) {
    const n = WORLD_PARCELS * WORLD_PARCELS;
    p = [...Array(n).keys()].sort((a, b) => hash2(a, 7, seed ^ 0xd157) - hash2(b, 7, seed ^ 0xd157));
    permCache.set(seed, p);
  }
  return p;
}

/** Quartier du centre-ville : celui de la mairie, sinon celui du cœur de la carte de départ. */
export function centreKey(state) {
  for (const b of state.buildings.values()) {
    if (b.defId === 'city_hall') return districtKeyAt(state, b.x, b.y);
  }
  const core = state.meta?.worldCore;
  if (core) return `${Math.floor((core.x + core.width / 2 - 1) / PARCEL)},${Math.floor((core.y + core.height / 2 - 1) / PARCEL)}`;
  const owned = landOf(state).owned;
  return owned[Math.floor(owned.length / 2)] ?? '0,0';
}

/** Nom d'un quartier : nom choisi par le joueur, « Centre-ville », ou nom tiré une fois pour toutes. */
export function districtName(state, key, centre = centreKey(state)) {
  const custom = state.districts?.names?.[key];
  if (custom) return custom;
  if (key === centre) return 'Centre-ville';
  const [wx, wy] = key.split(',').map(Number);
  const perm = namePerm(state.meta?.seed ?? 2030);
  return DISTRICT_NAMES[perm[(wy * WORLD_PARCELS + wx) % perm.length] % DISTRICT_NAMES.length];
}

/** Écart de taux (points) d'un quartier pour un secteur. */
export function districtDelta(state, key, sector) {
  return state.districts?.tax?.[key]?.[sector] ?? 0;
}

/**
 * Grille des écarts de taux par parcelle de la carte (cache non sauvegardé, invalidé par `districts.rev`).
 * @returns {{nx:number, ny:number, d:Float32Array}|null} null si aucun écart n'est défini
 */
export function deltaGrid(state) {
  const D = state.districts;
  if (!D?.tax) return null;
  const g = state.grid;
  const lb = landOf(state).box;
  const c = state._taxGrid;
  if (c && c.tax === D.tax && c.rev === (D.rev ?? 0) && c.x0 === lb.x0 && c.y0 === lb.y0 && c.w === g.width && c.h === g.height) return c.v;
  let v = null;
  const keys = Object.keys(D.tax);
  if (keys.length) {
    const nx = Math.ceil(g.width / PARCEL);
    const ny = Math.ceil(g.height / PARCEL);
    const d = new Float32Array(nx * ny * 4);
    for (let py = 0; py < ny; py++) {
      for (let px = 0; px < nx; px++) {
        const t = D.tax[`${lb.x0 + px},${lb.y0 + py}`];
        if (!t) continue;
        for (let k = 0; k < 4; k++) d[(py * nx + px) * 4 + k] = t[SECTORS[k]] ?? 0;
      }
    }
    v = { nx, ny, d };
  }
  Object.defineProperty(state, '_taxGrid', { value: { tax: D.tax, rev: D.rev ?? 0, x0: lb.x0, y0: lb.y0, w: g.width, h: g.height, v }, writable: true, configurable: true, enumerable: false });
  return v;
}

const SECTOR_INDEX = { R: 0, C: 1, O: 2, I: 3 };

/** Écart de taux à la case (x, y) pour un secteur (rapide, via la grille en cache). */
export function deltaAt(state, x, y, sector) {
  const dg = deltaGrid(state);
  if (!dg) return 0;
  const px = Math.floor(x / PARCEL);
  const py = Math.floor(y / PARCEL);
  if (px < 0 || py < 0 || px >= dg.nx || py >= dg.ny) return 0;
  return dg.d[(py * dg.nx + px) * 4 + SECTOR_INDEX[sector]];
}

/** Taux effectif d'un secteur à la case (x, y) : taux de la commune + écart du quartier (jamais négatif). */
export function localTax(state, x, y, sector) {
  return Math.max(0, state.economy.taxes[sector] + deltaAt(state, x, y, sector));
}

/** Multiplicateur d'implantation et de montée de niveau dû à l'écart de taux du quartier. */
export function districtGrowthFactor(state, x, y, sector) {
  const d = deltaAt(state, x, y, sector);
  return d ? Math.max(0.65, Math.min(1.35, 1 - GROWTH_PER_POINT * d)) : 1;
}

/** Taux moyens effectivement payés (pondérés par les bases), ou les taux de la commune. */
export function effectiveTaxes(state) {
  const t = state.economy.taxes;
  const e = state.economy.effTaxes;
  if (!e || !state.districts?.tax || !Object.keys(state.districts.tax).length) return t;
  return { ...t, R: e.R ?? t.R, C: e.C ?? t.C, O: e.O ?? t.O, I: e.I ?? t.I };
}

/**
 * Statistiques par quartier possédé : habitants, emplois, satisfaction, écarts de taux et recettes estimées.
 * @returns {{key:string, name:string, x:number, y:number, residents:number, jobs:number, satisfaction:number, buildings:number, tax:Record<string,number>}[]}
 */
export function districtList(state) {
  const land = landOf(state);
  const lb = land.box;
  const centre = centreKey(state);
  const map = new Map();
  for (const key of land.owned) {
    const [wx, wy] = key.split(',').map(Number);
    map.set(key, { key, name: districtName(state, key, centre), x: wx - lb.x0, y: wy - lb.y0, residents: 0, jobs: 0, sat: 0, buildings: 0, tax: { R: 0, C: 0, O: 0, I: 0, ...(state.districts?.tax?.[key] ?? {}) } });
  }
  for (const b of state.buildings.values()) {
    const d = map.get(districtKeyAt(state, b.x, b.y));
    if (!d) continue;
    d.buildings++;
    if (b.residents > 0) {
      d.residents += b.residents;
      d.sat += (b.satisfaction ?? 50) * b.residents;
    }
    d.jobs += b.jobsFilled ?? 0;
  }
  return [...map.values()].map((d) => ({ ...d, satisfaction: d.residents ? Math.round(d.sat / d.residents) : null })).sort((a, b) => b.residents - a.residents || a.key.localeCompare(b.key));
}

/** Commande : écart de taux d'un quartier pour un secteur (pas de 0,5 point, borné). */
export function setDistrictTax(state, key, sector, value) {
  if (!SECTORS.includes(sector)) return { ok: false, reason: 'Secteur inconnu' };
  if (!landOf(state).owned.includes(key)) return { ok: false, reason: 'Ce quartier n\'appartient pas à la commune' };
  const v = Math.round(Math.max(-TAX_DELTA_MAX, Math.min(TAX_DELTA_MAX, Number(value))) * 2) / 2;
  if (!Number.isFinite(v)) return { ok: false, reason: 'Valeur invalide' };
  // v1.0 : fiscalité par quartier au statut « Ville » (revenir à 0 reste toujours possible)
  if (v !== 0) {
    const f = featureUnlocked(state, 'districtTax');
    if (!f.ok) return { ok: false, reason: f.reason };
  }
  const D = districtsOf(state);
  const t = { ...(D.tax[key] ?? {}) };
  if (v === 0) delete t[sector];
  else t[sector] = v;
  if (Object.keys(t).length) D.tax[key] = t;
  else delete D.tax[key];
  D.rev = (D.rev ?? 0) + 1;
  return { ok: true, value: v };
}

/** Commande : renommer un quartier (nom vide = nom d'origine). */
export function renameDistrict(state, key, name) {
  if (!landOf(state).owned.includes(key)) return { ok: false, reason: 'Ce quartier n\'appartient pas à la commune' };
  const clean = String(name ?? '').replace(/[<>]/g, '').trim().slice(0, 32);
  const D = districtsOf(state);
  if (clean) D.names[key] = clean;
  else delete D.names[key];
  return { ok: true, name: clean };
}
