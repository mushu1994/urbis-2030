import { h } from './dom.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { TERRAIN_NAMES } from '../data/Validators.js';
import { WASTE_KIND_LABELS } from '../simulation/WasteSystem.js';
import { TRANSIT_LABELS } from '../simulation/TransitSystem.js';

const SERVICE_LABELS = {
  police: 'Sécurité',
  fire: 'Protection incendie',
  health: 'Santé',
  education: 'Éducation',
  admin: 'Services administratifs'
};

const CITY_EFFECT_LABELS = {
  'satisfaction.all': 'Satisfaction de toute la ville',
  'demand.R': 'Demande résidentielle',
  'demand.C': 'Demande commerciale',
  'demand.O': 'Demande de bureaux',
  'demand.I': 'Demande industrielle'
};

const SOURCE_NOTES = {
  solar: 'selon l\'ensoleillement (moins en hiver)',
  wind: 'selon le vent, davantage en altitude'
};

const LOGISTICS_MODES = { cargo: 'vélos-cargos', robot: 'robots', drone: 'drones' };

const num = (v, d = 0) => formatNumber(v, d);

/**
 * Fiche descriptive d'un bâtiment, calculée à partir de ses données (aucun chiffre écrit à la main) :
 * rôle, effets, besoins, contraintes de placement, coûts, améliorations possibles.
 * @param {any} def définition normalisée
 * @param {import('../data/Catalog.js').Catalog} catalog
 * @returns {{description:string, effects:{text:string, tone:'pos'|'neg'|''}[], needs:string[], costs:{label:string, value:string}[], upgrades:number}}
 */
export function buildingSheetData(def, catalog) {
  const cap = def.capacity;
  const env = def.environment;
  const effects = [];
  const pos = (text) => effects.push({ text, tone: 'pos' });
  const neg = (text) => effects.push({ text, tone: 'neg' });
  const neutral = (text) => effects.push({ text, tone: '' });

  if (cap.powerOutput) pos(`Produit ${num(cap.powerOutput)} u. d'électricité${SOURCE_NOTES[cap.powerSource] ? ` ${SOURCE_NOTES[cap.powerSource]}` : ''}`);
  if (cap.powerStorage) pos(`Stocke ${num(cap.powerStorage)} u. d'énergie, restitue jusqu'à ${num(cap.powerDischarge)} u. en pointe`);
  if (cap.waterOutput) pos(`Produit ${num(cap.waterOutput)} u. d'eau potable`);
  if (cap.sewageTreatment) pos(`Traite ${num(cap.sewageTreatment)} u. d'eaux usées`);
  if (cap.compute) pos(`Fournit ${num(cap.compute)} unités de calcul aux technologies IA`);
  if (cap.service) {
    pos(`${SERVICE_LABELS[cap.service.type] ?? cap.service.type} : rayon de ${num(cap.service.radius)} cases, efficacité ${Math.round(cap.service.strength * 100)} %`);
  }
  if (cap.transit) {
    const t = cap.transit;
    if (t.depot) pos(`${TRANSIT_LABELS[t.mode]} : ${num(t.capacity)} voyageurs par jour pour les arrêts reliés par la route`);
    else {
      pos(`${TRANSIT_LABELS[t.mode]} : dessert un rayon de ${num(t.radius)} cases`);
      if (t.capacity) pos(`Capacité de ${num(t.capacity)} voyageurs par jour`);
    }
    if (t.mode === 'rail') pos('Retire de la route les navetteurs et les déplacements vers la région');
    if (t.mode !== 'rail') pos('Moins de voitures, temps de trajet et satisfaction améliorés');
  }
  if (cap.waste) {
    const w = cap.waste;
    if (w.collect) pos(`Collecte ${num(w.collect)} u. de déchets par jour dans un rayon de ${num(w.collectRadius ?? 8)} cases`);
    if (w.process) pos(`${WASTE_KIND_LABELS[w.kind] ?? 'Traitement'} : ${num(w.process)} u. par jour`);
    if (w.storage) neutral(`Capacité totale de ${num(w.storage)} u. : la décharge finit par être pleine`);
    if (w.powerPerUnit) pos(`Produit ${String(w.powerPerUnit).replace('.', ',')} u. d'électricité par unité de déchets traitée`);
    if (w.revenuePerUnit) pos('Revend les matériaux récupérés');
  }
  if (cap.logistics) {
    const l = cap.logistics;
    if (l.role === 'supply') pos(`Approvisionne la ville : ${num(l.throughput)} unités de marchandises par jour`);
    else pos(`Livraisons par ${LOGISTICS_MODES[l.mode] ?? l.mode} : ${num(l.capacity)} colis par jour dans un rayon de ${num(l.radius)} cases`);
    if (l.requiresDeliveryZone) neutral('Ne livre que dans les zones de desserte autorisées');
  }
  if (cap.jobs) neutral(`${num(cap.jobs)} emplois (${cap.qualification >= 0.65 ? 'très qualifiés' : cap.qualification >= 0.45 ? 'qualifiés' : 'peu qualifiés'})`);
  if (def.revenue.perMonthCents) pos(`Recettes : ${formatMoney(def.revenue.perMonthCents)} par mois${def.revenue.label ? ` (${def.revenue.label.toLowerCase()})` : ''}`);
  if (def.revenue.perUnitCents) pos('Redevances sur les marchandises traitées');
  for (const e of def.cityEffects) {
    const label = CITY_EFFECT_LABELS[e.key] ?? e.key;
    (e.value >= 0 ? pos : neg)(`${label} ${e.value >= 0 ? '+' : '−'}${String(Math.abs(e.value)).replace('.', ',')}`);
  }
  const r = env.radius;
  if (env.pollution > 0) neg(`Pollution ${num(env.pollution)} dans un rayon de ${r} cases`);
  if (env.pollution < 0) pos(`Réduit la pollution (${num(env.pollution)}) dans un rayon de ${r} cases`);
  if (env.noise > 0) neg(`Bruit ${num(env.noise)} dans un rayon de ${r} cases`);
  if (env.green > 0) pos(`Végétation +${num(env.green)} dans un rayon de ${r} cases`);
  if (env.heat > 0) neg(`Chaleur rejetée +${num(env.heat)}`);
  if (env.heat < 0) pos(`Rafraîchit le quartier (${num(env.heat)})`);
  if (env.landValue > 0) pos(`Valeur foncière +${num(env.landValue)} alentour`);
  if (env.landValue < 0) neg(`Valeur foncière ${num(env.landValue)} alentour`);
  if (def.risk) neg(`Risque d'arrêt d'urgence : ${(def.risk.monthlyChance * 100).toFixed(1).replace('.', ',')} % par mois, ${def.risk.durationDays} jours d'arrêt`);

  const needs = [];
  if (def.networks.power) needs.push(`Consomme ${num(def.networks.power)} u. d'électricité`);
  if (def.networks.water) needs.push(`Consomme ${num(def.networks.water)} u. d'eau`);
  const pl = def.placement;
  if (pl.adjacentToTerrainCode >= 0) needs.push(pl.adjacentToTerrainCode === TERRAIN_NAMES.indexOf('water') ? 'Au bord de l\'eau' : `À côté d'un terrain ${TERRAIN_NAMES[pl.adjacentToTerrainCode]}`);
  if (pl.requiresRoadAccess) needs.push('Doit toucher une route');
  if (pl.flat && def.footprint.w * def.footprint.h > 1) needs.push('Terrain plat');
  if (pl.unique) needs.push('Un seul par ville');

  const costs = [
    { label: 'Construction', value: formatMoney(def.costCents) },
    { label: 'Entretien', value: def.upkeepCents ? `${formatMoney(def.upkeepCents)} / mois` : 'aucun' },
    { label: 'Emprise', value: `${def.footprint.w} × ${def.footprint.h} cases` }
  ];
  return {
    description: def.description ?? '',
    effects,
    needs,
    costs,
    upgrades: catalog.upgradesFor(def.id).length
  };
}

