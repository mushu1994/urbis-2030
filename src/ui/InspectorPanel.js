import { h, icon, setChildren } from './dom.js';
import { meter } from './charts.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { getTile } from '../world/Tile.js';
import { formatDate } from '../simulation/config.js';
import { growthChecks } from '../simulation/BuildingSystem.js';
import { WASTE_KIND_LABELS } from '../simulation/WasteSystem.js';
import { TRANSIT_LABELS } from '../simulation/TransitSystem.js';
import { isUnlocked } from '../systems/ConstructionService.js';
import { formatUpgradeEffect, isGoodEffect } from '../data/Upgrades.js';

const CATEGORY_LABELS = {
  residential_low: 'Résidentiel faible densité',
  residential_high: 'Résidentiel collectif',
  commerce: 'Commerce',
  offices: 'Bureaux',
  industry: 'Industrie',
  logistics: 'Entrepôts et logistique',
  energy: 'Énergie',
  water: 'Eau et assainissement',
  parks: 'Espaces verts',
  services: 'Services publics'
};
const INCOME = { low: 'modestes', mid: 'intermédiaires', high: 'aisés' };
const FACTOR_LABELS = {
  base: 'Base',
  services: 'Services publics',
  green: 'Espaces verts',
  pollution: 'Pollution',
  noise: 'Bruit',
  heat: 'Chaleur',
  power: 'Électricité',
  water: 'Eau',
  commute: 'Temps de trajet',
  unemployment: 'Chômage',
  rent: 'Loyer',
  taxes: 'Fiscalité',
  sanitation: 'Assainissement',
  delivery: 'Livraisons',
  policies: 'Politiques et IA'
};

const row = (label, value, cls = '') => h('div.kv', h('span', label), h('strong', { class: cls }, value));

/**
 * Panneau d'inspection de l'objet sélectionné (bâtiment, route, case).
 * Toutes les valeurs proviennent de la simulation.
 */
export class InspectorPanel {
  /**
   * @param {HTMLElement} root
   * @param {{onDemolish:(b:any)=>void, onUpgrade:(b:any, upgradeId:string)=>void, onFocus:(x:number,y:number)=>void, onClose:()=>void}} actions
   */
  constructor(root, actions) {
    this.root = root;
    this.actions = actions;
    this.target = null;
    // Pas de rafraîchissement automatique pendant qu'un bouton est survolé ou enfoncé :
    // sinon le bouton serait remplacé sous le doigt ou la souris et le clic perdu.
    this.pressed = false;
    root.addEventListener('pointerdown', () => (this.pressed = true));
    window.addEventListener('pointerup', () => (this.pressed = false));
    window.addEventListener('pointercancel', () => (this.pressed = false));
  }

  show(target) {
    this.target = target;
    this.root.classList.toggle('open', !!target);
  }

  get open() {
    return !!this.target;
  }

  /**
   * @param {import('../app/GameSession.js').GameSession} session
   * @param {{force?:boolean}} [opts] force : redessiner même si un bouton est survolé (après une action)
   */
  update(session, { force = false } = {}) {
    if (!this.target) return;
    if (!force && (this.pressed || this.root.querySelector(':is(button, input, select, label):hover'))) return;
    const state = session.state;
    const t = this.target;
    let content;
    if (t.buildingId) {
      const b = state.buildings.get(t.buildingId);
      if (!b) {
        this.show(null);
        this.actions.onClose();
        return;
      }
      content = this.#building(session, b);
    } else {
      content = this.#tile(session, t.x, t.y);
    }
    setChildren(
      this.root,
      h('button.panel-close', { 'aria-label': 'Fermer', on: { click: () => this.actions.onClose() } }, icon('close', 16)),
      content
    );
  }

