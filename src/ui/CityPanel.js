import { h } from './dom.js';
import { lineChart, meter } from './charts.js';
import { formatNumber } from '../util/money.js';
import { MONTH_NAMES, SIM, formatDate } from '../simulation/config.js';
import { WEATHER, SEASONS, weatherEffectLabels } from '../simulation/WeatherSystem.js';
import { CRISIS_TYPES, CRISIS_KINDS, DISASTER_LEVEL_LABELS } from '../simulation/CrisisSystem.js';
import { confirmDialog } from './Dialog.js';
import { formatMoney } from '../util/money.js';

const pct = (v) => `${Math.round((v || 0) * 100)} %`;
const row = (label, value, cls = '') => h('div.kv', h('span', label), h('strong', { class: cls }, value));
const monthLabel = (mi) => `${MONTH_NAMES[mi % 12]} ${String(SIM.START_YEAR + Math.floor(mi / 12)).slice(2)}`;

/**
 * Tableau de bord de la ville : population, emploi, demande, énergie, eau, mobilité, environnement.
 */
export class CityPanel {
  constructor({ onFocus, getRenderStats, getHostStats, execute, notify, onPanel }) {
    this.onPanel = onPanel;
    this.getRenderStats = getRenderStats;
    this.getHostStats = getHostStats;
    this.execute = execute;
    this.notify = notify;
    this.id = 'city';
    this.title = 'Tableau de bord de la ville';
    this.onFocus = onFocus;
    this.tabs = [
      { id: 'people', label: 'Habitants et emploi' },
      { id: 'networks', label: 'Énergie et eau' },
      { id: 'mobility', label: 'Mobilité' },
      { id: 'transit', label: 'Transports en commun' },
      { id: 'waste', label: 'Déchets' },
      { id: 'progression', label: 'Progression' },
      { id: 'risks', label: 'Risques et météo' },
      { id: 'trends', label: 'Évolution' },
      { id: 'perf', label: 'Performance' }
    ];
  }

  render(session, tab) {
    const s = session.state;
    if (tab === 'networks') return this.#networks(s);
    if (tab === 'mobility') return this.#mobility(s);
    if (tab === 'transit') return this.#transit(s);
    if (tab === 'waste') return this.#waste(s);
    if (tab === 'progression') return this.#progression(session);
    if (tab === 'risks') return this.#risks(session);
    if (tab === 'trends') return this.#trends(s);
    if (tab === 'perf') return this.#perf(session);
    return this.#people(s);
  }