/** Résumé très court (bandeau de l'outil actif) : les deux premiers effets. */
export function buildingSummary(def, catalog) {
  const d = buildingSheetData(def, catalog);
  return d.effects.slice(0, 2).map((e) => e.text).join(' · ');
}

/**
 * Fiche affichable (menu de construction).
 * @param {{kind:string, defId?:string, roadId?:string, zoneId?:string|null, label:string, desc?:string, unlock?:any}} tool
 * @param {import('../data/Catalog.js').Catalog} catalog
 * @param {{ok:boolean, reason?:string}} [unlock]
 */
export function renderToolSheet(tool, catalog, unlock = { ok: true }) {
  const locked = !unlock.ok ? h('p.sheet-locked', unlock.reason) : null;
  if (tool.kind === 'building') {
    const def = catalog.building(tool.defId);
    const d = buildingSheetData(def, catalog);
    return h('div.sheet',
      h('h4', def.name),
      locked,
      d.description ? h('p.sheet-desc', d.description) : null,
      d.effects.length ? h('ul.sheet-effects', d.effects.map((e) => h('li', { class: e.tone }, e.text))) : null,
      d.needs.length ? h('p.sheet-needs', h('strong', 'Besoins : '), d.needs.join(' · ')) : null,
      h('div.sheet-costs', d.costs.map((c) => h('span', h('small', c.label), h('strong', c.value)))),
      d.upgrades ? h('p.sheet-up', `${d.upgrades} amélioration${d.upgrades > 1 ? 's' : ''} possible${d.upgrades > 1 ? 's' : ''} après construction (sélectionnez le bâtiment).`) : null
    );
  }
  if (tool.kind === 'road') {
    const r = catalog.road(tool.roadId);
    return h('div.sheet',
      h('h4', r.name),
      locked,
      h('p.sheet-desc', r.description ?? ''),
      h('ul.sheet-effects',
        h('li.pos', `Capacité de ${num(r.capacity)} véhicules par jour`),
        h('li.pos', `Vitesse ${num(r.speedKmh)} km/h`),
        r.bridgeCostCents ? h('li', `Pont : ${formatMoney(r.bridgeCostCents)} par case sur l'eau, en ligne droite (16 cases au plus)`) : null),
      h('div.sheet-costs',
        h('span', h('small', 'Construction'), h('strong', `${formatMoney(r.costCents)} / case`)),
        h('span', h('small', 'Entretien'), h('strong', `${formatMoney(r.upkeepCents)} / case / mois`)))
    );
  }
  if (tool.kind === 'zone') {
    const z = tool.zoneId ? catalog.zoneById.get(tool.zoneId) : null;
    return h('div.sheet',
      h('h4', tool.label),
      locked,
      h('p.sheet-desc', z?.description ?? 'Rend les cases à la nature. Les bâtiments déjà construits restent en place.'),
      z ? h('p.sheet-needs', h('strong', 'Besoins : '), 'à 3 cases au plus d\'une route reliée, électricité, puis eau et services pour monter en gamme') : null,
      z ? h('div.sheet-costs', h('span', h('small', 'Zonage'), h('strong', `${formatMoney(z.costCents)} / case`))) : null
    );
  }
  return h('div.sheet', h('h4', tool.label), locked, tool.desc ? h('p.sheet-desc', tool.desc) : null);
}

