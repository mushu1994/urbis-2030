import { dateOfTick } from '../simulation/config.js';
import { isInOutage } from '../simulation/Modifiers.js';
import { MIN_EVENT_GAP_DAYS, lastRandomEvent } from '../simulation/CrisisSystem.js';

const MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000];

/**
 * Événements de la ville : incidents des systèmes d'IA, aléas climatiques et économiques, paliers de population.
 * Tous les tirages utilisent le générateur aléatoire de la partie (déterministe et sauvegardé).
 */
export class EventSystem {
  /** @param {{catalog: import('../data/Catalog.js').Catalog, bus?: any}} deps */
  constructor({ catalog, bus }) {
    this.catalog = catalog;
    this.bus = bus;
  }

  #notify(state, level, message, extra = {}) {
    const entry = { tick: state.time.tick, level, message, ...extra };
    state.events.history.push(entry);
    if (state.events.history.length > 80) state.events.history.shift();
    this.bus?.emit('notify', entry);
  }

  /** Fin des événements temporaires et des incidents (appel quotidien). */
  daily(state) {
    const t = state.time.tick;
    const before = state.events.active.length;
    const ended = state.events.active.filter((e) => e.until <= t);
    state.events.active = state.events.active.filter((e) => e.until > t);
    for (const e of ended) state.events.history.push({ tick: t, level: 'info', message: `Fin : ${e.label}` });
    for (const [id, until] of Object.entries(state.tech.outages)) {
      if (until <= t) {
        delete state.tech.outages[id];
        state.dirty.modifiers = true;
        this.#notify(state, 'info', `Rétablissement : ${this.catalog.techById.get(id)?.name ?? id}`);
      }
    }
    if (state.events.active.length !== before) state.dirty.modifiers = true;

    // Paliers de population
    const reached = state.events.milestone ?? 0;
    for (const m of MILESTONES) {
      if (m > reached && state.stats.population >= m) {
        state.events.milestone = m;
        const unlocked = this.#unlockedAt(reached, m);
        // Les bâtiments et fonctions des paliers sont annoncés par le statut de la ville (Milestones.js)
        this.#notify(state, 'success', `${m.toLocaleString('fr-FR')} habitants !${unlocked ? ` Débloqué : ${unlocked}` : ''}`);
      }
    }
  }

  #unlockedAt(from, to) {
    const names = [];
    for (const d of this.catalog.buildings.values()) {
      const p = d.unlock?.population;
      if (p && p > from && p <= to) names.push(d.name);
    }
    for (const r of this.catalog.roads) if (r.unlock?.population > from && r.unlock.population <= to) names.push(r.name);
    for (const t of this.catalog.technologies) if (t.unlock.population > from && t.unlock.population <= to) names.push(`techno « ${t.name} »`);
    return names.join(', ');
  }

  /** Tirages mensuels : risques technologiques et aléas. */
  monthly(state) {
    const rng = state.rng;
    const t = state.time.tick;
    const { month } = dateOfTick(t);
    // Au plus un événement aléatoire tous les 3 mois (incidents, épisodes et crises confondus).
    // Les tirages ont toujours lieu : la suite aléatoire de la partie ne dépend pas de ce délai.
    let quiet = t - lastRandomEvent(state) < MIN_EVENT_GAP_DAYS;

    for (const id of Object.keys(state.tech.researched).sort()) {
      if (isInOutage(state, id)) continue;
      const tech = this.catalog.techById.get(id);
      for (const r of tech?.risks ?? []) {
        if (r.type === 'outage' && rng.chance(r.monthlyChance) && !quiet) {
          quiet = true;
          state.events.lastRandom = t;
          state.tech.outages[id] = t + r.durationDays;
          state.dirty.modifiers = true;
          this.#notify(state, 'danger', `Incident — ${tech.name} : ${r.label} (${r.durationDays} j)`, { kind: 'outage', techId: id });
        }
      }
    }

    // Risques propres à certains équipements (arrêt d'urgence d'une centrale…)
    for (const b of [...state.buildings.values()].sort((a, z) => a.id - z.id)) {
      const def = (this.catalog.buildings.has(b.defId) ? this.catalog.buildingFor(b) : undefined);
      const risk = def?.risk;
      if (!risk || b.abandoned || b.disabledUntil > t) continue;
      if (rng.chance(risk.monthlyChance) && !quiet) {
        quiet = true;
        state.events.lastRandom = t;
        b.disabledUntil = t + risk.durationDays;
        state.dirty.utilities = true;
        if (risk.effects) state.events.active.push({ id: `risk-${b.id}`, label: risk.label, until: t + risk.durationDays, effects: risk.effects });
        state.dirty.modifiers = true;
        this.#notify(state, 'danger', `${def.name} : ${risk.label} (${risk.durationDays} j)`, { kind: 'risk', x: b.x, y: b.y });
      }
    }

    const has = (id) => state.events.active.some((e) => e.id === id);
    const add = (e) => {
      if (quiet) return;
      quiet = true;
      state.events.lastRandom = t;
      state.events.active.push(e);
      state.dirty.modifiers = true;
      this.#notify(state, e.level ?? 'warning', `${e.label}`, { kind: 'event', eventId: e.id });
    };

    if (month >= 5 && month <= 7 && !has('heatwave') && rng.chance(0.22 + Math.min(0.3, (state.stats.avgHeat ?? 0) / 80))) {
      add({
        id: 'heatwave',
        label: 'Canicule : la demande électrique grimpe et les quartiers sans végétation souffrent',
        until: t + 12,
        effects: [
          { key: 'powerDemandMult', op: 'mul', value: 0.18 },
          { key: 'satisfaction.all', op: 'add', value: -3 }
        ]
      });
    }
    if (!has('calm') && rng.chance(0.08)) {
      add({ id: 'calm', label: 'Anticyclone : production éolienne en berne', until: t + 10, effects: [{ key: 'windFactor', op: 'mul', value: -0.65 }], level: 'info' });
    }
    if (!has('storm') && month >= 9 && rng.chance(0.07)) {
      add({ id: 'storm', label: 'Tempête : éoliennes à l\'arrêt, trafic perturbé', until: t + 3, effects: [{ key: 'windFactor', op: 'mul', value: -1 }, { key: 'roadCapacityMult', op: 'mul', value: -0.15 }] });
    }
    if (!has('tech_fair') && state.stats.population > 1500 && rng.chance(0.05)) {
      add({ id: 'tech_fair', label: 'Salon de l\'IA appliquée : les entreprises veulent s\'implanter', until: t + 60, effects: [{ key: 'demand.O', op: 'add', value: 15 }], level: 'success' });
    }
    if (!has('pollution_peak') && state.stats.population > 400 && (state.stats.avgPollution ?? 0) > 12 && rng.chance(0.15)) {
      add({ id: 'pollution_peak', label: 'Pic de pollution : la préfecture alerte la population', until: t + 8, effects: [{ key: 'satisfaction.all', op: 'add', value: -4 }] });
    }

    // Alertes de gestion
    const eco = state.economy;
    if (eco.treasury < 0) this.#notify(state, 'danger', `Trésorerie négative depuis ${eco.monthsNegative} mois : les investissements sont bloqués`);
    const p = state.utilities.power;
    const buyHint = (res) => (state.trade?.[res]?.buy ? '' : ' (dépannage possible : Finances → Échanges régionaux)');
    if (p.demand > 0 && p.unserved > 0.02 * p.demand) this.#notify(state, 'warning', `Déficit électrique : ${Math.round(p.unserved)} unités non servies${buyHint('power')}`);
    const w = state.utilities.water;
    if (w.demand > 0 && w.unserved > 0.05 * w.demand) this.#notify(state, 'warning', `Pénurie d'eau : construisez des stations de pompage${buyHint('water')}`);
    if ((w.untreatedShare ?? 0) > 0.4 && state.stats.population > 400) this.#notify(state, 'warning', 'Eaux usées non traitées : construisez une station d\'épuration');
    const ws = state.waste?.stats;
    if (ws && state.stats.population > 150 && ws.collectionRate < 0.7) {
      const why = { coverage: 'construisez un centre de collecte ou une décharge près des quartiers', collection: 'la flotte de bennes est saturée', processing: 'les installations de traitement sont saturées' }[ws.limitedBy] ?? 'développez la collecte';
      this.#notify(state, 'warning', `Déchets non collectés (${Math.round((1 - ws.collectionRate) * 100)} %) : ${why}`);
    }
  }
}

