import { h } from './dom.js';
import { meter } from './charts.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { trafficDiagnosis } from '../simulation/TrafficAdvisor.js';
import { isUnlocked } from '../systems/ConstructionService.js';
import { policyMonthlyCents } from '../simulation/EconomySystem.js';

const LEVEL = {
  fluide: ['Circulation fluide', 'pos'],
  chargée: ['Circulation chargée', 'warn'],
  saturée: ['Circulation saturée', 'neg']
};

/**
 * Conseiller « Circulation et pollution » (v0.9, touche P) : diagnostic chiffré de la ville, points noirs à localiser
 * et conseils classés par impact, chacun avec des actions directes (outil, couche, politique, technologie, panneau).
 */
export class TrafficPanel {
  constructor({ execute, notify, onTool, onFocus, onOverlay, onPanel }) {
    this.id = 'traffic';
    this.title = 'Circulation et pollution — le conseiller';
    this.execute = execute;
    this.notify = notify;
    this.onTool = onTool;
    this.onFocus = onFocus;
    this.onOverlay = onOverlay;
    this.onPanel = onPanel;
    this.tabs = [
      { id: 'advice', label: 'Diagnostic et conseils' },
      { id: 'levers', label: 'Comprendre les leviers' }
    ];
  }

  render(session, tab, rerender) {
    if (tab === 'levers') return levers();
    const s = session.state;
    const d = trafficDiagnosis(s, session.catalog);
    const ind = d.indicators;
    const [levelLabel, levelCls] = LEVEL[ind.level];
    const kpi = (label, value, sub, cls = '') => h('div.kpi', h('span', label), h('strong', { class: cls }, value), sub ? h('small', sub) : null);
    const pct = (v) => `${Math.round(v * 100)} %`;
    if (!(ind.vehicleTrips > 0)) {
      return [
        h('p.empty', 'Pas encore de circulation à analyser : reliez la ville à l\'autoroute et laissez-la grandir.'),
        levers()
      ];
    }
    return [
      h('div.traffic-level', { class: levelCls }, h('strong', levelLabel), h('span', ` — congestion moyenne ${pct(ind.congestion)}, ${formatNumber(ind.congestedTiles)} cases saturées`), meter(Math.min(1, ind.congestion), { color: levelCls === 'pos' ? 'var(--ok)' : levelCls === 'warn' ? 'var(--warn)' : 'var(--bad)' })),
      h('div.kpis',
        kpi('Déplacements en voiture', `${formatNumber(ind.vehicleTrips, 0)} /j`, 'véhicules sur le réseau'),
        kpi('Transports en commun', pct(ind.transitShare), `${formatNumber(ind.transitPassengers, 0)} voyageurs/j · ${pct(ind.covered)} des habitants desservis`, ind.transitShare > 0.25 ? 'pos' : ''),
        kpi('Durée moyenne des trajets', `${Math.round(ind.commute)} min`, ind.commute > 18 ? 'emplois trop loin des logements' : 'raisonnable', ind.commute > 18 ? 'neg' : ''),
        kpi('Pollution due au trafic', pct(ind.trafficPollutionShare), `pollution moyenne ${ind.avgPollution.toFixed(1).replace('.', ',')}`, ind.trafficPollutionShare > 0.5 ? 'neg' : '')
      ),
      d.hotspots.length
        ? [
            h('h3', 'Points noirs'),
            h('div.table-wrap', h('table.fin.compact',
              h('thead', h('tr', h('th', '#'), h('th', 'Axe'), h('th.num', 'Cases saturées'), h('th.num', 'Charge max.'), h('th.num', 'Véhicules/j'), h('th', ''))),
              h('tbody', d.hotspots.map((p, k) => h('tr',
                h('td', String(k + 1)),
                h('td', p.roadName, p.widenTo ? h('small', ` → ${p.widenTo === 'road_avenue' ? 'avenue' : 'boulevard'}`) : null),
                h('td.num', String(p.tiles)),
                h('td.num', { class: 'neg' }, pct(p.peak)),
                h('td.num', formatNumber(p.flow, 0)),
                h('td', h('button.btn.small', { type: 'button', on: { click: () => { this.onFocus(p.x, p.y); this.onOverlay('congestion'); } } }, 'Voir')))))))
          ]
        : h('p.hint', 'Aucun axe saturé pour le moment.'),
      h('h3', d.advice.length ? `Conseils (${d.advice.length}), du plus efficace au moins efficace` : 'Conseils'),
      d.advice.length ? h('div.advice-list', d.advice.map((a) => this.#card(s, session.catalog, a, rerender))) : h('p.hint', 'Rien d\'urgent : la circulation est sous contrôle. Continuez à desservir les nouveaux quartiers en transports en commun.')
    ];
  }

  #card(s, catalog, a, rerender) {
    return h('section.advice-card', { class: `impact-${a.impact}` },
      h('header', h('span.impact', `Impact ${a.impact}`), h('strong', a.title)),
      h('p', a.why),
      h('p.how', h('strong', 'Comment : '), a.how),
      h('div.advice-actions', a.actions.map((act) => this.#action(s, catalog, act, rerender))));
  }

  #action(s, catalog, act, rerender) {
    const btn = (label, onClick, { disabled = false, title = '' } = {}) => h('button.btn.small', { type: 'button', disabled, title, on: { click: onClick } }, label);
    switch (act.kind) {
      case 'focus':
        return btn(act.label, () => { this.onFocus(act.x, act.y); this.onOverlay('congestion'); });
      case 'overlay':
        return btn(act.label, () => this.onOverlay(act.overlay));
      case 'panel':
        return btn(act.label, () => this.onPanel(act.panel, act.tab));
      case 'tool':
        return btn(act.label, () => this.onTool(act.tool));
      case 'policy': {
        const p = catalog.policyById.get(act.policy);
        const u = isUnlocked(s, p.unlock);
        const cost = policyMonthlyCents(p, s.stats.population);
        return btn(`${act.label} (${formatMoney(cost)}/mois)`, () => {
          const r = this.execute({ type: 'policy', policyId: act.policy, enabled: true });
          this.notify(r.ok ? 'success' : 'warning', r.ok ? `Politique adoptée : ${p.name}` : r.reason ?? r.messages?.join(' · ') ?? 'Impossible');
          rerender();
        }, { disabled: !u.ok, title: u.ok ? '' : u.reason });
      }
      case 'research': {
        const t = catalog.techById.get(act.tech);
        const u = isUnlocked(s, t.unlock);
        const afford = s.economy.treasury >= t.costCents;
        return btn(`${act.label} (${formatMoney(t.costCents, { compact: true })})`, () => {
          const r = this.execute({ type: 'research', techId: act.tech });
          this.notify(r.ok ? 'success' : 'warning', r.ok ? `Technologie déployée : ${t.name}` : r.reason ?? r.messages?.join(' · ') ?? 'Impossible');
          rerender();
        }, { disabled: !u.ok || !afford, title: !u.ok ? u.reason : !afford ? 'Budget insuffisant' : '' });
      }
      default:
        return null;
    }
  }
}

/** Fiche pédagogique : comment se forme la congestion, d'où vient la pollution, et les leviers chiffrés. */
function levers() {
  const row = (lever, effect, cost) => h('tr', h('td', lever), h('td', effect), h('td', cost));
  return [
    h('h3', 'Comment se forme un embouteillage'),
    h('p', 'Chaque actif fait deux trajets par jour entre son logement et son emploi, chaque habitant des courses et des loisirs ; les commerces et l\'industrie sont livrés par camion. Ces déplacements empruntent le plus court chemin sur le réseau routier. Quand le flux d\'un tronçon dépasse sa capacité, il devient rouge sur la couche « Congestion » : les trajets s\'allongent, la satisfaction baisse et les bâtiments montent moins vite de niveau.'),
    h('h3', 'D\'où vient la pollution'),
    h('p', 'Chaque axe qui porte plus de 20 véhicules par jour pollue et fait du bruit autour de lui, d\'autant plus que le flux est fort. S\'y ajoutent les usines, les centrales et les déchets non collectés. Le conseiller estime la part due au trafic à partir des mêmes formules que la simulation.'),
    h('h3', 'Les leviers'),
    h('div.table-wrap', h('table.fin.compact',
      h('thead', h('tr', h('th', 'Levier'), h('th', 'Effet'), h('th', 'Contrepartie'))),
      h('tbody',
        row('Élargir : rue → avenue → grand boulevard', 'Capacité 650 → 1 800 → 3 200 véhicules/jour', 'Coût de construction et d\'entretien, plus de bruit'),
        row('Mailler le réseau (itinéraires parallèles, rocade)', 'Le trafic se répartit, plus de point de passage obligé', 'Emprise au sol'),
        row('Bus en lignes fréquentes', 'Un bus remplace une quinzaine de voitures', 'Dépôt, flotte (350 €/mois par bus)'),
        row('Tramway', '650 voyageurs/jour par rame, aucune voiture sur la chaussée', 'Rails 1 400 €/case, rames 1 500 €/mois'),
        row('Métro, gare, hyperboucle', 'Gros volumes sans toucher aux routes', 'Investissement élevé'),
        row('Mixité : emplois près des logements', 'Trajets plus courts, moins de kilomètres parcourus', 'Planification des zones'),
        row('Industrie près de l\'autoroute', 'Les camions ne traversent plus la ville', 'Choix des emplacements'),
        row('Télétravail encouragé', '−12 % de déplacements', 'Moins de demande de bureaux et de commerces'),
        row('Gratuité des transports', '+30 % de voyageurs', 'Plus de recettes de billetterie'),
        row('Zone à faibles émissions', '−25 % de pollution due au trafic', 'Demande commerciale et popularité en baisse'),
        row('Livraisons de nuit', '−35 % de camions aux heures de pointe', 'Bruit nocturne'),
        row('Feux prédictifs (IA)', '+15 % de capacité sur toutes les routes', 'Investissement et puissance de calcul'),
        row('Mobilité intégrée (MaaS)', '−5 points de part de la voiture', 'Prérequis technologiques'),
        row('Forêts et parcs le long des axes', 'Verdure, fraîcheur, bruit et pollution ressentis atténués', 'Emprise au sol'),
        row('Seconde sortie d\'autoroute', 'Deuxième porte vers la région', 'Dès 15 000 habitants, coûteuse'))))
    ,
    h('p.hint', 'Piège classique : les véhicules autonomes élargissent les routes de 20 %, mais créent 18 % de déplacements en plus et des trajets à vide. Sans transports en commun, la congestion revient.')
  ];
}