  #building(session, b) {
    const state = session.state;
    const def = session.catalog.buildingFor(b);
    const g = state.grid;
    const i = g.idx(b.x, b.y);
    const blocks = [];
    const halted = b.disabledUntil > state.time.tick;
    const status = b.abandoned
      ? ['Abandonné', 'neg']
      : halted
        ? [`À l'arrêt jusqu'au ${formatDate(b.disabledUntil)}`, 'neg']
        : !b.powered
          ? ['Sans électricité', 'neg']
          : !b.watered
            ? ['Sans eau', 'warn']
            : ['En activité', 'pos'];
    blocks.push(
      h('header.insp-head', h('h2', def.name), h('p', `${CATEGORY_LABELS[def.category] ?? def.category}${def.level ? ` · niveau ${def.level}` : ''} · ${b.w}×${b.h}`)),
      h('div.insp-status', { class: status[1] }, status[0])
    );

    if (def.capacity.residents) {
      const sat = session.sim.population.satisfactionFactors(state, b, def);
      blocks.push(
        h('section', h('h3', 'Ménages'),
          row('Habitants', `${b.residents} / ${def.capacity.residents}`),
          meter(b.residents / def.capacity.residents, { color: 'var(--zone-r)' }),
          row('Revenus', INCOME[b.incomeClass] ?? '—'),
          row('Âges', b.ages ? `${b.ages.young} jeunes · ${b.ages.adult} actifs · ${b.ages.senior} seniors` : '—'),
          row('Actifs occupés', `${b.employed} / ${b.workforce}`),
          row('Qualification', `${Math.round((b.qualification ?? 0) * 100)} %`),
          row('Loyer moyen', `${formatNumber(b.rent, 0)} €/mois`),
          row('Trajet domicile-travail', `${b.commute.toFixed(0)} min`),
          b.transit ? row('Trajets en transports en commun', `${Math.round((b.transit.bus + b.transit.metro + (b.transit.rail ?? 0)) * 100)} %`) : null,
          b.transit?.regional ? row('Trajets vers la région en train', `${Math.round(b.transit.regional * 100)} %`) : null
        ),
        h('section', h('h3', `Satisfaction : ${Math.round(b.satisfaction)} / 100`),
          meter(b.satisfaction / 100, { color: b.satisfaction > 60 ? 'var(--ok)' : b.satisfaction > 35 ? 'var(--warn)' : 'var(--bad)' }),
          h('div.factors', Object.entries(sat.factors).filter(([k, v]) => k !== 'base' && Math.abs(v) >= 0.5).sort((a, z) => z[1] - a[1]).map(([k, v]) =>
            h('div.factor', h('span', FACTOR_LABELS[k] ?? k), h('strong', { class: v >= 0 ? 'pos' : 'neg' }, `${v > 0 ? '+' : ''}${v.toFixed(1)}`))
          ))
        )
      );
    }
    if (def.capacity.jobs) {
      blocks.push(h('section', h('h3', 'Emploi'),
        row('Postes pourvus', `${b.jobsFilled} / ${def.capacity.jobs}`),
        meter(b.jobsFilled / def.capacity.jobs, { color: 'var(--zone-o)' }),
        row('Qualification requise', `${Math.round(def.capacity.qualification * 100)} %`)
      ));
    }
    const cap = def.capacity;
    const prod = [];
    if (cap.powerOutput) prod.push(row('Production électrique', `${Math.round(b.output ?? 0)} / ${cap.powerOutput} u.`));
    if (cap.powerStorage) prod.push(row('Stock', `${Math.round(b.charge ?? 0)} / ${cap.powerStorage} u.`));
    if (cap.waterOutput) prod.push(row('Production d\'eau', `${cap.waterOutput} u.`));
    if (cap.sewageTreatment) prod.push(row('Capacité d\'épuration', `${cap.sewageTreatment} u.`));
    if (cap.compute) prod.push(row('Puissance de calcul', `${cap.compute} u.`));
    if (cap.service) prod.push(row('Rayon d\'action', `${cap.service.radius} cases`));
    if (cap.logistics) {
      prod.push(row('Colis traités / jour', formatNumber(b.logisticsHandled ?? 0, 0)));
      if (cap.logistics.capacity) prod.push(row('Taux d\'utilisation', `${Math.round((b.utilization ?? 0) * 100)} %`), row('Rayon de desserte', `${cap.logistics.radius} cases`));
      if (cap.logistics.requiresDeliveryZone) prod.push(h('p.hint', 'Ne dessert que les zones de desserte autorisées (outil Logistique).'));
    }
    if (cap.goods) prod.push(row('Production de biens', `${Math.round((b.jobsFilled / cap.jobs) * cap.goods)} / ${cap.goods}`));
    if (cap.waste) {
      const w = cap.waste;
      if (w.collect) prod.push(row('Collecte', `${w.collect} u./jour · rayon ${w.collectRadius} cases`));
      if (w.process) prod.push(row(`Traitement (${WASTE_KIND_LABELS[w.kind] ?? w.kind})`, `${formatNumber(b.wasteProcessed ?? 0, 0)} / ${w.process} u./jour`));
      if (w.storage) {
        const used = b.landfillUsed ?? 0;
        prod.push(row('Remplissage', `${Math.round((used / w.storage) * 100)} %`, used >= w.storage ? 'neg' : used > 0.8 * w.storage ? 'warn' : ''));
        prod.push(meter(used / w.storage, { color: used > 0.8 * w.storage ? 'var(--bad)' : 'var(--warn)' }));
      }
      if (w.powerPerUnit) prod.push(row('Électricité produite', `${formatNumber(b.output ?? 0, 0)} u.`));
    }
    if (cap.transit) {
      const tr = cap.transit;
      const ts = state.transit.stats ?? {};
      prod.push(row('Mode', TRANSIT_LABELS[tr.mode]));
      if (tr.radius) prod.push(row('Rayon desservi', `${tr.radius} cases`));
      if (tr.capacity) prod.push(row('Capacité', `${formatNumber(tr.capacity)} voyageurs/jour`));
      if (!tr.depot) prod.push(row('Voyageurs de cet équipement', `${formatNumber(b.transitPassengers ?? 0, 0)} / jour`, (b.transitPassengers ?? 0) > 0 ? 'pos' : ''));
      prod.push(row('Voyageurs du réseau', `${formatNumber(ts.passengers?.[tr.mode] ?? 0, 0)} / jour`));
      if (tr.mode === 'rail') {
        prod.push(row('Dont navetteurs venus de la région', `${formatNumber(ts.railInbound ?? 0, 0)} / jour`));
        prod.push(h('p.hint', (ts.railStations ?? 0) >= 2
          ? 'Plusieurs gares : le train assure aussi des trajets internes à la ville.'
          : 'Une seconde gare permettrait aussi des trajets internes à la ville.'));
      }
      if (!b.transitActive) {
        const why = tr.mode === 'bus' && !tr.depot ? 'Aucun dépôt de bus relié par la route' : tr.mode === 'metro' ? 'Il faut au moins deux stations alimentées' : 'Hors service (électricité, accès ou personnel)';
        prod.push(h('p.hint.neg', why));
      }
    }
    if (def.risk) prod.push(row('Risque d\'arrêt d\'urgence', `${(def.risk.monthlyChance * 100).toFixed(1)} % par mois`));
    if (prod.length) blocks.push(h('section', h('h3', 'Capacités'), prod));
    // Améliorations : juste après les capacités qu'elles modifient
    const ups = session.catalog.upgradesFor(b.defId);
    if (ups.length) blocks.push(this.#upgrades(session, b, ups));

    const net = [];
    if (def.networks.power) net.push(row('Électricité', b.powered ? `raccordé (${Math.round(b.powerNeed ?? 0)} u.)` : 'non alimenté', b.powered ? 'pos' : 'neg'));
    if (def.networks.water) net.push(row('Eau', b.watered ? `raccordé (${Math.round(b.waterNeed ?? 0)} u.)` : 'non desservi', b.watered ? 'pos' : 'neg'));
    net.push(row('Accès routier', b.access >= 0 ? (session.sim.network.isConnectedToOutside(b.access) ? 'relié à l\'autoroute' : 'réseau isolé') : 'aucun', b.access >= 0 ? '' : 'neg'));
    if (b.access >= 0) {
      const r = session.sim.routes.routeToHighway(state, b.access);
      net.push(r.ok ? row('Trajet jusqu\'à l\'autoroute', `${r.minutes.toFixed(1)} min · ${r.km.toFixed(1)} km`) : h('p.hint.neg', r.reason));
    }
    blocks.push(h('section', h('h3', 'Raccordements'), net));

    blocks.push(h('section', h('h3', 'Environnement'),
      row('Valeur foncière', formatNumber(g.landValue[i], 0)),
      row('Pollution', formatNumber(g.pollution[i], 1)),
      row('Bruit', formatNumber(g.noise[i], 1)),
      b.wasteCollectedRatio !== undefined && (b.residents || b.jobsFilled)
        ? row('Déchets collectés', `${Math.round(b.wasteCollectedRatio * 100)} %`, b.wasteCollectedRatio < 0.85 ? 'neg' : 'pos')
        : null
    ));

    // Évolution vers le niveau suivant : conditions de satisfaction et de besoins
    if (def.kind === 'growable') {
      if (def.growth.next) {
        const next = session.catalog.building(def.growth.next);
        const checks = growthChecks(state, b, def);
        const done = checks.filter((c) => c.ok).length;
        blocks.push(h('section', h('h3', `Prochain niveau : ${next.name}`),
          h('p.small', `${done} condition${done > 1 ? 's' : ''} remplie${done > 1 ? 's' : ''} sur ${checks.length}${b.counters?.upgrade ? ` · stable depuis ${b.counters.upgrade} j` : ''}`),
          h('ul.checks', checks.map((c) => h('li', { class: c.ok ? 'ok' : 'ko' }, h('span', c.ok ? '✓' : '✗'), h('span', c.label), c.detail ? h('small', c.detail) : null)))
        ));
      } else {
        blocks.push(h('section', h('h3', 'Évolution'), h('p.small', `Niveau maximal atteint (${def.level}).`)));
      }
    }

    if (def.kind === 'plop') {
      blocks.push(h('section', h('h3', 'Finances'),
        row('Coût de construction', formatMoney(def.costCents)),
        row('Entretien', `${formatMoney(def.upkeepCents)} / mois`),
        def.revenue.perMonthCents ? row('Recettes', `${formatMoney(def.revenue.perMonthCents)} / mois`) : null,
        row('Mis en service', formatDate(b.builtTick))
      ));
    }
    const demolishCost = session.construction.demolitionCost(b);
    blocks.push(h('div.insp-actions',
      h('button.btn', { on: { click: () => this.actions.onFocus(b.x, b.y) } }, icon('focus', 15), 'Centrer'),
      h('button.btn.danger', { on: { click: () => this.actions.onDemolish(b) } }, icon('demolish', 15), `Démolir (${formatMoney(demolishCost)})`)
    ));
    return blocks;
  }

