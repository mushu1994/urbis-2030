import { h } from './dom.js';
import { meter } from './charts.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { LINE_MODES, LINE_COLORS, lineTiming } from '../simulation/LineSystem.js';
import { SIM } from '../simulation/config.js';
import { toCents } from '../util/money.js';

/**
 * Lignes de bus et de tramway (v0.8) : liste des lignes, flotte et fréquence, fréquentation, saturation et coûts.
 * Les tracés s'affichent sur la carte tant que le panneau est ouvert (survol d'une ligne : mise en évidence).
 */
export class LinesPanel {
  constructor({ execute, notify, onTool, onFocus, confirm }) {
    this.id = 'lines';
    this.title = 'Lignes de bus et de tramway';
    this.execute = execute;
    this.notify = notify;
    this.onTool = onTool;
    this.onFocus = onFocus;
    this.confirm = confirm;
    /** Ligne mise en évidence sur la carte (survol). */
    this.highlight = 0;
  }

  render(session, _tab, rerender) {
    const s = session.state;
    const lines = s.lines?.list ?? [];
    const ts = s.transit?.stats ?? {};
    const costs = session.sim.lines.monthlyCosts(s);
    const fleet = { bus: 0, tram: 0 };
    for (const l of lines) fleet[l.mode] += l.vehicles;
    const kpi = (label, value, sub, cls = '') => h('div.kpi', h('span', label), h('strong', { class: cls }, value), sub ? h('small', sub) : null);
    const pax = ts.passengers ?? {};
    const header = [
      h('div.kpis',
        kpi('Voyageurs en bus', `${formatNumber(pax.bus ?? 0, 0)} /j`, ts.busNetwork === 'lines' ? 'tous les arrêts sur des lignes' : ts.busNetwork === 'mixed' ? `dont ${formatNumber(ts.basePassengers ?? 0, 0)} sur le réseau de base (${ts.baseStops} arrêts hors ligne)` : 'réseau automatique'),
        kpi('Voyageurs en tramway', `${formatNumber(pax.tram ?? 0, 0)} /j`, `${ts.activeTramStops ?? 0} station(s) en service`),
        kpi('Flotte', `${fleet.bus} bus · ${fleet.tram} tram.`, 'véhicules demandés par les lignes'),
        kpi('Coût mensuel des lignes', formatMoney(costs.fleet + costs.tracks), `flotte ${formatMoney(costs.fleet, { compact: true })} · rails ${formatMoney(costs.tracks, { compact: true })} (${costs.trackTiles} cases)`)
      ),
      h('div.lines-actions',
        h('button.btn.primary', { type: 'button', on: { click: () => this.onTool('line:bus') } }, 'Tracer une ligne de bus'),
        h('button.btn.primary', { type: 'button', on: { click: () => this.onTool('line:tram') } }, 'Tracer une ligne de tramway'))
    ];
    if (!lines.length) {
      return [
        ...header,
        h('p.empty', 'Aucune ligne tracée : les bus circulent sur le réseau automatique (tout arrêt relié à un dépôt est desservi).'),
        howTo()
      ];
    }
    const cards = lines.map((line) => this.#card(s, line, rerender));
    return [...header, h('div.lines-list', cards), howTo()];
  }

  #card(s, line, rerender) {
    const M = LINE_MODES[line.mode];
    const st = line.stats ?? {};
    const km = (line.length * SIM.TILE_KM).toFixed(1).replace('.', ',');
    const sat = st.saturation ?? 0;
    const set = (vehicles) => {
      const r = this.execute({ type: 'line', op: 'update', id: line.id, vehicles });
      if (!r.ok) this.notify('warning', r.messages?.join(' · ') ?? 'Modification impossible');
      rerender();
    };
    // Intervalle prévu pour la flotte demandée (la simulation l'actualise ensuite)
    const plan = lineTiming(line.mode, line.length, line.stops.length, line.vehicles);
    const name = h('input.line-name', {
      type: 'text',
      value: line.name,
      maxLength: 28,
      'aria-label': 'Nom de la ligne',
      on: { change: (e) => { this.execute({ type: 'line', op: 'update', id: line.id, name: e.target.value }); rerender(); } }
    });
    const swatches = h('div.line-colors', LINE_COLORS.map((c) => h('button.line-color', {
      type: 'button',
      class: c === line.color ? 'active' : '',
      style: { background: c },
      'aria-label': `Couleur ${c}`,
      on: { click: () => { this.execute({ type: 'line', op: 'update', id: line.id, color: c }); rerender(); } }
    })));
    const issue = line.status !== 'ok' ? line.reason ?? 'Ligne interrompue' : st.issue;
    return h('section.line-card', {
      style: { borderLeftColor: line.color },
      on: {
        mouseenter: () => (this.highlight = line.id),
        mouseleave: () => (this.highlight = 0)
      }
    },
    h('header.line-head',
      h('span.line-badge', { style: { background: line.color } }, line.mode === 'tram' ? 'T' : 'B'),
      name,
      h('small', `${M.label} · ${line.stops.length} arrêts · boucle de ${km} km`)),
    issue ? h('p.demand-warn', `⚠ ${issue}`) : null,
    h('div.line-grid',
      h('div.line-fleet',
        h('span', 'Véhicules'),
        h('div.stepper',
          h('button.btn.small', { type: 'button', 'aria-label': 'Un véhicule de moins', disabled: line.vehicles <= 1, on: { click: () => set(line.vehicles - 1) } }, '−'),
          h('strong', String(line.vehicles)),
          h('button.btn.small', { type: 'button', 'aria-label': 'Un véhicule de plus', disabled: line.vehicles >= M.maxVehicles, on: { click: () => set(line.vehicles + 1) } }, '+')),
        h('small', `${formatMoney(toCents(line.vehicles * M.vehicleCost))}/mois`)),
      h('div', h('span', 'Un passage toutes les'), h('strong', `${Math.max(1, Math.round(st.headway ?? plan.headway))} min`), h('small', `tour complet : ${Math.round(plan.cycle)} min`)),
      h('div', h('span', 'Voyageurs'), h('strong', `${formatNumber(st.passengers ?? 0, 0)} /j`), h('small', `demande ${formatNumber(st.demand ?? 0, 0)} · capacité ${formatNumber(st.capacity ?? 0, 0)}`)),
      h('div', h('span', 'Charge'), h('strong', { class: sat > 1 ? 'neg' : '' }, `${Math.round(sat * 100)} %`), meter(Math.min(1, sat), { color: sat > 1 ? 'var(--bad)' : sat > 0.85 ? 'var(--warn)' : 'var(--ok)' }))
    ),
    h('footer.line-foot',
      swatches,
      h('button.btn.small', { type: 'button', on: { click: () => this.#focus(s, line) } }, 'Voir sur la carte'),
      h('button.btn.small.danger', {
        type: 'button',
        on: {
          click: async () => {
            const ok = await this.confirm(`Supprimer la ligne « ${line.name} » ?${line.mode === 'tram' ? ' Les rails qu\'aucune autre ligne n\'emprunte seront déposés (sans remboursement).' : ''}`);
            if (!ok) return;
            this.execute({ type: 'line', op: 'remove', id: line.id });
            rerender();
          }
        }
      }, 'Supprimer'))
    );
  }

  #focus(s, line) {
    const b = s.buildings.get(line.stops[0]);
    if (b) this.onFocus(b.x, b.y);
  }
}

function howTo() {
  return h('ul.demand-advice',
    h('li', 'Tracer une ligne : touchez les arrêts dans l\'ordre du parcours, puis Valider (ou touchez à nouveau le premier arrêt). La ligne fait la boucle par le plus court chemin routier.'),
    h('li', `Bus : arrêts de bus et un dépôt de bus sur le même réseau routier (${LINE_MODES.bus.depotSlots} bus par dépôt, ${LINE_MODES.bus.vehicleCap} voyageurs par jour et par bus). Les arrêts hors des lignes restent desservis par le « réseau de base » (bus restés au dépôt), moins fréquent : desserte à 60 %.`),
    h('li', `Tramway : stations de tramway et un dépôt de tramway (${LINE_MODES.tram.depotSlots} rames par dépôt, ${LINE_MODES.tram.vehicleCap} voyageurs par jour et par rame). Rails posés sur les rues, avenues et boulevards (${LINE_MODES.tram.trackCost.toLocaleString('fr-FR')} € par case).`),
    h('li', 'Plus de véhicules : passages plus fréquents (un toutes les 6 minutes = desserte optimale), plus de capacité, mais plus de coûts. Une ligne saturée laisse des voyageurs à quai : ajoutez des véhicules ou une ligne parallèle.'));
}
