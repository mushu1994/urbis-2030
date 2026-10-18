import { buildStarterTown, placeNear } from './scenarios.js';
import { SIM } from '../simulation/config.js';
import { EconomySystem } from '../simulation/EconomySystem.js';
import { toCents } from '../util/money.js';
import { METRICS } from '../simulation/ScenarioSystem.js';

/**
 * Scénarios « villes à redresser » et défis (dans l'esprit de SimCity 2000).
 *
 * Chaque scénario construit sa ville de départ avec les commandes du jeu (mêmes règles, mêmes coûts que le
 * joueur), installe le problème à résoudre, puis fixe des objectifs chiffrés à partir de la situation réelle
 * obtenue (les cibles s'adaptent donc au terrain généré) et une échéance.
 */

const euro = (v) => toCents(v);
const round = (v, step) => Math.round(v / step) * step;

/** Bourg standard : réseau, services de base, une année de vie. */
function standardTown(session, { size = 'large', months = 12 } = {}) {
  const town = buildStarterTown(session, { size });
  session.run(120);
  for (const id of ['police', 'fire', 'school', 'clinic']) placeNear(session, id, town.xEnd - 6, town.row - 2);
  session.run(Math.max(0, months * SIM.DAYS_PER_MONTH - 120));
  return town;
}

const metric = (state, key) => METRICS[key].read(state, {});