  /** Améliorations disponibles et installées pour cet équipement. */
  #upgrades(session, b, ups) {
    const state = session.state;
    const installed = new Set(b.upgrades ?? []);
    return h('section.upgrades',
      h('h3', 'Améliorations', h('small', ` ${installed.size} / ${ups.length}`)),
      h('ul.upgrade-list', ups.map((up) => {
        const has = installed.has(up.id);
        const unlock = isUnlocked(state, up.unlock);
        const pv = has ? null : session.preview({ type: 'upgrade', buildingId: b.id, upgradeId: up.id });
        return h('li.upgrade', { class: has ? 'installed' : !unlock.ok ? 'locked' : '' },
          h('div.up-head',
            h('strong', up.name),
            has ? h('span.up-state.pos', '✓ Installée') : null
          ),
          h('p.up-desc', up.description),
          h('ul.up-effects', Object.entries(up.effects).map(([k, v]) => h('li', { class: isGoodEffect(k, v) ? 'pos' : 'neg' }, formatUpgradeEffect(k, v)))),
          has
            ? h('p.up-cost', `Entretien : ${formatMoney(up.upkeepCents)} / mois`)
            : h('div.up-buy',
                h('span.up-cost', `${formatMoney(up.costCents)} · ${formatMoney(up.upkeepCents)} / mois`),
                h('button.btn.primary.compact', {
                  disabled: !pv.ok,
                  title: pv.ok ? '' : pv.messages.join(' · '),
                  on: { click: () => this.actions.onUpgrade(b, up.id) }
                }, pv.ok ? 'Installer' : !unlock.ok ? unlock.reason : pv.messages[0])
              )
        );
      }))
    );
  }

  #tile(session, x, y) {
    const state = session.state;
    const t = getTile(state, x, y);
    if (!t) return h('p', 'Hors de la carte');
    const blocks = [];
    const zone = t.occupation.zone ? session.catalog.zoneByCode.get(t.occupation.zone)?.name : null;
    if (t.occupation.type === 'road') {
      const seg = session.sim.network.segment(state, t.id);
      blocks.push(h('header.insp-head', h('h2', seg?.name ?? 'Route'), h('p', `Case ${x}, ${y} · altitude ${t.altitude}`)));
      if (seg) {
        blocks.push(h('section', h('h3', 'Circulation'),
          row('Trafic journalier', `${formatNumber(seg.flow, 0)} véh./j`),
          row('Capacité', `${formatNumber(seg.capacity, 0)} véh./j`),
          row('Taux de charge', `${Math.round(seg.congestion * 100)} %`, seg.congestion > 1 ? 'neg' : seg.congestion > 0.7 ? 'warn' : 'pos'),
          meter(seg.congestion, { color: seg.congestion > 1 ? 'var(--bad)' : seg.congestion > 0.7 ? 'var(--warn)' : 'var(--ok)' }),
          row('Vitesse de référence', `${seg.speedKmh} km/h`),
          row('Entretien', `${formatMoney(seg.upkeepCents)} / mois`),
          row('Liaison régionale', seg.connectedToOutside ? 'oui' : 'non (réseau isolé)', seg.connectedToOutside ? 'pos' : 'neg'),
          seg.bridge ? row('Ouvrage', `pont, tablier au niveau ${seg.deckAltitude}`) : null,
          row('Temps depuis l\'autoroute', t.connections && state.grid.accessibility[t.id] < 900 ? `${state.grid.accessibility[t.id].toFixed(1)} min` : '—')
        ));
      }
    } else {
      blocks.push(h('header.insp-head', h('h2', zone ? `Parcelle : ${zone}` : t.terrainLabel), h('p', `Case ${x}, ${y} · ${t.terrainLabel} · altitude ${t.altitude}`)));
      if (zone) {
        const reach = t.connections.roadDistance <= 3;
        const powered = reach && state.grid.powered[t.connections.nearestRoad];
        blocks.push(h('section', h('h3', 'Constructibilité'),
          row('Route à proximité', reach ? `${t.connections.roadDistance} case(s)` : 'trop loin', reach ? 'pos' : 'neg'),
          row('Électricité disponible', powered ? 'oui' : 'non', powered ? 'pos' : 'neg'),
          !reach || !powered ? h('p.hint', 'Une parcelle se construit si une route alimentée et reliée à l\'autoroute passe à 3 cases au plus.') : null
        ));
      }
    }
    blocks.push(h('section', h('h3', 'Case'),
      row('Valeur foncière', formatNumber(t.landValue, 0)),
      row('Pollution', formatNumber(t.environment.pollution, 1)),
      row('Bruit', formatNumber(t.environment.noise, 1)),
      row('Chaleur', formatNumber(t.environment.heat, 1)),
      row('Végétation', formatNumber(t.environment.green, 1)),
      row('Desserte drones', t.deliveryZone ? 'autorisée' : 'non'),
      row('Collecte des déchets', `${Math.round(state.grid.wasteCover[t.id] * 100)} %`),
      row('Transports en commun', `${Math.round(Math.max(state.grid.transitBus[t.id], state.grid.transitMetro[t.id], state.grid.transitRail[t.id]) * 100)} %`)
    ));
    blocks.push(h('section', h('h3', 'Couverture des services'),
      row('Police', `${Math.round(t.services.police * 100)} %`),
      row('Secours', `${Math.round(t.services.fire * 100)} %`),
      row('Santé', `${Math.round(t.services.health * 100)} %`),
      row('Éducation', `${Math.round(t.services.education * 100)} %`)
    ));
    return blocks;
  }
}
