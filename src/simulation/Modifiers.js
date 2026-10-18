import { SIM } from './config.js';
import { weatherEffects } from './WeatherSystem.js';
import { councilEffects } from './CouncilSystem.js';

/**
 * Modificateurs globaux appliqués par les technologies, les politiques et les événements.
 * Convention : un effet "mul" de valeur v multiplie par (1 + v) ; un effet "add" ajoute v.
 */
export const DEFAULT_MODIFIERS = Object.freeze({
  roadCapacityMult: 1,
  travelTimeMult: 1,
  tripGenerationMult: 1,
  emptyTripShare: 0,
  carModeShare: 0,
  'upkeep.roads': 1,
  'upkeep.utilities': 1,
  'upkeep.services': 1,
  /** v1.0 : charges de structure (administration générale et personnel). */
  'upkeep.structure': 1,
  'pollution.traffic': 1,
  'pollution.buildings': 1,
  'noise.traffic': 1,
  'satisfaction.all': 0,
  'satisfaction.low': 0,
  'satisfaction.mid': 0,
  'satisfaction.high': 0,
  'landValue.add': 0,
  taxEfficiency: 1,
  deliveryTimeMult: 1,
  'demand.R': 0,
  'demand.C': 0,
  'demand.O': 0,
  'demand.I': 0,
  rentMult: 1,
  'growth.R': 1,
  'growth.all': 1,
  powerDemandMult: 1,
  heatMult: 1,
  freightPeakMult: 1,
  windFactor: 1,
  solarFactor: 1,
  'upkeep.transport': 1,
  'waste.collectMult': 1,
  'waste.generationMult': 1,
  'waste.recycleMult': 1,
  'transit.ridershipMult': 1,
  'transit.busCapacityMult': 1,
  'transit.fareMult': 1,
  waterDemandMult: 1,
  /** Multiplicateurs de risque des crises (1 = risque normal ; < 1 = atténué par une politique). */
  'risk.flood': 1,
  'risk.heat': 1,
  'risk.cyber': 1,
  'risk.blackout': 1,
  'risk.strike': 1,
  'risk.fire': 1,
  /** v0.7 : emploi. Bonus de qualification visé, part des actifs requalifiés vers l'échelon supérieur, part des
   *  emplois vacants pourvus par des navetteurs de la région. */
  'jobs.qualification': 0,
  'jobs.upskill': 0,
  'jobs.commuters': 0.25,
  /** Part des actifs absents (épidémie). */
  'jobs.absence': 0,
  /** v0.7 : risques sociaux (manifestations, émeutes, épidémies). */
  'risk.protest': 1,
  'risk.riot': 1,
  'risk.epidemic': 1,
  /** v0.7 : opinion (points de popularité par mois). */
  'approval.add': 0,
  /** v1.1 : écart de taux des nouveaux emprunts (adjoint aux Finances). */
  'loan.rate': 0
});

/** Un bâtiment est-il en état de fonctionner (ni abandonné, ni arrêté par un incident) ? */
export function isOperational(state, b) {
  return !b.abandoned && !(b.disabledUntil > state.time.tick);
}

/**
 * Applique une liste d'effets à un objet de modificateurs.
 * @param {Record<string, number>} mods
 * @param {{key:string, op:'add'|'mul', value:number}[]} effects
 * @param {number} scale 0..1 (efficacité, ex. ressources de calcul insuffisantes)
 */
export function applyEffects(mods, effects, scale = 1) {
  for (const e of effects) {
    if (!(e.key in mods)) mods[e.key] = DEFAULT_MODIFIERS[e.key] ?? (e.op === 'mul' ? 1 : 0);
    if (e.op === 'mul') mods[e.key] *= 1 + e.value * scale;
    else mods[e.key] += e.value * scale;
  }
}

