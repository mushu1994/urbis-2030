import { h } from './dom.js';
import { formatMoney } from '../util/money.js';
import { parcelMap, parcelPrice, landOf, PARCEL, WORLD_PARCELS, PARCEL_MONTHS_OF_CASH } from '../world/Land.js';
import { EconomySystem } from '../simulation/EconomySystem.js';

/**
 * Territoire (v0.6) : carte des 8 × 8 parcelles du monde possible. Les parcelles voisines du territoire
 * s'achètent une à une (32 × 32 cases), jusqu'à 256 × 256 cases.
 */
export class TerritoryPanel {
  constructor({ onBuy }) {
    this.id = 'territory';
    this.title = 'Territoire de la commune';
    this.onBuy = onBuy;
  }

  render(session) {
    const s = session.state;
    const land = landOf(s);
    const price = parcelPrice(s, EconomySystem.summarize);
    const cells = parcelMap(s);
    const afford = s.economy.treasury >= price;
    const crisis = (s.crises?.active ?? []).length > 0;
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
          disabled: c.status !== 'available' || !afford || crisis,
          dataset: { gx: String(c.gx), gy: String(c.gy) },
          on: { click: () => this.onBuy(c.gx, c.gy, price) }
        }, c.status === 'available' ? '+' : '');
      })
    );
    return h('div.territory',
      h('div.kpis',
        h('div.kpi', h('span', 'Surface de la carte'), h('strong', `${s.grid.width} × ${s.grid.height}`), h('small', `${owned} parcelle${owned > 1 ? 's' : ''} de ${PARCEL} × ${PARCEL} cases`)),
        h('div.kpi', h('span', 'Prochaine extension'), h('strong', { class: afford ? '' : 'neg' }, formatMoney(price)), h('small', `≈ ${PARCEL_MONTHS_OF_CASH / 60} h d'épargne, +30 % à chaque achat`)),
        h('div.kpi', h('span', 'Déjà investi'), h('strong', formatMoney(land.spent ?? 0)), h('small', `${land.purchases} extension${land.purchases > 1 ? 's' : ''}`))
      ),
      grid,
      h('p.hint', crisis
        ? 'Les acquisitions sont suspendues pendant une crise.'
        : 'Les parcelles marquées « + » touchent le territoire actuel. Le prix vaut environ une heure de jeu d\'épargne (60 mois de variation moyenne de la trésorerie), avec un plancher de 1,5 M€, et augmente de 30 % à chaque achat. Le terrain d\'une nouvelle parcelle prolonge le relief existant ; l\'accès autoroutier est prolongé jusqu\'au nouveau bord si besoin.'),
      h('div.territory-legend', h('span.parcel.owned'), 'Commune', h('span.parcel.available'), 'Achetable', h('span.parcel.locked'), 'Hors d\'atteinte')
    );
  }
}
