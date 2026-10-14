import { h } from './dom.js';
import { formatNumber } from '../util/money.js';
import { demandBreakdown, jobsDiagnosis } from '../simulation/PopulationSystem.js';

/** Secteurs affichés : clé de demande, libellé, couleur, codes de zone concernés. */
export const SECTORS = [
  { k: 'R', label: 'Logement', short: 'R', color: 'var(--zone-r)', zones: [1, 2] },
  { k: 'C', label: 'Commerce', short: 'C', color: 'var(--zone-c)', zones: [3, 9] },
  { k: 'O', label: 'Bureaux', short: 'B', color: 'var(--zone-o)', zones: [4] },
  { k: 'I', label: 'Industrie', short: 'I', color: 'var(--zone-i)', zones: [5, 6, 7, 8] }
];

const LEVELS = [
  [60, 'très forte'],
  [30, 'forte'],
  [10, 'modérée'],
  [-10, 'faible'],
  [-40, 'nulle'],
  [-101, 'en recul']
];

const levelOf = (v) => LEVELS.find(([min]) => v >= min)[1];
const pct = (x) => `${(x * 100).toFixed(0)} %`;
const pts = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`;

/**
 * « Besoins de la ville » : détail de la demande en logements, commerces, bureaux et industries.
 * Ouvert d'un clic sur les jauges de la barre du haut.
 */
export class DemandPanel {
  constructor({ onZoneTool, execute, notify } = {}) {
    this.id = 'demand';
    this.title = 'Besoins de la ville';
    this.tabs = [{ id: 'all', label: 'Vue d\'ensemble' }, ...SECTORS.map((s) => ({ id: s.k, label: s.label })), { id: 'jobs', label: 'Emploi' }];
    this.onZoneTool = onZoneTool;
    this.execute = execute;
    this.notify = notify;
  }

  render(session, tab = 'all', rerender) {
    const state = session.state;
    if (tab === 'jobs') return h('div.demand-panel', this.#jobs(session, rerender, false));
    const bd = demandBreakdown(state);
    const parcels = emptyParcels(state);
    if (tab === 'all') {
      return h('div.demand-panel',
        !bd.connected ? h('p.demand-warn', '⚠ La ville n\'est pas reliée au réseau régional : aucune demande tant qu\'une route ne rejoint pas l\'accès autoroutier.') : null,
        h('div.demand-cards', SECTORS.map((s) => this.#card(state, s, bd, parcels, true))),
        this.#jobs(session, rerender, true),
        h('p.hint', 'Les jauges vont de −100 (le secteur se vide) à +100 (forte demande). Une demande positive fait pousser des bâtiments sur les parcelles zonées, reliées à la route et à l\'électricité. Cliquez un onglet pour le détail des causes.')
      );
    }
    const s = SECTORS.find((x) => x.k === tab) ?? SECTORS[0];
    return h('div.demand-panel', this.#card(state, s, bd, parcels, false));
  }

  #card(state, s, bd, parcels, compact) {
    const v = state.demand[s.k];
    const target = bd.target[s.k];
    const trend = target - v > 3 ? '↗ en hausse' : target - v < -3 ? '↘ en baisse' : '→ stable';
    const factors = [...bd.factors[s.k]].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const free = s.zones.reduce((n, z) => n + (parcels[z] ?? 0), 0);
    const advice = adviceFor(s.k, state, v, free, bd.connected);
    const bar = h('div.demand-bar', h('div.demand-bar-fill', {
      style: {
        background: s.color,
        left: v >= 0 ? '50%' : `${50 + v / 2}%`,
        width: `${Math.abs(v) / 2}%`
      }
    }));
    return h('section.demand-card', { class: v >= 10 ? 'up' : v <= -10 ? 'down' : '' },
      h('header',
        h('i.swatch', { style: { background: s.color } }),
        h('strong', s.label),
        h('span.demand-value', `${pts(v)} · ${levelOf(v)}`),
        h('small', trend)),
      bar,
      compact
        ? h('p.demand-main', factors[0] ? `Principal facteur : ${factors[0].label.toLowerCase()} (${pts(factors[0].value)})` : '—')
        : h('table.fin.demand-factors',
          h('thead', h('tr', h('th', 'Facteur'), h('th.num', 'Effet'), h('th', ''))),
          h('tbody', factors.map((f) => h('tr',
            h('td', f.label),
            h('td.num', { class: f.value < 0 ? 'neg' : 'pos' }, pts(f.value)),
            h('td.fbar', h('span', { class: f.value < 0 ? 'neg' : 'pos', style: { width: `${Math.min(100, Math.abs(f.value))}%` } }))
          )))),
      compact ? null : h('dl.demand-figures', figuresFor(s.k, state, free).flatMap(([a, b]) => [h('dt', a), h('dd', b)])),
      advice.length ? h('ul.demand-advice', advice.map((a) => h('li', a))) : null,
      compact ? h('small.demand-free', `${formatNumber(free)} parcelle${free > 1 ? 's' : ''} zonée${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''}`) : null
    );
  }

  /** Emplois non pourvus (v0.7) : niveaux de qualification, causes et remèdes, dont les politiques d'emploi. */
  #jobs(session, rerender, compact) {
    const state = session.state;
    const d = jobsDiagnosis(state);
    const s = state.stats;
    if (compact && !d.causes.length) return null;
    const adopt = (id) => {
      const r = this.execute?.({ type: 'policy', policyId: id, enabled: true });
      if (r && !r.ok) this.notify?.('warning', r.reason);
      else this.notify?.('success', `Politique adoptée : ${session.catalog.policyById.get(id)?.name}`);
      rerender?.();
    };
    const advice = d.advice.length
      ? h('ul.demand-advice', d.advice.map((a) => h('li', a.text, a.policy ? h('button.btn.small.primary', { type: 'button', on: { click: () => adopt(a.policy) } }, 'Adopter') : null)))
      : null;
    if (compact) {
      return h('section.jobs-alert', { class: 'down' },
        h('header', h('strong', '⚠ Emplois non pourvus'), h('span.demand-value', `${formatNumber(d.vacant)} postes · ${pct(d.share)}`)),
        h('p.demand-main', d.causes[0]),
        advice);
    }
    return h('section.demand-card.jobs',
      h('header', h('strong', 'Marché du travail'), h('span.demand-value', `${formatNumber(d.vacant)} postes vacants · ${pct(d.share)}`)),
      h('table.fin',
        h('thead', h('tr', h('th', 'Niveau'), h('th.num', 'Emplois'), h('th.num', 'Actifs'), h('th.num', 'Postes vacants'), h('th.num', 'Chômeurs'))),
        h('tbody', d.rows.map((r) => h('tr', h('td', r.label), h('td.num', formatNumber(r.jobs)), h('td.num', formatNumber(r.workers)), h('td.num', { class: r.vacant > 0 ? 'neg' : '' }, formatNumber(r.vacant)), h('td.num', formatNumber(r.unemployed)))))),
      h('dl.demand-figures',
        h('dt', 'Navetteurs entrants (emplois pourvus de l\'extérieur)'), h('dd', formatNumber(s.commutersIn ?? 0)),
        h('dt', 'Habitants travaillant à l\'extérieur'), h('dd', formatNumber(s.commutersOut ?? 0)),
        h('dt', 'Chômeurs requalifiés (formation)'), h('dd', formatNumber(s.upskilled ?? 0)),
        h('dt', 'Postes dans des quartiers isolés'), h('dd', formatNumber(d.isolated)),
        h('dt', 'Taux de chômage'), h('dd', pct(s.unemploymentRate ?? 0))),
      d.causes.length ? h('div', h('h4', 'Pourquoi ces postes restent vacants'), h('ul', d.causes.map((c) => h('li', c)))) : h('p.hint', 'Les postes vacants restent marginaux : rien d\'alarmant.'),
      advice,
      h('p.hint', 'Un poste n\'est pourvu que par un actif du même bassin routier et d\'une qualification suffisante (un actif très qualifié peut occuper un poste moins qualifié, pas l\'inverse). Une partie des postes restants est occupée par des navetteurs de la région.')
    );
  }
}

/** Parcelles zonées encore vides, par code de zone. */
function emptyParcels(state) {
  const g = state.grid;
  const out = {};
  for (let i = 0; i < g.size; i++) {
    const z = g.zone[i];
    if (z && !g.building[i]) out[z] = (out[z] ?? 0) + 1;
  }
  return out;
}

function figuresFor(k, state, free) {
  const s = state.stats;
  const ub = s.unemployedByBracket ?? { low: 0, mid: 0, high: 0 };
  const bz = s.buildingsByZone ?? {};
  switch (k) {
    case 'R':
      return [
        ['Habitants', formatNumber(s.population)],
        ['Capacité des logements', formatNumber(s.housingCapacity ?? 0)],
        ['Logements vacants', pct(Math.max(0, s.housingVacancy ?? 0))],
        ['Emplois non pourvus', formatNumber(Math.max(0, (s.jobs ?? 0) - (s.jobsFilled ?? 0)))],
        ['Chômage', pct(s.unemploymentRate ?? 0)],
        ['Satisfaction', `${Math.round(s.satisfaction ?? 50)} / 100`],
        ['Taxe d\'habitation', `${state.economy.taxes.R} %`],
        ['Parcelles résidentielles libres', formatNumber(free)],
        ['Bâtiments résidentiels', formatNumber((bz.R_LOW ?? 0) + (bz.R_HIGH ?? 0))]
      ];
    case 'C':
      return [
        ['Consommation des ménages', formatNumber(Math.round(s.consumption ?? 0))],
        ['Capacité de vente des commerces', formatNumber(Math.round(s.salesCapacity ?? 0))],
        ['Taux de remplissage des commerces', pct(Math.min(2, s.salesRatio ?? 0))],
        ['Marchandises reçues / nécessaires', `${formatNumber(Math.round(s.goodsProduced ?? 0))} / ${formatNumber(Math.round(s.goodsNeeded ?? 0))}`],
        ['Taxe commerciale', `${state.economy.taxes.C} %`],
        ['Parcelles commerciales libres', formatNumber(free)],
        ['Commerces', formatNumber(bz.C ?? 0)]
      ];
    case 'O':
      return [
        ['Actifs qualifiés sans emploi', formatNumber(Math.round((ub.mid ?? 0) + (ub.high ?? 0)))],
        ['Population (seuil 900)', formatNumber(s.population)],
        ['Calcul disponible', formatNumber(Math.round(state.modifiers?.compute?.supply ?? 0))],
        ['Taxe sur les bureaux', `${state.economy.taxes.O} %`],
        ['Parcelles de bureaux libres', formatNumber(free)],
        ['Immeubles de bureaux', formatNumber(bz.O ?? 0)]
      ];
    default:
      return [
        ['Actifs peu qualifiés sans emploi', formatNumber(Math.round(ub.low ?? 0))],
        ['Production industrielle', formatNumber(Math.round(s.goodsProduced ?? 0))],
        ['Production écoulée', pct(Math.min(1, s.goodsSoldRatio ?? 1))],
        ['Besoin des commerces', formatNumber(Math.round(s.goodsNeeded ?? 0))],
        ['Taxe industrielle', `${state.economy.taxes.I} %`],
        ['Parcelles industrielles libres', formatNumber(free)],
        ['Ateliers et usines', formatNumber(bz.I ?? 0)],
        ['Fermes', formatNumber(bz.IA ?? 0)],
        ['Sites de forage et d\'extraction', formatNumber(bz.IX ?? 0)],
        ['Scieries et industries du bois', formatNumber(bz.IF ?? 0)]
      ];
  }
}

/** Conseils concrets selon la situation du secteur. */
function adviceFor(k, state, v, free, connected) {
  const s = state.stats;
  const t = state.economy.taxes;
  const out = [];
  if (!connected) return ['Reliez la ville à l\'accès autoroutier par une route.'];
  const tax = { R: 'd\'habitation', C: 'commerciale', O: 'sur les bureaux', I: 'industrielle' }[k];
  if (v > 15 && free < 6) out.push('Demande non satisfaite : zonez de nouvelles parcelles (près d\'une route, avec électricité).');
  if (v > 15 && free >= 6) out.push('Des parcelles sont libres : vérifiez leur raccordement (route à 3 cases au plus, électricité, eau).');
  if (v < -15 && t[k] > 9) out.push(`Baisser la taxe ${tax} (${t[k]} %) relancerait le secteur.`);
  if (k === 'R') {
    if ((s.housingVacancy ?? 0) > 0.1) out.push('Beaucoup de logements vides : créez des emplois (commerce, bureaux, industrie).');
    if ((s.satisfaction ?? 50) < 45) out.push('Satisfaction basse : services publics, parcs, moins de pollution et de bruit.');
  }
  if (k === 'C' && (s.salesRatio ?? 0) < 0.9) out.push('Les commerces manquent de clients : la demande reviendra avec plus d\'habitants.');
  if (k === 'O' && s.population <= 900) out.push('Les entreprises de bureaux s\'installent au-delà de 900 habitants.');
  if (k === 'O' && v > 0) out.push('Écoles et lycées qualifient les actifs dont les bureaux ont besoin.');
  if (k === 'I' && (s.goodsSoldRatio ?? 1) < 0.95) out.push('Une partie de la production ne trouve pas preneur : développez le commerce, la logistique ou un port.');
  return out;
}
