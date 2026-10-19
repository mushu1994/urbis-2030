/**
 * Validation des données externes : catalogues JSON et sauvegardes.
 * Chaque fonction retourne la liste des erreurs (vide = valide) pour pouvoir les afficher.
 */

export const TERRAIN_NAMES = ['grass', 'water', 'forest', 'sand', 'rock'];
export const CATEGORIES = [
  'roads', 'residential_low', 'residential_high', 'commerce', 'offices', 'industry',
  'logistics', 'energy', 'water', 'parks', 'services', 'transport', 'waste'
];

/** Conditions d'évolution reconnues (voir BuildingSystem.growthChecks). */
export const GROWTH_REQUIREMENTS = ['power', 'water', 'waste', 'education', 'health', 'transit', 'era2', 'era3'];
export const WASTE_KINDS = ['landfill', 'incinerator', 'recycling', 'biogas', 'valorisation'];
export const TRANSIT_MODES = ['bus', 'metro', 'rail', 'tram'];

import { UPGRADE_EFFECTS } from './Upgrades.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPosInt = (v) => Number.isInteger(v) && v > 0;

/**
 * @param {{roads:any[], zones:any[], buildings:any[]}} b catalogue des bâtiments
 * @param {{technologies:any[]}} t
 * @param {{policies:any[]}} p
 * @param {{upgrades:any[]}} [u]
 * @returns {string[]}
 */