export const CHALLENGES = [
  {
    id: 'valmont',
    name: 'Valmont-sur-Dette',
    difficulty: 2,
    years: 5,
    seed: 4242,
    size: 64,
    disasters: 'rare',
    pitch: 'L\'ancienne équipe a bâti à crédit et baissé les impôts avant les élections. Les caisses sont vides et la dette atteint un record.',
    goalsText: ['Diviser la dette par deux', 'Revenir à l\'équilibre chaque mois', 'Reconstituer 150 000 € de trésorerie', 'Satisfaction d\'au moins 55', 'Garder ses habitants'],
    failText: 'Trésorerie sous −250 000 € pendant 6 mois : mise sous tutelle préfectorale.',
    setup(session) {
      const s = session.state;
      standardTown(session, { months: 12 });
      const econ = session.sim.economy;
      // Équipements de prestige (coûteux à entretenir) et emprunts courts de l'ancienne mandature
      const town = { x: Math.floor(s.grid.width / 2), y: s.grid.yOf(s.entries[0]) };
      session.execute({ type: 'debug', op: 'treasury', euros: 120000 });
      placeNear(session, 'museum', town.x, town.y - 4);
      placeNear(session, 'high_school', town.x + 3, town.y + 4);
      for (let k = 0; k < 3; k++) {
        const cap = econ.debtCapacity(s);
        if (cap > euro(20000)) session.execute({ type: 'loan', amountEuros: Math.floor((cap * 0.42) / 100), months: 36 });
      }
      const spend = s.economy.treasury - euro(15000);
      if (spend > 0) econ.payOpex(s, { amount: spend, category: 'services', label: 'Héritage : grands projets de l\'ancienne mandature' });
      for (const k of ['R', 'C', 'O', 'I']) session.execute({ type: 'tax', key: k, value: 7 });
      session.run(60);
      const debt = metric(s, 'debt');
      const pop = s.stats.population;
      return {
        goals: [
          { id: 'debt', metric: 'debt', op: '<=', target: round(debt / 2, 100000), label: 'Diviser la dette par deux' },
          { id: 'cash', metric: 'cashFlow', op: '>=', target: 0, label: 'Trésorerie en hausse sur le mois (dette comprise)' },
          { id: 'reserve', metric: 'treasury', op: '>=', target: euro(150000), label: 'Trésorerie d\'au moins 150 000 €' },
          { id: 'sat', metric: 'satisfaction', op: '>=', target: 55, label: 'Satisfaction d\'au moins 55' },
          { id: 'pop', metric: 'population', op: '>=', target: round(pop * 0.95, 10), label: `Au moins ${round(pop * 0.95, 10).toLocaleString('fr-FR')} habitants` }
        ],
        failRules: [{ id: 'tutelle', metric: 'treasury', op: '<', target: euro(-250000), months: 6, label: 'Mise sous tutelle : trésorerie sous −250 000 € pendant 6 mois' }]
      };
    }
  },
  {
    id: 'ferrange',
    name: 'Ferrange, ciel gris',
    difficulty: 2,
    years: 6,
    seed: 777,
    size: 64,
    disasters: 'rare',
    pitch: 'Cité industrielle des années 2000 : deux centrales à gaz, des usines au cœur des quartiers. L\'air est irrespirable et les familles s\'en vont.',
    goalsText: ['Diviser la pollution moyenne par deux', 'Faire croître la population de 25 %', 'Satisfaction d\'au moins 58'],
    failText: 'Aucune règle d\'échec : seule l\'échéance compte.',
    setup(session) {
      const s = session.state;
      const town = standardTown(session, { months: 6 });
      // Industrie et production électrique fossile au plus près des habitations
      const g = s.grid;
      const row = town.row;
      session.execute({ type: 'zone', zoneId: 'I', rect: { x0: town.xEnd - 10, y0: row - 4, x1: town.xEnd - 1, y1: row - 2 } });
      session.execute({ type: 'zone', zoneId: 'I', rect: { x0: town.xEnd - 10, y0: row + 2, x1: town.xEnd - 1, y1: row + 4 } });
      placeNear(session, 'power_gas', Math.floor((3 + town.xEnd) / 2), row - 6);
      placeNear(session, 'power_gas', Math.floor((3 + town.xEnd) / 2) + 4, row + 6);
      void g;
      session.run(12 * SIM.DAYS_PER_MONTH);
      const pol = s.stats.avgPollution ?? 0;
      const pop = s.stats.population;
      return {
        goals: [
          { id: 'pollution', metric: 'pollution', op: '<=', target: Math.round(pol * 50) / 100, label: `Pollution moyenne ≤ ${(Math.round(pol * 50) / 100).toFixed(1).replace('.', ',')}` },
          { id: 'pop', metric: 'population', op: '>=', target: round(pop * 1.25, 10), label: `Au moins ${round(pop * 1.25, 10).toLocaleString('fr-FR')} habitants` },
          { id: 'sat', metric: 'satisfaction', op: '>=', target: 58, label: 'Satisfaction d\'au moins 58' }
        ],
        failRules: []
      };
    }
  },
  {
    id: 'riverbourg',
    name: 'Riverbourg sous les eaux',
    difficulty: 3,
    years: 4,
    seed: 2030,
    size: 64,
    disasters: 'rare',
    risks: { flood: 9 },
    pitch: 'Les quartiers se sont étendus jusqu\'aux berges. Le climat change, les crues se multiplient : protégez la ville sans l\'empêcher de grandir.',
    goalsText: ['Adopter le plan de prévention des inondations', 'Faire croître la population de 40 %', 'Satisfaction d\'au moins 55'],
    failText: 'La moitié des habitants partis pendant 3 mois : la ville est déclarée sinistrée.',
    setup(session) {
      const s = session.state;
      standardTown(session, { months: 8 });
      // Lotissements sur les berges basses, au plus près de la rivière
      const g = s.grid;
      for (let y = 4; y < g.height - 4; y += 6) {
        for (let x = 4; x < g.width - 4; x++) {
          const i = g.idx(x, y);
          if (g.terrain[i] === 1) {
            session.execute({ type: 'zone', zoneId: 'R_LOW', rect: { x0: x - 4, y0: y - 1, x1: x - 1, y1: y + 1 } });
            break;
          }
        }
      }
      session.run(4 * SIM.DAYS_PER_MONTH);
      const pop = s.stats.population;
      return {
        goals: [
          { id: 'plan', metric: 'policy', policy: 'flood_plan', op: '>=', target: 1, label: 'Adopter le plan de prévention des inondations (I → Politiques)' },
          { id: 'pop', metric: 'population', op: '>=', target: round(pop * 1.4, 10), label: `Au moins ${round(pop * 1.4, 10).toLocaleString('fr-FR')} habitants` },
          { id: 'sat', metric: 'satisfaction', op: '>=', target: 55, label: 'Satisfaction d\'au moins 55' }
        ],
        failRules: [{ id: 'exode', metric: 'population', op: '<', target: round(pop / 2, 10), months: 3, label: 'Ville sinistrée : la moitié des habitants est partie' }]
      };
    }
  },
  {
    id: 'novalys',
    name: 'Nova-Lys embouteillée',
    difficulty: 2,
    years: 5,
    seed: 1234,
    size: 64,
    disasters: 'rare',
    pitch: 'Tout se fait en voiture : les rues sont saturées matin et soir, les commerces se plaignent. Il est temps de proposer autre chose.',
    goalsText: ['Réduire de 20 % le temps de trajet moyen', 'Faire monter les habitants dans les bus et le métro', 'Faire croître la population de 25 %'],
    failText: 'Aucune règle d\'échec : seule l\'échéance compte.',
    setup(session) {
      const s = session.state;
      const town = standardTown(session, { size: 'large', months: 6 });
      // Densification sans transports : logements collectifs à l'est, bureaux à l'entrée de ville (ouest)
      const row = town.row;
      const g = s.grid;
      session.execute({ type: 'zone', zoneId: 'R_HIGH', rect: { x0: town.xEnd - 14, y0: row - 8, x1: town.xEnd - 1, y1: row - 2 } });
      session.execute({ type: 'zone', zoneId: 'R_HIGH', rect: { x0: town.xEnd - 14, y0: row + 2, x1: town.xEnd - 1, y1: row + 8 } });
      session.execute({ type: 'zone', zoneId: 'O', rect: { x0: 5, y0: row - 6, x1: 12, y1: row - 2 } });
      session.execute({ type: 'zone', zoneId: 'C', rect: { x0: 5, y0: row + 2, x1: 12, y1: row + 4 } });
      void g;
      session.run(14 * SIM.DAYS_PER_MONTH);
      const commute = metric(s, 'commute');
      const pop = s.stats.population;
      const commuteTarget = Math.round(commute * 0.8 * 10) / 10;
      const paxTarget = round(Math.max(500, pop * 0.2), 50);
      return {
        goals: [
          { id: 'commute', metric: 'commute', op: '<=', target: commuteTarget, label: `Temps de trajet moyen ≤ ${commuteTarget.toFixed(1).replace('.', ',')} min` },
          { id: 'pax', metric: 'transit', op: '>=', target: paxTarget, label: `${paxTarget.toLocaleString('fr-FR')} voyageurs par jour en transports en commun` },
          { id: 'pop', metric: 'population', op: '>=', target: round(pop * 1.25, 10), label: `Au moins ${round(pop * 1.25, 10).toLocaleString('fr-FR')} habitants` }
        ],
        failRules: []
      };
    }
  },
  {
    id: 'saintaubin',
    name: 'Saint-Aubin, ville fantôme',
    difficulty: 3,
    years: 6,
    seed: 909,
    size: 64,
    disasters: 'rare',
    pitch: 'Le premier employeur a fermé, les impôts ont flambé pour compenser. Les commerces baissent le rideau et les maisons se vident.',
    goalsText: ['Redonner envie de rester : satisfaction d\'au moins 55', 'Plus que 2 bâtiments abandonnés au maximum', 'Faire croître la population de 30 %'],
    failText: 'Moins de 40 % des habitants restants pendant 3 mois : la ville est rattachée à sa voisine.',
    setup(session) {
      const s = session.state;
      standardTown(session, { months: 10 });
      // Fermeture des industries et hausse brutale des impôts
      const g = s.grid;
      const industries = [...s.buildings.values()].filter((b) => session.catalog.building(b.defId).category === 'industry');
      for (const b of industries) session.execute({ type: 'demolish', rect: { x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 } });
      void g;
      for (const k of ['R', 'C', 'O', 'I']) session.execute({ type: 'tax', key: k, value: 15 });
      session.run(10 * SIM.DAYS_PER_MONTH);
      const pop = s.stats.population;
      return {
        goals: [
          { id: 'sat', metric: 'satisfaction', op: '>=', target: 55, label: 'Satisfaction d\'au moins 55' },
          { id: 'abandoned', metric: 'abandoned', op: '<=', target: 2, label: 'Au plus 2 bâtiments abandonnés' },
          { id: 'pop', metric: 'population', op: '>=', target: round(pop * 1.3, 10), label: `Au moins ${round(pop * 1.3, 10).toLocaleString('fr-FR')} habitants` }
        ],
        failRules: [{ id: 'exode', metric: 'population', op: '<', target: round(pop * 0.4, 10), months: 3, label: 'Rattachement à la commune voisine : 60 % des habitants sont partis' }]
      };
    }
  },
  {
    id: 'symbiose',
    name: 'Défi 2045 : ville symbiotique',
    difficulty: 4,
    years: 15,
    seed: null,
    size: 96,
    disasters: 'normal',
    pitch: 'Un terrain vierge, quinze ans de mandat. Bâtissez une métropole qui atteint l\'ère « Ville symbiotique » sans perdre la confiance de ses habitants.',
    goalsText: ['Atteindre l\'ère 3 « Ville symbiotique »', '30 000 habitants', 'Résultat mensuel positif'],
    failText: 'Trésorerie sous −500 000 € pendant 6 mois.',
    empty: true,
    setup() {
      return {
        goals: [
          { id: 'era', metric: 'era', op: '>=', target: 3, label: 'Atteindre l\'ère 3 « Ville symbiotique »' },
          { id: 'pop', metric: 'population', op: '>=', target: 30000, label: 'Au moins 30 000 habitants' },
          { id: 'net', metric: 'netResult12', op: '>=', target: 0, label: 'Résultat mensuel moyen positif sur 12 mois' }
        ],
        failRules: [{ id: 'faillite', metric: 'treasury', op: '<', target: euro(-500000), months: 6, label: 'Faillite : trésorerie sous −500 000 € pendant 6 mois' }]
      };
    }
  }
];

