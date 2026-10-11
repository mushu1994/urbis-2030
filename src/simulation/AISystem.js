import { SIM } from './config.js';
import { computeModifiers, computeBalance, isInOutage } from './Modifiers.js';
import { isUnlocked } from '../systems/ConstructionService.js';

const MODE_DELAY_HOURS = { van: 9, cargo: 4, robot: 2.5, drone: 0.8, outside: 30 };

/**
 * Systèmes d'IA urbaine de 2030 (simulés localement, sans appel à un modèle externe) :
 *  - recherche et exploitation des technologies (coûts, ressources de calcul, incidents, effets secondaires) ;
 *  - logistique autonome : approvisionnement, dernier kilomètre par micro-hubs, robots et drones,
 *    avec gains mesurables (livraisons routières évitées, délais) et contraintes (capacité, électricité,
 *    bruit, zones de desserte autorisées, concentration des flux autour des hubs).
 */
export class AISystem {
  /**
   * @param {{catalog: import('../data/Catalog.js').Catalog, economy: import('./EconomySystem.js').EconomySystem, bus?: any}} deps
   */
  constructor({ catalog, economy, bus }) {
    this.catalog = catalog;
    this.economy = economy;
    this.bus = bus;
  }

  refreshModifiers(state) {
    state.modifiers = computeModifiers(state, this.catalog);
    state.dirty.modifiers = false;
  }

  // ───────────────────────────── Technologies ─────────────────────────────

  /** @returns {{ok:boolean, reasons:string[]}} */
  canResearch(state, techId) {
    const tech = this.catalog.techById.get(techId);
    if (!tech) return { ok: false, reasons: ['Technologie inconnue'] };
    const reasons = [];
    if (state.tech.researched[techId]) reasons.push('Déjà déployée');
    if (tech.unlock.population && (state.stats.peakPopulation ?? 0) < tech.unlock.population) {
      reasons.push(`Nécessite ${tech.unlock.population.toLocaleString('fr-FR')} habitants`);
    }
    if (tech.unlock.tech && !state.tech.researched[tech.unlock.tech]) {
      reasons.push(`Nécessite « ${this.catalog.techById.get(tech.unlock.tech).name} »`);
    }
    if (!reasons.length && !this.economy.canAfford(state, tech.costCents)) reasons.push('Budget insuffisant');
    return { ok: reasons.length === 0, reasons };
  }

  research(state, techId) {
    const check = this.canResearch(state, techId);
    if (!check.ok) return check;
    const tech = this.catalog.techById.get(techId);
    const pay = this.economy.payCapex(state, {
      amount: tech.costCents,
      category: 'technology',
      label: `Déploiement : ${tech.name}`,
      ref: techId,
      lifeYears: 8
    });
    if (!pay.ok) return { ok: false, reasons: [pay.reason] };
    state.tech.researched[techId] = state.time.tick;
    state.dirty.modifiers = true;
    this.bus?.emit('notify', { level: 'success', message: `Technologie déployée : ${tech.name}` });
    this.bus?.emit('tech:changed', { techId });
    return { ok: true, reasons: [] };
  }

  /** Abandon d'une technologie : l'exploitation cesse, l'investissement restant est déprécié. */
  decommission(state, techId) {
    if (!state.tech.researched[techId]) return { ok: false };
    delete state.tech.researched[techId];
    delete state.tech.outages[techId];
    const asset = state.economy.assets.find((a) => a.ref === techId);
    if (asset) this.economy.disposeAsset(state, asset.id);
    state.dirty.modifiers = true;
    this.bus?.emit('tech:changed', { techId });
    return { ok: true };
  }

  togglePolicy(state, policyId, on) {
    const pol = this.catalog.policyById.get(policyId);
    if (!pol) return { ok: false, reason: 'Politique inconnue' };
    if (on) {
      const u = isUnlocked(state, pol.unlock);
      if (!u.ok) return { ok: false, reason: u.reason };
      state.policies.active[policyId] = state.time.tick;
    } else {
      delete state.policies.active[policyId];
    }
    state.dirty.modifiers = true;
    this.bus?.emit('policy:changed', { policyId });
    return { ok: true };
  }