export function validateCatalogData(b, t, p, u) {
  const errors = [];
  if (!b || !Array.isArray(b.buildings) || !Array.isArray(b.roads) || !Array.isArray(b.zones)) {
    return ['buildings.json : sections roads/zones/buildings manquantes'];
  }
  const ids = new Set();
  const dup = (id, where) => {
    if (typeof id !== 'string' || !id) errors.push(`${where} : identifiant manquant`);
    else if (ids.has(id)) errors.push(`${where} : identifiant dupliqué « ${id} »`);
    else ids.add(id);
  };

  for (const r of b.roads) {
    dup(r.id, 'route');
    if (!isNum(r.capacity) || r.capacity <= 0) errors.push(`route ${r.id} : capacité invalide`);
    if (!isNum(r.speedKmh) || r.speedKmh <= 0) errors.push(`route ${r.id} : vitesse invalide`);
    if (!isNum(r.cost) || r.cost < 0) errors.push(`route ${r.id} : coût invalide`);
  }
  const zoneIds = new Set();
  for (const z of b.zones) {
    dup(z.id, 'zone');
    zoneIds.add(z.id);
    if (!isPosInt(z.code)) errors.push(`zone ${z.id} : code invalide`);
  }

  const buildingIds = new Set(b.buildings.map((x) => x.id));
  for (const d of b.buildings) {
    const w = `bâtiment ${d.id}`;
    dup(d.id, 'bâtiment');
    if (typeof d.name !== 'string') errors.push(`${w} : nom manquant`);
    if (!CATEGORIES.includes(d.category)) errors.push(`${w} : catégorie inconnue « ${d.category} »`);
    if (d.kind !== 'growable' && d.kind !== 'plop') errors.push(`${w} : type « ${d.kind} » inconnu`);
    if (!d.footprint || !isPosInt(d.footprint.w) || !isPosInt(d.footprint.h)) errors.push(`${w} : emprise invalide`);
    if (d.kind === 'growable') {
      if (!zoneIds.has(d.zone)) errors.push(`${w} : zone « ${d.zone} » inconnue`);
      if (!isPosInt(d.level)) errors.push(`${w} : niveau invalide`);
      if (d.growth?.next && !buildingIds.has(d.growth.next)) errors.push(`${w} : évolution vers « ${d.growth.next} » inconnue`);
      for (const r of d.growth?.requires ?? []) {
        if (!GROWTH_REQUIREMENTS.includes(r)) errors.push(`${w} : condition d'évolution « ${r} » inconnue`);
      }
    } else {
      if (!isNum(d.cost) || d.cost < 0) errors.push(`${w} : coût invalide`);
      if (!isNum(d.upkeep) || d.upkeep < 0) errors.push(`${w} : entretien invalide`);
      for (const terr of d.placement?.terrain ?? []) {
        if (!TERRAIN_NAMES.includes(terr)) errors.push(`${w} : terrain « ${terr} » inconnu`);
      }
      const ws = d.capacity?.waste;
      if (ws) {
        if (ws.kind && !WASTE_KINDS.includes(ws.kind)) errors.push(`${w} : type de traitement « ${ws.kind} » inconnu`);
        if (!ws.collect && !ws.process) errors.push(`${w} : installation de déchets sans collecte ni traitement`);
        if (ws.kind === 'landfill' && !(ws.storage > 0)) errors.push(`${w} : décharge sans capacité de stockage`);
      }
      const tr = d.capacity?.transit;
      if (tr && !TRANSIT_MODES.includes(tr.mode)) errors.push(`${w} : mode de transport « ${tr.mode} » inconnu`);
      for (const e of d.cityEffects ?? []) errors.push(...validateEffect(e, w));
      if (d.risk && !(d.risk.monthlyChance >= 0 && d.risk.durationDays > 0)) errors.push(`${w} : risque invalide`);
    }
    if (d.unlock?.era && ![1, 2, 3].includes(d.unlock.era)) errors.push(`${w} : ère de déblocage invalide`);
    if (d.unlock?.milestone !== undefined && !(Number.isInteger(d.unlock.milestone) && d.unlock.milestone >= 1 && d.unlock.milestone <= 6)) errors.push(`${w} : palier de déblocage invalide`);
    if (!d.visual || !isNum(d.visual.height)) errors.push(`${w} : paramètres visuels manquants`);
  }

  const techIds = new Set((t?.technologies ?? []).map((x) => x.id));
  for (const tech of t?.technologies ?? []) {
    dup(tech.id, 'technologie');
    if (!isNum(tech.cost) || !isNum(tech.upkeep)) errors.push(`technologie ${tech.id} : coûts invalides`);
    if (tech.unlock?.tech && !techIds.has(tech.unlock.tech)) errors.push(`technologie ${tech.id} : prérequis « ${tech.unlock.tech} » inconnu`);
    for (const bid of tech.unlocksBuildings ?? []) {
      if (!buildingIds.has(bid)) errors.push(`technologie ${tech.id} : bâtiment « ${bid} » inconnu`);
    }
    for (const e of tech.effects ?? []) errors.push(...validateEffect(e, `technologie ${tech.id}`));
    for (const r of tech.risks ?? []) {
      if (!isNum(r.monthlyChance ?? 0)) errors.push(`technologie ${tech.id} : risque invalide`);
    }
  }
  for (const d of b.buildings) {
    if (d.unlock?.tech && !techIds.has(d.unlock.tech)) errors.push(`bâtiment ${d.id} : technologie « ${d.unlock.tech} » inconnue`);
  }
  for (const pol of p?.policies ?? []) {
    dup(pol.id, 'politique');
    if (!isNum(pol.monthlyCost)) errors.push(`politique ${pol.id} : coût mensuel invalide`);
    for (const e of pol.effects ?? []) errors.push(...validateEffect(e, `politique ${pol.id}`));
  }
  const plopIds = new Set(b.buildings.filter((x) => x.kind === 'plop').map((x) => x.id));
  for (const up of u?.upgrades ?? []) {
    const w = `amélioration ${up.id}`;
    dup(up.id, 'amélioration');
    if (typeof up.name !== 'string' || !up.name) errors.push(`${w} : nom manquant`);
    if (!isNum(up.cost) || up.cost < 0 || !isNum(up.upkeep ?? 0)) errors.push(`${w} : coûts invalides`);
    if (!Array.isArray(up.appliesTo) || !up.appliesTo.length) errors.push(`${w} : aucun bâtiment concerné`);
    for (const bid of up.appliesTo ?? []) {
      if (!plopIds.has(bid)) errors.push(`${w} : bâtiment « ${bid} » inconnu ou non constructible`);
    }
    const effects = Object.entries(up.effects ?? {});
    if (!effects.length) errors.push(`${w} : aucun effet`);
    for (const [k, v] of effects) {
      if (!UPGRADE_EFFECTS[k]) errors.push(`${w} : effet « ${k} » inconnu`);
      else if (!isNum(v) || (UPGRADE_EFFECTS[k].op === 'mul' && v <= 0)) errors.push(`${w} : valeur invalide pour « ${k} »`);
    }
    if (up.unlock?.tech && !techIds.has(up.unlock.tech)) errors.push(`${w} : technologie « ${up.unlock.tech} » inconnue`);
    if (up.unlock?.era && ![1, 2, 3].includes(up.unlock.era)) errors.push(`${w} : ère de déblocage invalide`);
    // v1.4 : filières à niveaux (niveau entier ≥ 1, filière nommée)
    if (up.level !== undefined && !(Number.isInteger(up.level) && up.level >= 1)) errors.push(`${w} : niveau invalide`);
    if (up.level !== undefined && typeof up.track !== 'string') errors.push(`${w} : niveau sans filière`);
  }
  // Chaque niveau d'une filière (au-delà du premier) doit avoir un niveau précédent pour au moins un bâtiment concerné
  for (const up of u?.upgrades ?? []) {
    if (!(up.level > 1)) continue;
    const ok = up.appliesTo.some((bid) => (u.upgrades ?? []).some((o) => o.track === up.track && o.level < up.level && o.appliesTo.includes(bid)));
    if (!ok) errors.push(`amélioration ${up.id} : niveau ${up.level} sans niveau précédent`);
  }
  return errors;
}

