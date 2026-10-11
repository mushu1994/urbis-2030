import { ERA_NAMES } from '../systems/ConstructionService.js';

/**
 * Ères de progression. Chaque ère débloque des bâtiments et des niveaux d'habitation plus futuristes.
 * Le passage à l'ère suivante est vérifié à chaque fin de mois ; une ère acquise n'est jamais perdue.
 */
export const ERAS = [
  {
    era: 1,
    name: ERA_NAMES[1],
    description: 'Une ville de 2030 : réseaux connectés et premiers services numériques.'
  },
  {
    era: 2,
    name: ERA_NAMES[2],
    description: 'Robots, navettes et services prédictifs : la ville commence à se piloter elle-même.',
    requires: [
      { key: 'population', label: '3 000 habitants', test: (s) => s.stats.population >= 3000, value: (s) => s.stats.population },
      { key: 'techs', label: '2 technologies déployées', test: (s) => Object.keys(s.tech.researched).length >= 2, value: (s) => Object.keys(s.tech.researched).length },
      { key: 'satisfaction', label: 'Satisfaction moyenne d\'au moins 55', test: (s) => s.stats.satisfaction >= 55, value: (s) => Math.round(s.stats.satisfaction) },
      { key: 'waste', label: '80 % des déchets collectés', test: (s) => (s.waste.stats?.collectionRate ?? 0) >= 0.8, value: (s) => `${Math.round((s.waste.stats?.collectionRate ?? 0) * 100)} %` }
    ]
  },
  {
    era: 3,
    name: ERA_NAMES[3],
    description: 'Une ville sobre et vivante, où technologie et nature se renforcent.',
    requires: [
      { key: 'population', label: '8 000 habitants', test: (s) => s.stats.population >= 8000, value: (s) => s.stats.population },
      { key: 'techs', label: '5 technologies déployées', test: (s) => Object.keys(s.tech.researched).length >= 5, value: (s) => Object.keys(s.tech.researched).length },
      { key: 'satisfaction', label: 'Satisfaction moyenne d\'au moins 62', test: (s) => s.stats.satisfaction >= 62, value: (s) => Math.round(s.stats.satisfaction) },
      { key: 'waste', label: '90 % des déchets collectés', test: (s) => (s.waste.stats?.collectionRate ?? 0) >= 0.9, value: (s) => `${Math.round((s.waste.stats?.collectionRate ?? 0) * 100)} %` },
      { key: 'transit', label: '30 % des habitants desservis par les transports en commun', test: (s) => (s.transit.stats?.coveredShare ?? 0) >= 0.3, value: (s) => `${Math.round((s.transit.stats?.coveredShare ?? 0) * 100)} %` }
    ]
  }
];

export class ProgressionSystem {
  constructor({ bus } = {}) {
    this.bus = bus;
  }

  /** État de la progression : ère actuelle, ère suivante et conditions détaillées. */
  evaluate(state) {
    const era = state.progression?.era ?? 1;
    const current = ERAS[era - 1];
    const next = ERAS[era] ?? null;
    const checks = next ? next.requires.map((r) => ({ key: r.key, label: r.label, ok: !!r.test(state), value: r.value(state) })) : [];
    return { era, current, next, checks, ready: !!next && checks.every((c) => c.ok) };
  }

  /** Vérification mensuelle : passage à l'ère suivante si toutes les conditions sont remplies. */
  monthly(state) {
    const ev = this.evaluate(state);
    if (!ev.ready) return false;
    state.progression.era = ev.next.era;
    state.progression.eraSince = state.time.tick;
    state.dirty.modifiers = true;
    const entry = { tick: state.time.tick, level: 'success', message: `Nouvelle ère : ${ev.next.name}. De nouveaux bâtiments et niveaux d'habitation sont disponibles.` };
    state.events.history.push(entry);
    this.bus?.emit('notify', entry);
    this.bus?.emit('era:changed', { era: ev.next.era });
    return true;
  }
}
