/**
 * Migrations explicites du format de sauvegarde.
 * Chaque entrée transforme une sauvegarde de la version N vers N+1. Les migrations sont appliquées
 * en chaîne jusqu'à la version courante, sur une copie : l'enregistrement d'origine n'est jamais modifié.
 */
export const CURRENT_FORMAT_VERSION = 4;

/** @type {Record<number, (data:any) => any>} */
export const MIGRATIONS = {
  /**
   * v1 → v2 : les montants financiers passent d'euros flottants à des centimes entiers,
   * et la zone de desserte des drones devient une couche de la grille.
   */
  1: (d) => {
    const toCents = (v) => Math.round((v ?? 0) * 100);
    const eco = d.economy ?? {};
    eco.treasury = toCents(eco.treasury);
    eco.ledger = (eco.ledger ?? []).map((t) => ({ ...t, amount: toCents(t.amount) }));
    for (const l of eco.loans ?? []) {
      l.principal = toCents(l.principal);
      l.remaining = toCents(l.remaining);
      l.payment = toCents(l.payment);
    }
    for (const a of eco.assets ?? []) {
      a.gross = toCents(a.gross);
      a.remaining = toCents(a.remaining);
      a.monthly = toCents(a.monthly);
    }
    d.economy = eco;
    if (d.world?.layers && !d.world.layers.deliveryZone) {
      const size = d.world.width * d.world.height;
      d.world.layers.deliveryZone = btoa('\0'.repeat(size));
    }
    d.formatVersion = 2;
    return d;
  },

  /**
   * v2 → v3 : ponts (couche « bridge »), transports en commun, déchets et ères de progression.
   * Les anciennes parties n'ont ni pont, ni réseau de transport, ni installation de déchets : valeurs neutres.
   */
  2: (d) => {
    if (d.world?.layers && !d.world.layers.bridge) {
      const size = d.world.width * d.world.height;
      d.world.layers.bridge = btoa('\0'.repeat(size));
    }
    d.transit ??= { stats: {} };
    d.waste ??= { stats: {} };
    d.progression ??= { era: 1, eraSince: 0 };
    d.economy.tariffs ??= {};
    d.economy.tariffs.transit ??= 1.2;
    d.economy.accrual ??= {};
    d.economy.accrual.transit ??= 0;
    d.economy.accrual.recycling ??= 0;
    d.formatVersion = 3;
    return d;
  },

  /**
   * v3 → v4 : améliorations des équipements (liste vide sur chaque bâtiment) et échanges régionaux
   * (tous désactivés : une ancienne partie garde exactement son équilibre).
   */
  3: (d) => {
    for (const b of d.buildings ?? []) b.upgrades ??= [];
    d.trade ??= { power: { sell: false, buy: false }, water: { sell: false, buy: false }, waste: { buy: false }, stats: {} };
    d.formatVersion = 4;
    return d;
  }
};

/**
 * @param {any} data sauvegarde brute (déjà parsée)
 * @returns {{data:any, applied:number[]}}
 */
export function migrate(data) {
  if (!data || typeof data.formatVersion !== 'number') throw new Error('Version de format absente');
  if (data.formatVersion > CURRENT_FORMAT_VERSION) {
    throw new Error(`Sauvegarde créée par une version plus récente du jeu (format ${data.formatVersion})`);
  }
  let d = structuredClone(data);
  const applied = [];
  while (d.formatVersion < CURRENT_FORMAT_VERSION) {
    const fn = MIGRATIONS[d.formatVersion];
    if (!fn) throw new Error(`Aucune migration depuis la version ${d.formatVersion}`);
    applied.push(d.formatVersion);
    d = fn(d);
  }
  return { data: d, applied };
}