  /** Indicateurs de performance par technologie (calculés à partir de la simulation réelle). */
  techKpis(state) {
    const s = state.stats;
    const tr = state.traffic.stats ?? {};
    const lg = state.logistics.stats ?? {};
    const out = {};
    const compute = computeBalance(state, this.catalog);
    for (const tech of this.catalog.technologies) {
      if (!state.tech.researched[tech.id]) continue;
      const k = [];
      const status = isInOutage(state, tech.id) ? 'incident' : compute.ratio < 1 ? 'dégradé' : 'nominal';
      k.push({ label: 'État', value: status });
      k.push({ label: 'Efficacité (calcul)', value: `${Math.round(compute.ratio * 100)} %` });
      for (const kpi of tech.kpis ?? []) {
        if (kpi === 'congestion') k.push({ label: 'Axes saturés', value: `${tr.congestedTiles ?? 0} / ${tr.roadTiles ?? 0}` });
        if (kpi === 'commute') k.push({ label: 'Trajet domicile-travail', value: `${(tr.avgCommute ?? 0).toFixed(1)} min` });
        if (kpi === 'pollution') k.push({ label: 'Pollution moyenne', value: (s.avgPollution ?? 0).toFixed(1) });
        if (kpi === 'deliveries') {
          k.push({ label: 'Colis/jour automatisés', value: Math.round((lg.servedBy?.robot ?? 0) + (lg.servedBy?.drone ?? 0) + (lg.servedBy?.cargo ?? 0)) });
          k.push({ label: 'Tournées routières évitées/jour', value: Math.round(lg.roadTripsAvoided ?? 0) });
          k.push({ label: 'Délai moyen', value: `${(lg.avgDelayHours ?? 0).toFixed(1)} h` });
        }
        if (kpi === 'upkeepSavings') {
          const p = state.economy.periods.at(-1);
          const roads = p?.opex?.roads ?? 0;
          const m = state.modifiers['upkeep.roads'] ?? 1;
          k.push({ label: 'Économie mensuelle (voirie)', value: `${Math.round(((roads / Math.max(0.01, m)) * (1 - m)) / 100).toLocaleString('fr-FR')} €` });
        }
        if (kpi === 'waste') {
          const ws = state.waste.stats ?? {};
          k.push({ label: 'Déchets collectés', value: `${Math.round((ws.collectionRate ?? 0) * 100)} %` });
          k.push({ label: 'Capacité de collecte', value: `${Math.round(ws.collectCap ?? 0)} u./j` });
        }
        if (kpi === 'transit') {
          const ts = state.transit.stats ?? {};
          const p = ts.passengers ?? {};
          k.push({ label: 'Voyageurs en bus / jour', value: Math.round(p.bus ?? 0) });
          k.push({ label: 'Capacité des bus', value: `${Math.round(ts.capacity?.bus ?? 0)} / jour` });
          k.push({ label: 'Trajets en voiture évités / jour', value: Math.round(ts.carTripsAvoided ?? 0) });
        }
        if (kpi === 'taxes') {
          const p = state.economy.periods.at(-1);
          const tax = p ? Object.entries(p.revenue).filter(([c]) => c.startsWith('tax') || c === 'property').reduce((x, [, v]) => x + v, 0) : 0;
          const eff = state.modifiers.taxEfficiency ?? 1;
          k.push({ label: 'Recettes supplémentaires/mois', value: `${Math.round((tax - tax / eff) / 100).toLocaleString('fr-FR')} €` });
        }
      }
      out[tech.id] = k;
    }
    return out;
  }

  // ───────────────────────────── Logistique ─────────────────────────────

  updateLogistics(state) {
    const g = state.grid;
    const cat = this.catalog;
    const disabled = state.modifiers.disabledModes ?? {};
    const delayMult = state.modifiers.deliveryTimeMult ?? 1;
    const suppliers = [];
    const hubs = [];
    const demands = [];

    for (const b of state.buildings.values()) {
      const def = cat.buildingFor(b);
      b.logisticsHandled = 0;
      const lg = def.capacity.logistics;
      if (lg && !b.abandoned && b.access >= 0) {
        const staffing = def.capacity.jobs ? Math.min(1, 0.2 + (b.jobsFilled / def.capacity.jobs) * 0.8) : 1;
        const active = b.powered ? staffing : 0;
        if (lg.role === 'supply') suppliers.push({ b, cap: lg.throughput * active, left: lg.throughput * active, kind: 'warehouse' });
        if (lg.role === 'lastmile') {
          const cap = disabled[lg.mode] ? 0 : lg.capacity * active;
          hubs.push({ b, mode: lg.mode, radius: lg.radius, cap, left: cap, zoneOnly: !!lg.requiresDeliveryZone });
        }
      }
      if (def.category === 'industry' && !b.abandoned && b.access >= 0 && b.jobsFilled) {
        const goods = (b.jobsFilled / def.capacity.jobs) * def.capacity.goods * 1.5;
        suppliers.push({ b, cap: goods, left: goods, kind: 'industry' });
      }
      if (b.abandoned || b.access < 0) continue;
      let parcels = 0;
      if (def.capacity.residents) parcels = b.residents * SIM.PARCELS_PER_RESIDENT;
      else if (def.category === 'commerce') parcels = b.jobsFilled * SIM.PARCELS_PER_SALES_JOB;
      if (parcels > 0) demands.push({ b, parcels });
    }

    // Couverture « dernier kilomètre » (couche cartographique)
    g.delivery.fill(0);
    for (const h of hubs) {
      if (h.cap <= 0) continue;
      const cx = h.b.x;
      const cy = h.b.y;
      for (let y = Math.max(0, cy - h.radius); y <= Math.min(g.height - 1, cy + h.radius); y++) {
        for (let x = Math.max(0, cx - h.radius); x <= Math.min(g.width - 1, cx + h.radius); x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d > h.radius) continue;
          const i = g.idx(x, y);
          if (h.zoneOnly && !g.deliveryZone[i]) continue;
          g.delivery[i] = Math.max(g.delivery[i], 1 - d / (h.radius + 1));
        }
      }
    }