/** Offre de calcul (data centers alimentés et pourvus en personnel) et demande des technologies actives. */
export function computeBalance(state, catalog) {
  let supply = SIM.BASE_COMPUTE;
  for (const b of state.buildings.values()) {
    const def = catalog.buildingFor(b);
    if (!def.capacity.compute || b.abandoned) continue;
    const staffing = def.capacity.jobs ? Math.min(1, 0.3 + b.jobsFilled / def.capacity.jobs) : 1;
    supply += def.capacity.compute * (b.powered ? 1 : 0) * staffing;
  }
  let demand = 0;
  for (const id of Object.keys(state.tech.researched)) {
    if (isInOutage(state, id)) continue;
    demand += catalog.techById.get(id)?.compute ?? 0;
  }
  return { supply, demand, ratio: demand > 0 ? Math.min(1, supply / demand) : 1 };
}

export function isInOutage(state, techId) {
  const until = state.tech.outages[techId];
  return until !== undefined && until > state.time.tick;
}

/**
 * Recalcule les modificateurs effectifs à partir des technologies, politiques et événements actifs.
 * @returns {Record<string, number> & {disabledModes: Record<string, boolean>, compute: {supply:number, demand:number, ratio:number}}}
 */
export function computeModifiers(state, catalog) {
  const mods = { ...DEFAULT_MODIFIERS };
  const disabledModes = {};
  const compute = computeBalance(state, catalog);

  for (const id of Object.keys(state.tech.researched)) {
    const tech = catalog.techById.get(id);
    if (!tech) continue;
    if (isInOutage(state, id)) {
      // Pendant un incident : les gains disparaissent, les effets secondaires demeurent,
      // et l'incident peut ajouter ses propres effets.
      applyEffects(mods, tech.effects.filter((e) => e.side));
      for (const r of tech.risks) {
        if (r.type === 'outage') {
          if (r.effects) applyEffects(mods, r.effects);
          if (r.disablesMode) disabledModes[r.disablesMode] = true;
        }
      }
      continue;
    }
    applyEffects(mods, tech.effects.filter((e) => !e.side), compute.ratio);
    applyEffects(mods, tech.effects.filter((e) => e.side));
  }

  for (const id of Object.keys(state.policies.active)) {
    const pol = catalog.policyById.get(id);
    if (pol) applyEffects(mods, pol.effects);
  }

  // v1.1 : adjoints en poste (effets pondérés par la priorité de leur axe)
  applyEffects(mods, councilEffects(state));

  for (const ev of state.events.active) {
    if (ev.effects) applyEffects(mods, ev.effects);
  }

  // Météo du jour et crises en cours
  if (state.weather) applyEffects(mods, weatherEffects(state.weather));
  for (const c of state.crises?.active ?? []) {
    if (c.effects?.length) applyEffects(mods, c.effects);
  }

  // Effets à l'échelle de la ville de certains équipements (port, aéroport, stade, musée…)
  for (const b of state.buildings.values()) {
    const def = catalog.buildings.get(b.defId);
    if (!def?.cityEffects?.length || !isOperational(state, b)) continue;
    const staffing = def.capacity.jobs ? Math.min(1, 0.3 + b.jobsFilled / def.capacity.jobs) : 1;
    const powered = def.networks.power > 0 && !b.powered ? 0.3 : 1;
    applyEffects(mods, def.cityEffects, staffing * powered);
  }

  // Circuits courts (v0.7) : une ville qui se nourrit de ses propres fermes est plus satisfaite
  const foodSelf = state.resources?.stats?.foodSelf ?? 0;
  if (foodSelf >= 0.5) applyEffects(mods, [{ key: 'satisfaction.all', op: 'add', value: Math.min(1.5, (foodSelf - 0.5) * 3) }]);

  // Opinion (v0.7) : une ville où le maire est populaire attire ; une ville en défiance fait fuir.
  const pol = state.politics;
  if (pol?.enabled && (state.stats?.population ?? 0) > 0) {
    const a = pol.approval ?? 50;
    applyEffects(mods, [{ key: 'demand.R', op: 'add', value: Math.max(-4, Math.min(3, (a - 50) * 0.08)) }]);
  }

  // Saisonnalité du solaire (déterministe selon le mois)
  const month = Math.floor(state.time.tick / SIM.DAYS_PER_MONTH) % 12;
  mods.solarFactor *= [0.45, 0.55, 0.75, 0.9, 1.05, 1.15, 1.2, 1.1, 0.95, 0.75, 0.55, 0.45][month];

  mods.disabledModes = disabledModes;
  mods.compute = compute;
  return mods;
}
