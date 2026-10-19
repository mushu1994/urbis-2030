/**
 * Migrations explicites du format de sauvegarde.
 * Chaque entrée transforme une sauvegarde de la version N vers N+1. Les migrations sont appliquées
 * en chaîne jusqu'à la version courante, sur une copie : l'enregistrement d'origine n'est jamais modifié.
 */
export const CURRENT_FORMAT_VERSION = 7;

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
  },

  /**
   * v4 → v5 : météo, crises, scénarios et options de partie. Une ancienne partie démarre avec un temps
   * neutre et les catastrophes désactivées (activables dans les paramètres de la partie).
   */
  4: (d) => {
    d.weather ??= { kind: 'cloudy', intensity: 0.4, temp: 8, since: d.time?.tick ?? 0, until: d.time?.tick ?? 0, rain7: 0, snowCover: 0, forced: null };
    d.crises ??= { active: [], history: [], nextId: 1, last: {}, ransomsPaid: 0, total: 0 };
    d.scenario ??= null;
    d.options ??= { disasters: 'off' };
    d.formatVersion = 5;
    return d;
  },

  /**
   * v5 → v6 (v1.0) : statut de la ville et équilibrage. Une ancienne partie garde l'équilibrage d'origine
   * (« legacy » : pas de charges de structure, voirie à l'ancien tarif, pas de dotation) jusqu'à ce que le
   * joueur bascule dans les paramètres ; les paliers déjà atteints sont considérés comme annoncés et dotés.
   */
  5: (d) => {
    d.options ??= {};
    d.options.balance ??= 'legacy';
    d.options.difficulty ??= 'normal';
    const peak = d.stats?.peakPopulation ?? 0;
    let rank = 0;
    for (const [r, pop] of [[1, 500], [2, 2000], [3, 5000], [4, 15000], [5, 40000], [6, 80000]]) if (peak >= pop) rank = r;
    d.milestones ??= { granted: rank, announced: rank };
    d.formatVersion = 6;
    return d;
  },

  /**
   * v6 → v7 (v1.4) : la centrale nucléaire et le réacteur à fusion passent en 8 × 8. Les centrales déjà construites
   * gardent leur emprise et leur production sous le nom « ancienne génération ». Les lignes électriques inutiles
   * sont retirées au chargement (`retireUselessPowerLines`, qui a besoin de la grille).
   */
  6: (d) => {
    const LEGACY = { power_nuclear: 'power_nuclear_legacy', power_fusion: 'power_fusion_legacy' };
    for (const b of d.buildings ?? []) if (LEGACY[b.defId]) b.defId = LEGACY[b.defId];
    d.meta ??= {};
    d.meta.retirePowerLines = true;
    d.formatVersion = 7;
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