    const nearest = (list, b, filter) => {
      let best = null;
      let bd = Infinity;
      for (const s of list) {
        if (!filter(s)) continue;
        const d = Math.abs(s.b.x - b.x) + Math.abs(s.b.y - b.y);
        if (d < bd || (d === bd && s.b.id < best.b.id)) {
          bd = d;
          best = s;
        }
      }
      return { s: best, d: bd };
    };

    const routes = new Map();
    const addRoute = (fromTile, toTile, trips) => {
      if (fromTile < 0 || toTile < 0 || trips <= 0) return;
      if (!routes.has(fromTile)) routes.set(fromTile, new Map());
      const m = routes.get(fromTile);
      m.set(toTile, (m.get(toTile) ?? 0) + trips);
    };
    const entryTile = state.entries[0] ?? -1;
    const servedBy = { van: 0, cargo: 0, robot: 0, drone: 0, outside: 0 };
    let delaySum = 0;
    let total = 0;
    let avoided = 0;

    /**
     * Répartit un volume entre les fournisseurs locaux les plus proches (capacité limitée),
     * le solde étant importé depuis l'extérieur via l'accès autoroutier.
     * @returns {{from:number, amount:number, dist:number, outside:boolean}[]}
     */
    const supplyFor = (b, amount) => {
      const parts = [];
      let rest = amount;
      while (rest > 1e-9) {
        const { s, d } = nearest(suppliers, b, (x) => x.left > 1e-9);
        if (!s) break;
        const take = Math.min(rest, s.left);
        s.left -= take;
        s.b.logisticsHandled += take;
        rest -= take;
        parts.push({ from: s.b.access, amount: take, dist: d, outside: false });
      }
      if (rest > 1e-9) parts.push({ from: entryTile, amount: rest, dist: 40, outside: true });
      return parts;
    };

    for (const { b, parcels } of demands) {
      total += parcels;
      let remaining = parcels;
      const tile = g.idx(b.x, b.y);
      // 1. Dernier kilomètre automatisé (hub le plus proche disposant de capacité)
      const { s: hub, d: hd } = nearest(hubs, b, (h) => h.left > 0 && Math.hypot(h.b.x - b.x, h.b.y - b.y) <= h.radius && (!h.zoneOnly || g.deliveryZone[tile]));
      if (hub) {
        const take = Math.min(remaining, hub.left);
        hub.left -= take;
        remaining -= take;
        servedBy[hub.mode] += take;
        delaySum += take * MODE_DELAY_HOURS[hub.mode] * delayMult;
        avoided += take / SIM.PARCELS_PER_VAN_TRIP;
        hub.b.logisticsHandled += take;
        // Approvisionnement consolidé du hub (porteurs pleins). Le dernier kilomètre (vélo-cargo,
        // robot sur trottoir, drone) n'ajoute aucun flux routier, mais les camions convergent vers le hub.
        for (const src of supplyFor(hub.b, take)) {
          addRoute(src.from, hub.b.access, src.amount / (SIM.PARCELS_PER_VAN_TRIP * 2.5));
          avoided -= src.amount / (SIM.PARCELS_PER_VAN_TRIP * 2.5);
        }
        delaySum += take * hd * 0.02;
      }
      // 2. Livraison classique en camionnette
      if (remaining > 0) {
        for (const src of supplyFor(b, remaining)) {
          addRoute(src.from, b.access, src.amount / SIM.PARCELS_PER_VAN_TRIP);
          if (src.outside) {
            servedBy.outside += src.amount;
            delaySum += src.amount * (MODE_DELAY_HOURS.outside + src.dist * 0.05) * delayMult;
          } else {
            servedBy.van += src.amount;
            delaySum += src.amount * (MODE_DELAY_HOURS.van + src.dist * 0.04) * delayMult;
          }
        }
      }
    }

    for (const h of hubs) h.b.utilization = h.cap > 0 ? 1 - h.left / h.cap : 0;
    let hubPower = 0;
    for (const h of hubs) hubPower += h.b.powerNeed ?? 0;

    state.logistics.routes = [...routes.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([from, m]) => ({ from, dests: [...m.entries()].sort((a, b) => a[0] - b[0]) }));
    state.logistics.stats = {
      parcelsPerDay: total,
      servedBy,
      automatedShare: total ? (servedBy.cargo + servedBy.robot + servedBy.drone) / total : 0,
      roadTripsAvoided: Math.max(0, avoided),
      avgDelayHours: total ? delaySum / total : 0,
      hubs: hubs.length,
      hubUtilization: hubs.length ? hubs.reduce((s, h) => s + h.b.utilization, 0) / hubs.length : 0,
      hubPower,
      supplierCapacity: suppliers.filter((s) => s.kind === 'warehouse').reduce((s, x) => s + x.cap, 0),
      outsideShare: total ? servedBy.outside / total : 0
    };
  }
}
