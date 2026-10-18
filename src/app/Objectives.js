import { ZONE } from '../world/Grid.js';

const count = (state, pred) => {
  let n = 0;
  for (const b of state.buildings.values()) if (pred(b)) n++;
  return n;
};

const zoneCount = (g, code) => {
  let n = 0;
  for (let i = 0; i < g.size; i++) if (g.zone[i] === code) n++;
  return n;
};

/**
 * Tutoriel : une suite d'objectifs vérifiés automatiquement à partir de l'état réel de la partie.
 * Chaque objectif explique quoi faire et pourquoi ; il est coché dès que la condition est remplie.
 * @type {{id:string, title:string, hint:string, done:(state:any, ctx:{catalog:any, network:any})=>boolean}[]}
 */
export const OBJECTIVES = [
  {
    id: 'road',
    title: 'Relier la ville à l\'autoroute',
    hint: 'Outil Routes → Rue, puis glissez depuis l\'accès autoroutier (bord ouest). Sans liaison, personne ne s\'installe.',
    done: (s, { network }) => [...network.outsideComponents].some((c) => network.componentSize[c] > 3)
  },
  {
    id: 'power',
    title: 'Produire de l\'électricité',
    hint: 'Énergie → une centrale le long d\'une route. Routes et bâtiments contigus transportent le courant.',
    done: (s, { catalog }) => count(s, (b) => !!catalog.building(b.defId).capacity.powerOutput) > 0
  },
  {
    id: 'residential',
    title: 'Tracer une zone résidentielle',
    hint: 'Zonage → Résidentiel, à 3 cases au plus d\'une route alimentée. Les maisons apparaissent selon la demande (jauge R).',
    done: (s) => zoneCount(s.grid, ZONE.R_LOW) + zoneCount(s.grid, ZONE.R_HIGH) >= 6
  },
  {
    id: 'jobs',
    title: 'Créer des emplois',
    hint: 'Tracez au moins 3 cases de commerce et 3 cases d\'industrie : les habitants doivent travailler.',
    done: (s) => zoneCount(s.grid, ZONE.C) >= 3 && zoneCount(s.grid, ZONE.I) >= 3
  },
  {
    id: 'water',
    title: 'Apporter l\'eau courante',
    hint: 'Eau → station de pompage au bord de l\'eau, ou château d\'eau. Sans eau, les bâtiments ne montent pas en gamme.',
    done: (s, { catalog }) => count(s, (b) => !!catalog.building(b.defId).capacity.waterOutput) > 0
  },
  {
    id: 'waste',
    title: 'Organiser la collecte des déchets',
    hint: 'Déchets → un centre de collecte près des quartiers et une décharge (ou un incinérateur) pour les traiter.',
    done: (s) => (s.waste.stats?.collected ?? 0) > 0
  },
  {
    id: 'pop300',
    title: 'Devenir un Village (500 habitants)',
    hint: 'Accélérez le temps (touches 2 et 3) et surveillez la demande en haut de l\'écran. Le statut Village débloque l\'école et le poste de police, et l\'État verse une dotation.',
    done: (s) => (s.stats.peakPopulation ?? 0) >= 500
  },
  {
    id: 'services',
    title: 'Ouvrir une école et un poste de police',
    hint: 'Éducation et culture → École, puis Police et pompiers → Poste de police (le commissariat arrive au statut Bourg). La satisfaction et la valeur foncière augmentent.',
    done: (s, { catalog }) =>
      count(s, (b) => catalog.building(b.defId).capacity.service?.type === 'education') > 0 &&
      count(s, (b) => catalog.building(b.defId).capacity.service?.type === 'police') > 0
  },
  {
    id: 'bus',
    title: 'Mettre en service une ligne de bus',
    hint: 'Transports → un dépôt de bus, puis des arrêts dans les quartiers, reliés par la route au dépôt.',
    done: (s) => (s.transit.stats?.activeStops ?? 0) > 0
  },
  {
    id: 'pop1000',
    title: 'Atteindre 1 000 habitants',
    hint: 'Équilibrez logements et emplois ; ouvrez les Finances (B) pour garder une trésorerie positive.',
    done: (s) => (s.stats.peakPopulation ?? 0) >= 1000
  },
  {
    id: 'bridge',
    title: 'Franchir l\'eau avec un pont',
    hint: 'Tracez une rue en ligne droite d\'une rive à l\'autre : la partie sur l\'eau devient un pont.',
    done: (s) => s.grid.bridge.some((v) => v > 0)
  },
  {
    id: 'tech',
    title: 'Déployer une technologie de 2030',
    hint: 'IA et politiques (touche I) : chaque technologie a un coût, un besoin en calcul et des effets secondaires.',
    done: (s) => Object.keys(s.tech.researched).length > 0
  },
  {
    id: 'era2',
    title: 'Devenir un Bourg (2 000 habitants)',
    hint: 'Tableau de bord (C) → Progression : chaque statut débloque des équipements et rapporte une dotation de l\'État. L\'ère « Ville autonome » viendra à 10 000 habitants.',
    done: (s) => (s.stats?.peakPopulation ?? 0) >= 2000
  }
];

/** Avancement du tutoriel. */
export function objectivesProgress(state, ctx) {
  const items = OBJECTIVES.map((o) => ({ id: o.id, title: o.title, hint: o.hint, done: !!o.done(state, ctx) }));
  const current = items.find((o) => !o.done) ?? null;
  return { items, current, done: items.filter((o) => o.done).length, total: items.length };
}
