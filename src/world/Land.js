/**
 * Territoire de la commune (v0.6) : le monde possible fait 8 × 8 parcelles de 32 × 32 cases (256 × 256).
 * La carte de départ occupe les parcelles du centre ; le joueur achète les parcelles voisines une à une.
 * La grille du jeu couvre le rectangle englobant des parcelles achetées : une case d'une parcelle non achetée
 * (dans un territoire en « L ») reste verrouillée.
 */

export const PARCEL = 32;
export const WORLD_PARCELS = 8;
export const MAX_WORLD = PARCEL * WORLD_PARCELS;

/**
 * v1.4 : les 10 premières extensions ont un prix fixe, qui augmente d'un palier à chaque achat
 * (400 000 €, 600 000 €… 2 200 000 €). Ensuite, le prix suit l'épargne de la ville.
 */
export const PARCEL_FIXED_COUNT = 10;
export const PARCEL_FIRST_EUROS = 400_000;
export const PARCEL_STEP_EUROS = 200_000;
/** Au-delà : prix plancher (euros) et progression du prix à chaque achat. */
export const PARCEL_BASE_EUROS = 2_400_000;
export const PARCEL_GROWTH = 1.2;
/** Une heure de jeu à vitesse normale = 60 mois. */
export const PARCEL_MONTHS_OF_CASH = 60;

/** Prix fixe (euros) de la n-ième extension (n à partir de 0), ou null au-delà des extensions à prix fixe. */
export function fixedParcelEuros(n) {
  return n < PARCEL_FIXED_COUNT ? PARCEL_FIRST_EUROS + PARCEL_STEP_EUROS * n : null;
}

const key = (gx, gy) => `${gx},${gy}`;

/** Territoire initial : les parcelles couvrant la carte, centrées dans le monde possible. */
export function defaultLand(width, height) {
  const nx = Math.ceil(width / PARCEL);
  const ny = Math.ceil(height / PARCEL);
  const x0 = Math.max(0, Math.floor((WORLD_PARCELS - nx) / 2));
  const y0 = Math.max(0, Math.floor((WORLD_PARCELS - ny) / 2));
  const owned = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) owned.push(key(x0 + x, y0 + y));
  return { box: { x0, y0, x1: x0 + nx - 1, y1: y0 + ny - 1 }, owned, purchases: 0, spent: 0 };
}

/** Territoire d'une partie (créé à la volée pour les anciennes sauvegardes). */
export function landOf(state) {
  if (!state.land) state.land = defaultLand(state.grid.width, state.grid.height);
  return state.land;
}

/** Masque des cases possédées (cache non sauvegardé, recalculé quand le territoire change). */
function mask(state) {
  const land = landOf(state);
  const g = state.grid;
  const sig = `${g.width}x${g.height}:${land.owned.length}`;
  if (state._landMask?.sig === sig) return state._landMask.m;
  const set = new Set(land.owned);
  const m = new Uint8Array(g.size);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const gx = land.box.x0 + Math.floor(x / PARCEL);
      const gy = land.box.y0 + Math.floor(y / PARCEL);
      m[y * g.width + x] = set.has(key(gx, gy)) ? 1 : 0;
    }
  }
  Object.defineProperty(state, '_landMask', { value: { sig, m }, writable: true, configurable: true, enumerable: false });
  return m;
}

/** La case appartient-elle à la commune ? */
export function isOwnedIndex(state, i) {
  return mask(state)[i] === 1;
}

export function isOwned(state, x, y) {
  return isOwnedIndex(state, state.grid.idx(x, y));
}

/** Toutes les parcelles sont-elles possédées (aucune vérification nécessaire) ? */
export function fullyOwned(state) {
  const land = landOf(state);
  const n = (land.box.x1 - land.box.x0 + 1) * (land.box.y1 - land.box.y0 + 1);
  return land.owned.length >= n;
}

/**
 * Prix de la prochaine extension (centimes). Les 10 premières : prix fixe croissant. Ensuite : environ une heure de
 * jeu d'épargne (60 mois de variation moyenne de trésorerie sur les 12 derniers mois), jamais sous un plancher, et
 * 20 % plus cher à chaque achat.
 */
export function parcelPrice(state, summarize) {
  const land = landOf(state);
  const fixed = fixedParcelEuros(land.purchases);
  if (fixed !== null) return fixed * 100;
  const ps = state.economy.periods.slice(-12);
  const cash = ps.length ? ps.reduce((a, p) => a + summarize(p).cashChange, 0) / ps.length : 0;
  const base = Math.max(PARCEL_BASE_EUROS * 100, PARCEL_MONTHS_OF_CASH * Math.max(0, cash));
  return Math.round((base * Math.pow(PARCEL_GROWTH, land.purchases - PARCEL_FIXED_COUNT)) / 10000) * 10000;
}

/** État de chaque parcelle du monde possible : possédée, achetable (voisine d'une parcelle possédée) ou hors d'atteinte. */
export function parcelMap(state) {
  const land = landOf(state);
  const owned = new Set(land.owned);
  const out = [];
  for (let gy = 0; gy < WORLD_PARCELS; gy++) {
    for (let gx = 0; gx < WORLD_PARCELS; gx++) {
      const k = key(gx, gy);
      let status = 'locked';
      if (owned.has(k)) status = 'owned';
      else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => owned.has(key(gx + dx, gy + dy)))) status = 'available';
      out.push({ gx, gy, status });
    }
  }
  return out;
}

export const parcelKey = key;
