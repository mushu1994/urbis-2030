import { h } from './dom.js';
import { formatMoney } from '../util/money.js';
import { parcelMap, parcelPrice, landOf, PARCEL, WORLD_PARCELS, PARCEL_FIXED_COUNT, fixedParcelEuros } from '../world/Land.js';
import { EconomySystem } from '../simulation/EconomySystem.js';
import { featureUnlocked } from '../simulation/Milestones.js';
import { SIDES, exitsBySide } from '../systems/ConstructionService.js';

/**
 * Territoire (v0.6) : carte des 8 × 8 parcelles du monde possible. Les parcelles voisines du territoire
 * s'achètent une à une (32 × 32 cases), jusqu'à 256 × 256 cases.
 */
export class TerritoryPanel {
  constructor({ onBuy, onExit, onFocus }) {
    this.id = 'territory';
    this.title = 'Territoire et accès';
    this.onBuy = onBuy;
    this.onExit = onExit;
    this.onFocus = onFocus;
  }

  /** v1.4 : sorties d'autoroute sur les quatre côtés de la carte. */
  #exits(session) {
    const s = session.state;
    const g = s.grid;
    const by = exitsBySide(s);
    const rows = ['N', 'E', 'S', 'W'].map((side) => {
      const list = by[side];
      const pv = session.preview({ type: 'exit', side });
      const status = list.length ? `${list.length} sortie${list.length > 1 ? 's' : ''}` : 'aucune sortie';
      return h('tr', { class: list.length ? 'open' : '' },
        h('th', SIDES[side].label),
        h('td', { class: list.length ? 'pos' : '' }, status),
        h('td', pv.ok || pv.reasons?.every((r) => r === 'budget')
          ? `${formatMoney(pv.cost)} · ${pv.length} cases${pv.tiles?.some((t) => t.bridge) ? ', dont pont' : ''}`
          : h('small', pv.messages?.[0] ?? '')),
        h('td.exit-actions',
          list.length ? h('button.btn.small', { type: 'button', on: { click: () => this.onFocus?.(g.xOf(list[0]), g.yOf(list[0])) } }, 'Voir') : null,
          h('button.btn.small.primary', {
            type: 'button',
            disabled: !pv.ok,
            title: pv.ok ? 'Tracer l\'autoroute de sortie la moins chère vers ce bord' : pv.messages?.join(' · '),
            on: { click: () => this.onExit?.(side, pv) }
          }, list.length ? 'Ajouter' : 'Ouvrir')));
    });
    return h('section.exits',
      h('h3', 'Sorties d\'autoroute'),
      h('p.hint', 'Chaque sortie est un accès vers la région : habitants, navetteurs et marchandises passent par la plus proche. Le tracé proposé part de la route reliée la plus proche du bord et peut finir en pont au-dessus de l\'eau. Statut Grande ville requis.'),
      h('table.exit-table', h('tbody', rows)));
  }

  render(session) {
    const s = session.state;
    const land = landOf(s);
    const price = parcelPrice(s, EconomySystem.summarize);
    const cells = parcelMap(s);
    const afford = s.economy.treasury >= price;
    const crisis = (s.crises?.active ?? []).length > 0;
    // v1.0 : extensions de territoire au statut « Grande ville »
    const lock = featureUnlocked(s, 'territory');
    const owned = cells.filter((c) => c.status === 'owned').length;
    const grid = h('div.territory-grid', { style: { gridTemplateColumns: `repeat(${WORLD_PARCELS}, 1fr)` }, role: 'grid', 'aria-label': 'Parcelles du territoire' },
      cells.map((c) => {
        const inBox = c.gx >= land.box.x0 && c.gx <= land.box.x1 && c.gy >= land.box.y0 && c.gy <= land.box.y1;
        const label = c.status === 'owned' ? 'Parcelle de la commune' : c.status === 'available' ? `Acheter cette parcelle : ${formatMoney(price)}` : 'Hors d\'atteinte : achetez d\'abord une parcelle voisine';
        return h('button.parcel', {
          type: 'button',
          class: `${c.status}${inBox ? ' inbox' : ''}`,
          title: label,
          'aria-label': label,
          disabled: c.status !== 'available' || !afford || crisis || !lock.ok,
          dataset: { gx: String(c.gx), gy: String(c.gy) },
          on: { click: () => this.onBuy(c.gx, c.gy, price) }
        }, c.status === 'available' ? '+' : '');
      })
    );
    return h('div.territory',
      h('div.kpis',
        h('div.kpi', h('span', 'Surface de la carte'), h('strong', `${s.grid.width} × ${s.grid.height}`), h('small', `${owned} parcelle${owned > 1 ? 's' : ''} de ${PARCEL} × ${PARCEL} cases`)),
        h('div.kpi', h('span', 'Prochaine extension'), h('strong', { class: afford ? '' : 'neg' }, formatMoney(price)), h('small', land.purchases < PARCEL_FIXED_COUNT ? `extension ${land.purchases + 1} / ${PARCEL_FIXED_COUNT} à prix fixe${fixedParcelEuros(land.purchases + 1) ? ` · suivante ${formatMoney(fixedParcelEuros(land.purchases + 1) * 100, { compact: true })}` : ''}` : '≈ 1 h d\'épargne, +20 % à chaque achat')),
        h('div.kpi', h('span', 'Déjà investi'), h('strong', formatMoney(land.spent ?? 0)), h('small', `${land.purchases} extension${land.purchases > 1 ? 's' : ''}`))
      ),
      grid,
      h('p.hint', !lock.ok
        ? `${lock.reason}.`
        : crisis
        ? 'Les acquisitions sont suspendues pendant une crise.'
        : 'Les parcelles marquées « + » touchent le territoire actuel. Les 10 premières extensions ont un prix fixe : 400 000 € pour la première, puis 200 000 € de plus à chaque achat (2,2 M€ pour la dixième). Ensuite, le prix vaut environ une heure de jeu d\'épargne (60 mois de variation moyenne de la trésorerie), avec un plancher de 2,4 M€, et augmente de 20 % à chaque achat. Le terrain d\'une nouvelle parcelle prolonge le relief existant ; l\'accès autoroutier est prolongé jusqu\'au nouveau bord si besoin.'),
      h('div.territory-legend', h('span.parcel.owned'), 'Commune', h('span.parcel.available'), 'Achetable', h('span.parcel.locked'), 'Hors d\'atteinte'),
      this.#exits(session)
    );
  }
}