function validateEffect(e, where) {
  const errs = [];
  if (typeof e.key !== 'string') errs.push(`${where} : effet sans clé`);
  if (e.op !== 'add' && e.op !== 'mul') errs.push(`${where} : opération d'effet « ${e.op} » inconnue`);
  if (!isNum(e.value)) errs.push(`${where} : valeur d'effet invalide`);
  return errs;
}

/**
 * Validation structurelle d'une sauvegarde (après migration, avant intégration à la simulation).
 * @param {any} data
 * @param {number} expectedVersion
 * @returns {string[]}
 */
export function validateSaveData(data, expectedVersion) {
  const e = [];
  if (!data || typeof data !== 'object') return ['Sauvegarde vide ou illisible'];
  if (data.formatVersion !== expectedVersion) e.push(`Version de format ${data.formatVersion} ≠ ${expectedVersion}`);
  const w = data.world;
  if (!w || !isPosInt(w.width) || !isPosInt(w.height)) e.push('Dimensions du monde invalides');
  else {
    if (w.width > 512 || w.height > 512) e.push('Carte trop grande');
    for (const k of ['terrain', 'altitude', 'zone', 'road', 'building', 'bridge']) {
      if (typeof w.layers?.[k] !== 'string') e.push(`Couche « ${k} » manquante`);
    }
  }
  if (!Array.isArray(data.buildings)) e.push('Liste des bâtiments manquante');
  else {
    for (const b of data.buildings) {
      if (!isPosInt(b.id) || typeof b.defId !== 'string' || !Number.isInteger(b.x) || !Number.isInteger(b.y)) {
        e.push(`Bâtiment invalide (${JSON.stringify(b).slice(0, 60)})`);
        break;
      }
      if (b.residents < 0 || b.jobsFilled < 0 || !isNum(b.residents ?? 0)) {
        e.push(`Bâtiment ${b.id} : effectifs invalides`);
        break;
      }
    }
  }
  const eco = data.economy;
  if (!eco || !Number.isInteger(eco.treasury)) e.push('Trésorerie invalide (entier en centimes attendu)');
  if (!data.time || !Number.isInteger(data.time.tick) || data.time.tick < 0) e.push('Temps de simulation invalide');
  if (!Number.isInteger(data.rng)) e.push('État du générateur aléatoire invalide');
  return e;
}
