/**
 * Améliorations des équipements publics.
 * Une amélioration modifie les caractéristiques d'un seul bâtiment (rayon, capacité, nuisances…).
 * Les systèmes de simulation lisent la définition « effective » d'un bâtiment via `catalog.buildingFor(b)`,
 * qui combine la définition de base et les améliorations installées.
 */

/**
 * Effets reconnus. `op` : 'add' ajoute la valeur, 'mul' multiplie.
 * `label` et `format` servent aux fiches de l'interface.
 */
export const UPGRADE_EFFECTS = {
  serviceRadius: { op: 'add', label: 'Rayon d\'action', unit: 'cases' },
  serviceStrength: { op: 'mul', label: 'Efficacité du service' },
  transitCapacity: { op: 'mul', label: 'Capacité de voyageurs' },
  transitRadius: { op: 'add', label: 'Rayon desservi', unit: 'cases' },
  wasteCollect: { op: 'mul', label: 'Collecte des déchets' },
  wasteRadius: { op: 'add', label: 'Rayon de collecte', unit: 'cases' },
  wasteProcess: { op: 'mul', label: 'Capacité de traitement' },
  wasteStorage: { op: 'mul', label: 'Capacité de stockage' },
  wastePower: { op: 'mul', label: 'Électricité par tonne' },
  wasteRevenue: { op: 'mul', label: 'Recette des matériaux' },
  powerOutput: { op: 'mul', label: 'Production d\'électricité' },
  powerStorage: { op: 'mul', label: 'Stockage d\'énergie' },
  waterOutput: { op: 'mul', label: 'Production d\'eau' },
  sewageTreatment: { op: 'mul', label: 'Eaux usées traitées' },
  compute: { op: 'mul', label: 'Puissance de calcul' },
  powerNeed: { op: 'mul', label: 'Consommation électrique', bad: true },
  pollution: { op: 'mul', label: 'Pollution', bad: true },
  noise: { op: 'mul', label: 'Bruit', bad: true },
  heat: { op: 'mul', label: 'Chaleur rejetée', bad: true },
  green: { op: 'mul', label: 'Végétation' },
  landValue: { op: 'add', label: 'Valeur foncière alentour', unit: 'pts' },
  riskChance: { op: 'mul', label: 'Risque d\'arrêt d\'urgence', bad: true },
  revenue: { op: 'mul', label: 'Recettes' },
  satisfaction: { op: 'add', label: 'Satisfaction de toute la ville', unit: 'pt' }
};

/** Texte court d'un effet : « Rayon d'action +4 cases », « Pollution −45 % ». */
export function formatUpgradeEffect(key, value) {
  const spec = UPGRADE_EFFECTS[key];
  if (!spec) return key;
  if (spec.op === 'mul') {
    const pct = Math.round((value - 1) * 100);
    return `${spec.label} ${pct >= 0 ? '+' : '−'}${Math.abs(pct)} %`;
  }
  const v = Math.round(value * 10) / 10;
  return `${spec.label} ${v >= 0 ? '+' : '−'}${String(Math.abs(v)).replace('.', ',')}${spec.unit ? ` ${spec.unit}` : ''}`;
}

/** L'effet est-il favorable au joueur ? (une baisse de pollution est favorable) */
export function isGoodEffect(key, value) {
  const spec = UPGRADE_EFFECTS[key];
  const up = spec?.op === 'mul' ? value > 1 : value > 0;
  return spec?.bad ? !up : up;
}

/**
 * Définition effective d'un bâtiment après application des améliorations (nouvel objet ; la définition
 * de base n'est jamais modifiée).
 * @param {any} def définition normalisée
 * @param {any[]} ups améliorations normalisées
 */
export function applyUpgrades(def, ups) {
  const cap = { ...def.capacity };
  if (cap.service) cap.service = { ...cap.service };
  if (cap.transit) cap.transit = { ...cap.transit };
  if (cap.waste) cap.waste = { ...cap.waste };
  const env = { ...def.environment };
  const networks = { ...def.networks };
  const revenue = { ...def.revenue };
  const risk = def.risk ? { ...def.risk } : null;
  const cityEffects = [...def.cityEffects];
  let upkeepCents = def.upkeepCents;
  for (const up of ups) {
    upkeepCents += up.upkeepCents;
    for (const [key, v] of Object.entries(up.effects)) {
      switch (key) {
        case 'serviceRadius':
          if (cap.service) cap.service.radius += v;
          break;
        case 'serviceStrength':
          if (cap.service) cap.service.strength *= v;
          break;
        case 'transitCapacity':
          if (cap.transit?.capacity) cap.transit.capacity *= v;
          break;
        case 'transitRadius':
          if (cap.transit?.radius) cap.transit.radius += v;
          break;
        case 'wasteCollect':
          if (cap.waste?.collect) cap.waste.collect *= v;
          break;
        case 'wasteRadius':
          if (cap.waste?.collectRadius) cap.waste.collectRadius += v;
          break;
        case 'wasteProcess':
          if (cap.waste?.process) cap.waste.process *= v;
          break;
        case 'wasteStorage':
          if (cap.waste?.storage) cap.waste.storage *= v;
          break;
        case 'wastePower':
          if (cap.waste?.powerPerUnit) cap.waste.powerPerUnit *= v;
          break;
        case 'wasteRevenue':
          if (cap.waste?.revenuePerUnit) cap.waste.revenuePerUnit *= v;
          break;
        case 'powerOutput':
        case 'powerStorage':
        case 'waterOutput':
        case 'sewageTreatment':
        case 'compute':
          cap[key] *= v;
          if (key === 'powerStorage') cap.powerDischarge *= v;
          break;
        case 'powerNeed':
          networks.power *= v;
          break;
        case 'pollution':
        case 'noise':
        case 'heat':
        case 'green':
          env[key] *= v;
          break;
        case 'landValue':
          env.landValue += v;
          break;
        case 'riskChance':
          if (risk) risk.monthlyChance *= v;
          break;
        case 'revenue':
          revenue.perMonthCents = Math.round(revenue.perMonthCents * v);
          break;
        case 'satisfaction':
          cityEffects.push({ key: 'satisfaction.all', op: 'add', value: v });
          break;
        default:
      }
    }
  }
  return {
    ...def,
    capacity: cap,
    environment: env,
    networks,
    revenue,
    risk,
    cityEffects,
    upkeepCents,
    upgradeIds: ups.map((u) => u.id)
  };
}