export const CHALLENGE_BY_ID = new Map(CHALLENGES.map((c) => [c.id, c]));

/**
 * Construit la ville du scénario puis démarre le chronomètre.
 * @param {import('./GameSession.js').GameSession} session
 * @param {string} id
 */
export function setupChallenge(session, id) {
  const def = CHALLENGE_BY_ID.get(id);
  if (!def) throw new Error(`Scénario inconnu : ${id}`);
  const s = session.state;
  // La préparation se déroule sans catastrophe ; la fréquence du scénario s'applique ensuite.
  s.options.disasters = 'off';
  // Ville héritée de l'équipe précédente : le statut actuel ne limite pas ce qu'elle a construit
  s.meta.preparing = true;
  let setup;
  try {
    setup = def.setup(session);
  } finally {
    delete s.meta.preparing;
  }
  const { goals, failRules } = setup;
  // L'historique de préparation n'a pas à apparaître comme une action annulable du joueur.
  session.history.clear();
  s.options.disasters = def.disasters ?? 'normal';
  const start = s.time.tick;
  s.scenario = {
    id: def.id,
    name: def.name,
    status: 'active',
    startTick: start,
    deadlineTick: start + def.years * SIM.MONTHS_PER_YEAR * SIM.DAYS_PER_MONTH,
    years: def.years,
    goals,
    failRules,
    failStreak: {},
    risks: def.risks ?? null,
    pitch: def.pitch,
    initial: { population: s.stats.population, treasury: s.economy.treasury, satisfaction: Math.round(s.stats.satisfaction), net: EconomySystem.summarize(s.economy.periods.at(-1))?.netResult ?? 0 }
  };
  // Carte du scénario dépliée sur grand écran, repliée sur téléphone (choix mémorisé ensuite)
  s.meta.objectives = { hidden: false };
  return s.scenario;
}