  #people(s) {
    const st = s.stats;
    const d = s.demand;
    return h('div.grid2',
      h('section',
        h('h3', 'Population'),
        row('Habitants', formatNumber(st.population)),
        row('Capacité de logement', formatNumber(st.housingCapacity)),
        row('Logements vacants', pct(st.housingVacancy)),
        row('Jeunes / actifs / seniors', `${formatNumber(st.ages.young)} / ${formatNumber(st.ages.adult)} / ${formatNumber(st.ages.senior)}`),
        row('Ménages modestes / intermédiaires / aisés', `${formatNumber(st.households.low)} / ${formatNumber(st.households.mid)} / ${formatNumber(st.households.high)}`),
        row('Arrivées / départs (mois en cours)', `${formatNumber(st.arrivals)} / ${formatNumber(st.departures)}`),
        row('Loyer moyen', `${formatNumber(st.avgRent, 0)} €`),
        h('h3', 'Satisfaction'),
        row('Moyenne', `${Math.round(st.satisfaction)} / 100`),
        meter(st.satisfaction / 100, { color: st.satisfaction > 60 ? 'var(--ok)' : st.satisfaction > 35 ? 'var(--warn)' : 'var(--bad)' }),
        row('Modestes / intermédiaires / aisés', `${Math.round(st.satisfactionByIncome.low)} / ${Math.round(st.satisfactionByIncome.mid)} / ${Math.round(st.satisfactionByIncome.high)}`),
        row('Bâtiments abandonnés', formatNumber(st.abandoned), st.abandoned ? 'neg' : '')
      ),
      h('section',
        h('h3', 'Emploi'),
        row('Population active', formatNumber(st.workforce)),
        row('Actifs occupés', formatNumber(st.employed)),
        row('Taux de chômage', pct(st.unemploymentRate), st.unemploymentRate > 0.1 ? 'neg' : ''),
        row('Emplois offerts / pourvus', `${formatNumber(st.jobs, 0)} / ${formatNumber(st.jobsFilled)}`),
        row('Navetteurs entrants / sortants', `${formatNumber(st.commutersIn)} / ${formatNumber(st.commutersOut)}`),
        h('table.fin.compact', h('thead', h('tr', h('th', 'Qualification'), h('th.num', 'Actifs'), h('th.num', 'Emplois'), h('th.num', 'Chômeurs'))),
          h('tbody', [['low', 'Peu qualifiés'], ['mid', 'Intermédiaires'], ['high', 'Très qualifiés']].map(([k, l]) =>
            h('tr', h('td', l), h('td.num', formatNumber(st.workersByBracket[k])), h('td.num', formatNumber(st.jobsByBracket[k], 0)), h('td.num', formatNumber(st.unemployedByBracket[k], 0)))))),
        h('h3', 'Économie locale'),
        row('Consommation / capacité commerciale', `${formatNumber(st.consumption, 0)} / ${formatNumber(st.salesCapacity, 0)}`),
        row('Production industrielle', formatNumber(st.goodsProduced, 0)),
        h('h3', 'Demande'),
        row('Résidentiel', formatNumber(d.R, 0), d.R < 0 ? 'neg' : 'pos'),
        row('Commerce', formatNumber(d.C, 0), d.C < 0 ? 'neg' : 'pos'),
        row('Bureaux', formatNumber(d.O, 0), d.O < 0 ? 'neg' : 'pos'),
        row('Industrie', formatNumber(d.I, 0), d.I < 0 ? 'neg' : 'pos')
      )
    );
  }

  #networks(s) {
    const p = s.utilities.power ?? {};
    const w = s.utilities.water ?? {};
    const SRC = { conventional: 'Conventionnelle', solar: 'Solaire', wind: 'Éolien', storage: 'Stockage' };
    return h('div.grid2',
      h('section',
        h('h3', 'Électricité'),
        row('Capacité de production', `${formatNumber(p.capacity ?? 0, 0)} u.`),
        row('Demande', `${formatNumber(p.demand ?? 0, 0)} u.`),
        meter((p.demand ?? 0) / Math.max(1, p.capacity ?? 0), { color: (p.demand ?? 0) > (p.capacity ?? 0) ? 'var(--bad)' : 'var(--ok)' }),
        row('Demande non servie', `${formatNumber(p.unserved ?? 0, 0)} u.`, p.unserved > 0 ? 'neg' : ''),
        row('Bâtiments délestés', formatNumber(p.unpoweredBuildings ?? 0), p.unpoweredBuildings ? 'neg' : ''),
        row('Stockage', `${formatNumber(p.storage ?? 0, 0)} / ${formatNumber(p.storageCap ?? 0, 0)} u.`),
        row('Réseaux distincts', `${p.networks ?? 0} (${p.networksWithProduction ?? 0} avec production)`),
        Object.entries(p.bySource ?? {}).map(([k, v]) => row(`Production ${SRC[k] ?? k}`, `${formatNumber(v, 0)} u.`))
      ),
      h('section',
        h('h3', 'Eau et assainissement'),
        row('Capacité de production', `${formatNumber(w.capacity ?? 0, 0)} u.`),
        row('Consommation', `${formatNumber(w.demand ?? 0, 0)} u.`),
        meter((w.demand ?? 0) / Math.max(1, w.capacity ?? 0), { color: (w.demand ?? 0) > (w.capacity ?? 0) ? 'var(--bad)' : 'var(--ok)' }),
        row('Bâtiments sans eau', formatNumber(w.unwateredBuildings ?? 0), w.unwateredBuildings ? 'neg' : ''),
        row('Eaux usées / traitées', `${formatNumber(w.sewage ?? 0, 0)} / ${formatNumber(w.treated ?? 0, 0)} u.`),
        row('Part non traitée', pct(w.untreatedShare), (w.untreatedShare ?? 0) > 0.2 ? 'neg' : ''),
        h('h3', 'Environnement'),
        row('Pollution moyenne (zones bâties)', formatNumber(s.stats.avgPollution, 1)),
        row('Chaleur moyenne (zones bâties)', formatNumber(s.stats.avgHeat, 1)),
        row('Valeur foncière moyenne', formatNumber(s.stats.avgLandValue, 0))
      )
    );
  }

  #mobility(s) {
    const t = s.traffic.stats ?? {};
    return h('div.grid2',
      h('section',
        h('h3', 'Déplacements'),
        this.onPanel ? h('p', h('button.btn.primary', { type: 'button', on: { click: () => this.onPanel('traffic') } }, 'Conseiller circulation et pollution (P)')) : null,
        row('Déplacements motorisés / jour', formatNumber(t.vehicleTrips ?? 0)),
        row('Véhicules × km / jour', formatNumber(t.vkt ?? 0)),
        row('Trajet domicile-travail moyen', `${(t.avgCommute ?? 0).toFixed(1)} min`),
        row('Charge moyenne du réseau', pct(t.avgCongestion)),
        row('Cases de route saturées', `${t.congestedTiles ?? 0} / ${t.roadTiles ?? 0}`, t.congestedTiles ? 'neg' : ''),
        row('Déplacements sans destination accessible', formatNumber(t.unreachableTrips ?? 0), t.unreachableTrips ? 'neg' : ''),
        h('p.hint', `Cycle d'affectation n°${t.cycle ?? 0}. Les flux sont recalculés progressivement, quelques quartiers à chaque jour de jeu.`)
      ),
      h('section',
        h('h3', 'Axes les plus sollicités'),
        (t.topAxes ?? []).length
          ? h('table.fin.compact', h('thead', h('tr', h('th', 'Case'), h('th.num', 'Véh./jour'), h('th.num', 'Charge'), h('th', ''))),
            h('tbody', t.topAxes.map((a) => h('tr', h('td', `${a.x}, ${a.y}`), h('td.num', formatNumber(a.flow)), h('td.num', { class: a.vc > 1 ? 'neg' : '' }, pct(a.vc)), h('td', h('button.link', { on: { click: () => this.onFocus(a.x, a.y) } }, 'Voir'))))))
          : h('p.empty', 'Pas encore de trafic mesuré.')
      )
    );
  }

  #transit(s) {
    const t = s.transit.stats ?? {};
    const p = t.passengers ?? {};
    const c = t.capacity ?? {};
    const d = t.demand ?? {};
    const line = (mode, label) =>
      h('tr', h('td', label), h('td.num', formatNumber(p[mode] ?? 0, 0)), h('td.num', formatNumber(d[mode] ?? 0, 0)), h('td.num', formatNumber(c[mode] ?? 0, 0)),
        h('td.num', { class: (t.saturation?.[mode] ?? 0) > 1 ? 'neg' : '' }, c[mode] ? pct(Math.min(9.99, t.saturation[mode])) : '—'));
    return h('div.grid2',
      h('section',
        h('h3', 'Fréquentation'),
        h('table.fin.compact', h('thead', h('tr', h('th', 'Réseau'), h('th.num', 'Voyageurs/j'), h('th.num', 'Demande'), h('th.num', 'Capacité'), h('th.num', 'Charge'))),
          h('tbody', line('bus', 'Bus'), line('tram', 'Tramway'), line('metro', 'Métro'), line('rail', 'Train et hyperboucle'))),
        row('Habitants desservis', pct(t.coveredShare)),
        row('Trajets en voiture évités / jour', formatNumber(t.carTripsAvoided ?? 0, 0)),
        row('Prix effectif du billet', `${(t.fare ?? 0).toFixed(2)} €`),
        row('Facteur de fréquentation', `${(t.ridershipFactor ?? 1).toFixed(2)}`)
      ),
      h('section',
        h('h3', 'Équipements'),
        row('Arrêts de bus (actifs / construits)', `${t.activeStops ?? 0} / ${t.stops ?? 0}`, (t.stops ?? 0) > (t.activeStops ?? 0) ? 'warn' : ''),
        row('Dépôts de bus', formatNumber(t.depots ?? 0)),
        row('Réseau de bus', { auto: 'automatique (aucune ligne tracée)', mixed: 'lignes tracées + réseau de base', lines: 'lignes tracées' }[t.busNetwork ?? 'auto']),
        row('Stations de tramway (actives / construites)', `${t.activeTramStops ?? 0} / ${t.tramStops ?? 0}`, (t.tramStops ?? 0) > (t.activeTramStops ?? 0) ? 'warn' : ''),
        row('Lignes de bus et de tramway (en service / tracées)', `${t.activeLines ?? 0} / ${t.lines ?? 0}`, (t.lines ?? 0) > (t.activeLines ?? 0) ? 'warn' : ''),
        row('Stations de métro', formatNumber(t.metroStations ?? 0), t.metroStations === 1 ? 'warn' : ''),
        row('Gares et stations d\'hyperboucle', formatNumber(t.railStations ?? 0)),
        h('p.hint', 'Un arrêt de bus ne fonctionne que s\'il est relié par la route à un dépôt alimenté ; les arrêts hors des lignes tracées restent desservis par le réseau de base, moins fréquent. Le tramway roule sur ses lignes. Le métro demande au moins deux stations. Le train transporte les navetteurs vers la région. Lignes : touche K.')
      )
    );
  }

  #waste(s) {
    const w = s.waste.stats ?? {};
    const LIMIT = { coverage: 'quartiers hors de portée des bennes', collection: 'flotte de bennes insuffisante', processing: 'installations de traitement saturées' };
    const by = w.byKind ?? {};
    const KIND = { recycling: 'Recyclage', valorisation: 'Valorisation IA', biogas: 'Méthanisation', incinerator: 'Incinération', landfill: 'Décharge' };
    return h('div.grid2',
      h('section',
        h('h3', 'Collecte'),
        row('Déchets produits', `${formatNumber(w.generated ?? 0, 0)} u./jour`),
        row('Déchets collectés', `${formatNumber(w.collected ?? 0, 0)} u./jour`),
        row('Taux de collecte', pct(w.collectionRate), (w.collectionRate ?? 1) < 0.85 ? 'neg' : 'pos'),
        meter(w.collectionRate ?? 0, { color: (w.collectionRate ?? 1) < 0.85 ? 'var(--bad)' : 'var(--ok)' }),
        row('Quartiers couverts', pct(w.coverage)),
        row('Capacité des bennes', `${formatNumber(w.collectCap ?? 0, 0)} u./jour`),
        row('Capacité de traitement', `${formatNumber(w.processCap ?? 0, 0)} u./jour`),
        w.limitedBy ? row('Facteur limitant', LIMIT[w.limitedBy], 'neg') : null
      ),
      h('section',
        h('h3', 'Traitement'),
        Object.entries(KIND).map(([k, l]) => row(l, `${formatNumber(by[k] ?? 0, 0)} u./jour`)),
        row('Décharges : remplissage', w.landfillCapacity ? `${pct((w.landfillUsed ?? 0) / w.landfillCapacity)} de ${formatNumber(w.landfillCapacity)} u.` : '—'),
        row('Électricité tirée des déchets', `${formatNumber(w.powerFromWaste ?? 0, 0)} u.`),
        row('Matériaux recyclés vendus', `${formatNumber(w.recycledPerDay ?? 0, 0)} u./jour`),
        h('p.hint', 'Les déchets non collectés s\'accumulent : satisfaction et valeur foncière baissent, et les bâtiments ne peuvent plus monter de niveau.')
      )
    );
  }

  #progression(session) {
    const s = session.state;
    const ev = session.sim.progression.evaluate(s);
    const levels = {};
    for (const b of s.buildings.values()) {
      const d = session.catalog.buildingFor(b);
      if (d.kind === 'growable') levels[d.level] = (levels[d.level] ?? 0) + 1;
    }
    return [
      h('div.era-card',
        h('span.small', `Ère ${ev.era} sur 3`),
        h('strong', ev.current.name),
        h('p.small', ev.current.description),
        h('div.era-steps', [1, 2, 3].map((n) => h('span.era-step', { class: n <= ev.era ? 'done' : '' }, `${n}. ${n === 1 ? 'Connectée' : n === 2 ? 'Autonome' : 'Symbiotique'}`)))
      ),
      ev.next
        ? h('section', h('h3', `Pour atteindre l'ère « ${ev.next.name} »`), h('p.small', ev.next.description),
          h('ul.checks', ev.checks.map((c) => h('li', { class: c.ok ? 'ok' : 'ko' }, h('span', c.ok ? '✓' : '✗'), h('span', c.label), h('small', String(c.value))))))
        : h('p.hint', 'Toutes les ères sont atteintes.'),
      h('section', h('h3', 'Bâtiments par niveau'),
        h('table.fin.compact', h('thead', h('tr', [1, 2, 3, 4, 5].map((n) => h('th.num', `Niveau ${n}`)))),
          h('tbody', h('tr', [1, 2, 3, 4, 5].map((n) => h('td.num', formatNumber(levels[n] ?? 0))))))),
      h('p.hint', 'Les niveaux 4 et 5 demandent une ère avancée, des services publics, la collecte des déchets, une desserte en transports en commun et une satisfaction élevée. Sélectionnez un bâtiment pour voir ses conditions.')
    ];
  }

  #trends(s) {
    const hist = s.history.slice(-60);
    const labels = hist.map((x) => monthLabel(x.monthIndex));
    return [
      h('h3', 'Population'),
      lineChart({ labels, series: [{ label: 'Habitants', color: '#7fc96b', values: hist.map((x) => x.population) }], format: (v) => formatNumber(v) }),
      h('h3', 'Satisfaction et chômage'),
      lineChart({ labels, series: [
        { label: 'Satisfaction (/100)', color: '#f2c230', values: hist.map((x) => x.satisfaction) },
        { label: 'Chômage (%)', color: '#e0553a', values: hist.map((x) => x.unemployment * 100) },
        { label: 'Charge du réseau routier (%)', color: '#6ec6ff', values: hist.map((x) => x.congestion * 100) }
      ] }),
      h('h3', 'Recettes et charges mensuelles'),
      lineChart({ labels, series: [
        { label: 'Recettes', color: '#49b37a', values: hist.map((x) => x.revenues / 100) },
        { label: 'Charges', color: '#e0553a', values: hist.map((x) => x.opex / 100) }
      ], format: (v) => `${formatNumber(v / 1000, 0)} k€` })
    ];
  }

  #risks(session) {
    const s = session.state;
    const w = s.weather ?? {};
    const info = WEATHER[w.kind] ?? WEATHER.clear;
    const month = Math.floor(s.time.tick / 30) % 12;
    const crises = s.crises ?? { active: [], history: [] };
    const level = s.options?.disasters ?? 'off';
    const effects = weatherEffectLabels(w);
    const trigger = async (kind) => {
      const type = CRISIS_TYPES[kind];
      if (!(await confirmDialog(`Déclencher volontairement : ${type.name} ?`, { confirmLabel: 'Déclencher', danger: true }))) return;
      const r = this.execute({ type: 'triggerDisaster', kind });
      if (!r?.ok) this.notify('warning', r?.reason ?? 'Impossible pour le moment');
    };
    return [
      h('div.grid2',
        h('section',
          h('h3', 'Météo'),
          h('div.weather-now', h('span.weather-big', { 'aria-hidden': 'true' }, info.icon), h('div', h('strong', info.label), h('small', `${String(w.temp ?? '–').replace('.', ',')} °C · ${SEASONS[month]}`))),
          effects.length ? h('ul.plain', effects.map((e) => h('li', e))) : h('p.hint', 'Aucun effet notable sur la ville.'),
          row('Pluie des derniers jours', (w.rain7 ?? 0) >= 2.6 ? 'sols saturés : risque de crue' : (w.rain7 ?? 0) >= 1.5 ? 'sols humides' : 'faible', (w.rain7 ?? 0) >= 2.6 ? 'neg' : ''),
          (w.snowCover ?? 0) > 0.05 ? row('Neige au sol', pct(w.snowCover)) : null
        ),
        h('section',
          h('h3', 'Crises en cours'),
          crises.active.length
            ? h('ul.plain', crises.active.map((c) => h('li', `${CRISIS_TYPES[c.kind].icon} ${CRISIS_TYPES[c.kind].name} — depuis le ${formatDate(c.start)}${c.response ? ` · réponse : ${CRISIS_TYPES[c.kind].responses.find((r) => r.id === c.response)?.label}` : ' · décision en attente'}`,
              Number.isInteger(c.x) ? h('button.link', { type: 'button', on: { click: () => this.onFocus(c.x, c.y) } }, ' Voir') : null)))
            : h('p.hint', 'Aucune crise en cours.'),
          h('h3', 'Dernières crises'),
          crises.history.length
            ? h('ul.plain', crises.history.slice(-8).reverse().map((c) => h('li', h('strong', `${CRISIS_TYPES[c.kind]?.icon ?? ''} ${c.label}`), h('small', ` ${formatDate(c.start)}${c.summary ? ` · ${c.summary}` : ''}`))))
            : h('p.hint', 'Aucune crise pour le moment.'),
          row('Dépenses de crise (mois en cours)', formatMoney(s.economy.current?.opex?.crisis ?? 0))
        )
      ),
      h('section',
        h('h3', 'Risques du mois'),
        row('Fréquence des catastrophes', DISASTER_LEVEL_LABELS[level] ?? level),
        level === 'off' ? h('p.hint', 'Catastrophes désactivées (Menu → Paramètres pour les réactiver).') : null,
        h('table.fin.compact.risk-table',
          h('thead', h('tr', h('th', 'Crise'), h('th.num', 'Risque / mois'), h('th', 'Prévention'))),
          h('tbody', CRISIS_KINDS.map((k) => {
            const p = session.sim.crises.monthlyRisk(s, k);
            const t = CRISIS_TYPES[k];
            const cls = p > 0.1 ? 'neg' : p > 0.03 ? 'warn' : '';
            return h('tr', h('td', `${t.icon} ${t.name}`), h('td.num', { class: cls }, p < 0.001 ? '—' : `${(p * 100).toFixed(p < 0.1 ? 1 : 0).replace('.', ',')} %`), h('td', h('small', t.mitigation)));
          }))
        ),
        h('details.factors', h('summary', 'Ce qui fait monter les risques'), h('ul.plain', CRISIS_KINDS.map((k) => h('li', h('strong', `${CRISIS_TYPES[k].name} : `), CRISIS_TYPES[k].factors)))),
        h('details.trigger',
          h('summary', 'Déclencher une catastrophe'),
          h('p.hint', 'Comme dans les SimCity : pour tester la résistance de la ville. Les dégâts sont réels.'),
          h('div.debug-actions', CRISIS_KINDS.map((k) => h('button.btn', { type: 'button', on: { click: () => trigger(k) } }, `${CRISIS_TYPES[k].icon} ${CRISIS_TYPES[k].name}`)))
        )
      )
    ];
  }

  #perf(session) {
    const t = session.sim.timings;
    const r = this.getRenderStats?.() ?? {};
    const hs = this.getHostStats?.();
    return [
      hs ? row('Simulation', hs.kind === 'worker' ? `Web Worker (arrière-plan) · ${formatNumber(hs.snapshots)} synchronisations · ${hs.applyMs.toFixed(2)} ms chacune` : 'fil principal') : null,
      hs?.kind === 'worker' ? row('Jours en attente / abandonnés', `${hs.backlog} / ${formatNumber(hs.dropped)}`) : null,
      h('p.hint', 'Temps de calcul moyens mesurés sur cette machine (moyenne glissante).'),
      h('table.fin.compact', h('thead', h('tr', h('th', 'Sous-système'), h('th.num', 'ms par exécution'))),
        h('tbody', Object.entries(t).map(([k, v]) => h('tr', h('td', k), h('td.num', v.toFixed(2)))))),
      h('h3', 'Rendu'),
      row('Images par seconde', formatNumber(r.fps ?? 0, 0)),
      row('Temps de préparation d\'image', `${(r.frameMs ?? 0).toFixed(2)} ms`),
      row('Carte', `${session.state.grid.width} × ${session.state.grid.height} cases`),
      row('Bâtiments', formatNumber(session.state.buildings.size))
    ];
  }
}

