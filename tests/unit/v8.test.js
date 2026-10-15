import { describe, it, expect } from 'vitest';
import { flatSession, spawn } from '../helpers/session.js';
import { computeLinePath, lineTiming, serviceQuality, LINE_MODES } from '../../src/simulation/LineSystem.js';
import { districtList, districtKeyAt, localTax, effectiveTaxes, districtGrowthFactor, districtName, TAX_DELTA_MAX } from '../../src/simulation/Districts.js';
import { loanSchedule, loanPreview, LOAN_TYPES } from '../../src/simulation/EconomySystem.js';
import { spotPrice, tradeValue, contractOffer, marketPrice, MARKET_EVENTS, defaultMarket } from '../../src/simulation/MarketSystem.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { GameSession } from '../../src/app/GameSession.js';
import { checkInvariants } from '../../src/debug/Invariants.js';

/** Rue sur la ligne 15 (reliée à l'autoroute), logements au nord, bureaux au sud. */
function corridor(s, { road = 'road_street' } = {}) {
  s.execute({ type: 'road', roadId: road, from: { x: 3, y: 15 }, to: { x: 26, y: 15 } });
  s.sim.attach(s.state);
  const g = s.state.grid;
  const homes = [];
  for (let x = 4; x <= 24; x += 2) homes.push(spawn(s, 'res_high_2', x, 14, { residents: 60, employed: 30, workforce: 32, access: g.idx(x, 15) }));
  for (let x = 5; x <= 23; x += 2) spawn(s, 'off_2', x, 16, { jobsFilled: 30, access: g.idx(x, 15) });
  s.state.stats.employed = 330;
  s.state.stats.commutersOut = 60;
  s.state.stats.population = homes.length * 60;
  return homes;
}

const stop = (s, defId, x) => spawn(s, defId, x, 13, { access: s.state.grid.idx(x, 15), powered: true });

describe('Lignes de bus tracées (v0.8)', () => {
  it('une ligne relie ses arrêts en boucle par la route', () => {
    const s = flatSession();
    corridor(s);
    const a = stop(s, 'bus_stop', 6);
    const b = stop(s, 'bus_stop', 20);
    const r = computeLinePath(s.state, s.catalog, 'bus', [a.id, b.id]);
    expect(r.ok).toBe(true);
    // Aller (6 → 20) puis retour (20 → 6) : 14 cases dans chaque sens
    expect(r.length).toBe(28);
    expect(r.stopAt).toEqual([0, 14]);
    expect(r.path[r.stopAt[1]]).toBe(s.state.grid.idx(20, 15));
  });

  it('l\'aperçu exige au moins deux arrêts du bon type', () => {
    const s = flatSession();
    corridor(s);
    const a = stop(s, 'bus_stop', 6);
    const m = spawn(s, 'metro_station', 12, 13, { access: s.state.grid.idx(12, 15) });
    expect(s.preview({ type: 'line', mode: 'bus', stops: [a.id] }).ok).toBe(false);
    expect(s.preview({ type: 'line', mode: 'bus', stops: [a.id, m.id] }).ok).toBe(false);
    expect(s.preview({ type: 'line', mode: 'bus', stops: [a.id, a.id] }).ok).toBe(false);
  });

  it('les arrêts d\'une ligne suivent sa fréquence, les autres restent sur le réseau de base ; la fréquentation suit la flotte', () => {
    const s = flatSession();
    const homes = corridor(s);
    const g = s.state.grid;
    spawn(s, 'bus_depot', 26, 16, { access: s.state.grid.idx(26, 15), jobsFilled: 20, powered: true });
    const a = stop(s, 'bus_stop', 6);
    const b = stop(s, 'bus_stop', 14);
    const off = stop(s, 'bus_stop', 22);
    s.sim.transit.update(s.state);
    expect(s.state.transit.stats.busNetwork).toBe('auto');
    expect(off.transitActive).toBe(true);
    const autoCover = g.transitBus[g.idx(22, 13)];

    const r = s.execute({ type: 'line', mode: 'bus', stops: [a.id, b.id], vehicles: 1 });
    expect(r.ok).toBe(true);
    s.sim.lines.validate(s.state);
    s.sim.transit.update(s.state);
    const ts = s.state.transit.stats;
    expect(ts.busNetwork).toBe('mixed');
    expect(ts.baseStops).toBe(1);
    // L'arrêt hors ligne reste desservi, mais moins bien (réseau de base)
    expect(off.transitActive).toBe(true);
    expect(g.transitBus[g.idx(22, 13)]).toBeLessThan(autoCover);
    expect(a.transitActive && b.transitActive).toBe(true);
    const line = s.state.lines.list[0];
    expect(line.stats.headway).toBeGreaterThan(0);
    expect(line.stats.passengers).toBeGreaterThan(0);
    expect(line.stats.passengers).toBeLessThanOrEqual(line.stats.capacity);
    const nearA = homes.find((h) => h.x === 6);
    const share1 = nearA.transit.bus;
    expect(share1).toBeGreaterThan(0);
    // Plus de bus : passages plus fréquents, meilleure desserte et plus de capacité
    const h1 = line.stats.headway;
    const cap1 = line.stats.capacity;
    expect(s.execute({ type: 'line', op: 'update', id: line.id, vehicles: 6 }).ok).toBe(true);
    s.sim.transit.update(s.state);
    expect(line.stats.headway).toBeLessThan(h1);
    expect(line.stats.capacity).toBeGreaterThan(cap1);
    expect(nearA.transit.bus).toBeGreaterThan(share1);
    expect(checkInvariants(s.state, s.catalog)).toEqual([]);
  });

  it('sans dépôt, la ligne ne circule pas ; les dépôts limitent la flotte', () => {
    const s = flatSession();
    corridor(s);
    const a = stop(s, 'bus_stop', 6);
    const b = stop(s, 'bus_stop', 14);
    const c = stop(s, 'bus_stop', 22);
    s.execute({ type: 'line', mode: 'bus', stops: [a.id, b.id], vehicles: 10 });
    s.execute({ type: 'line', mode: 'bus', stops: [b.id, c.id], vehicles: 18 });
    s.sim.transit.update(s.state);
    const [l1, l2] = s.state.lines.list;
    expect(l1.stats.issue).toMatch(/dépôt/);
    expect(l1.stats.passengers).toBe(0);
    spawn(s, 'bus_depot', 26, 16, { access: s.state.grid.idx(26, 15), jobsFilled: 20, powered: true });
    s.sim.transit.update(s.state);
    // 28 véhicules demandés pour 14 places
    expect(l1.stats.effVehicles + l2.stats.effVehicles).toBeCloseTo(LINE_MODES.bus.depotSlots, 1);
    expect(l2.stats.issue).toMatch(/Flotte limitée/);
  });

  it('la flotte est facturée chaque mois', () => {
    const s = flatSession();
    corridor(s);
    const a = stop(s, 'bus_stop', 6);
    const b = stop(s, 'bus_stop', 14);
    s.execute({ type: 'line', mode: 'bus', stops: [a.id, b.id], vehicles: 4 });
    const p = s.sim.economy.closeMonth(s.state);
    expect(p.opex.fleet).toBe(Math.round(4 * LINE_MODES.bus.vehicleCost * 100 * (s.state.modifiers['upkeep.transport'] ?? 1)));
  });

  it('intervalle et qualité de desserte', () => {
    const { headway } = lineTiming('bus', 40, 4, 4);
    expect(headway).toBeGreaterThan(3);
    expect(serviceQuality(6)).toBeCloseTo(1, 5);
    expect(serviceQuality(60)).toBe(0.3);
    expect(serviceQuality(2)).toBe(1.1);
  });
});

describe('Tramway (v0.8)', () => {
  it('la ligne pose des rails payants, roule avec un dépôt et dessert les habitants', () => {
    const s = flatSession();
    const homes = corridor(s);
    const g = s.state.grid;
    const a = stop(s, 'tram_stop', 6);
    const b = stop(s, 'tram_stop', 20);
    const pv = s.preview({ type: 'line', mode: 'tram', stops: [a.id, b.id] });
    expect(pv.ok).toBe(true);
    expect(pv.newTracks).toBe(15);
    expect(pv.cost).toBe(15 * LINE_MODES.tram.trackCost * 100);
    const before = s.state.economy.treasury;
    expect(s.execute({ type: 'line', mode: 'tram', stops: [a.id, b.id] }).ok).toBe(true);
    expect(before - s.state.economy.treasury).toBe(pv.cost);
    expect(g.tram[g.idx(10, 15)]).toBe(1);
    s.sim.transit.update(s.state);
    expect(s.state.lines.list[0].stats.issue).toMatch(/dépôt de tramway/);
    spawn(s, 'tram_depot', 24, 16, { access: g.idx(24, 15), jobsFilled: 30, powered: true });
    s.sim.transit.update(s.state);
    const ts = s.state.transit.stats;
    expect(ts.passengers.tram).toBeGreaterThan(0);
    expect(homes.find((h) => h.x === 6).transit.tram).toBeGreaterThan(0.05);
    expect(g.transitTram[g.idx(6, 14)]).toBeGreaterThan(0.5);
    // Une deuxième ligne sur les mêmes rails ne repaie pas la voie
    const c = stop(s, 'tram_stop', 12);
    expect(s.preview({ type: 'line', mode: 'tram', stops: [a.id, c.id] }).newTracks).toBe(0);
  });

  it('pas de tramway sur l\'accès autoroutier', () => {
    const s = flatSession();
    corridor(s);
    const g = s.state.grid;
    const a = stop(s, 'tram_stop', 6);
    const hw = spawn(s, 'tram_stop', 1, 13, { access: g.idx(1, 15), powered: true });
    const pv = s.preview({ type: 'line', mode: 'tram', stops: [a.id, hw.id] });
    expect(pv.ok).toBe(false);
  });

  it('démolir la rue coupe la ligne ; supprimer la ligne retire les rails inutilisés', () => {
    const s = flatSession();
    corridor(s);
    const g = s.state.grid;
    const a = stop(s, 'tram_stop', 6);
    const b = stop(s, 'tram_stop', 20);
    s.execute({ type: 'line', mode: 'tram', stops: [a.id, b.id] });
    const line = s.state.lines.list[0];
    s.execute({ type: 'demolish', rect: { x0: 12, y0: 15, x1: 12, y1: 15 }, filter: 'roads' });
    expect(g.tram[g.idx(12, 15)]).toBe(0);
    s.sim.lines.validate(s.state);
    expect(line.status).toBe('broken');
    s.execute({ type: 'undo' });
    expect(g.tram[g.idx(12, 15)]).toBe(1);
    s.sim.lines.validate(s.state);
    expect(line.status).toBe('ok');
    expect(s.execute({ type: 'line', op: 'remove', id: line.id }).ok).toBe(true);
    expect(g.tram[g.idx(10, 15)]).toBe(0);
    expect(s.state.lines.list.length).toBe(0);
  });

  it('les lignes et les rails survivent à la sauvegarde', () => {
    const s = flatSession();
    corridor(s);
    const a = stop(s, 'tram_stop', 6);
    const b = stop(s, 'tram_stop', 20);
    s.execute({ type: 'line', mode: 'tram', stops: [a.id, b.id], name: 'T1' });
    const data = JSON.parse(JSON.stringify(serializeState(s.state)));
    const st = deserializeState(data);
    expect(st.lines.list[0].name).toBe('T1');
    expect(st.grid.tram[st.grid.idx(10, 15)]).toBe(1);
    // Ancienne sauvegarde sans lignes ni rails de tramway
    delete data.lines;
    delete data.world.layers.tram;
    delete data.market;
    delete data.districts;
    const old = deserializeState(data);
    expect(old.lines.list).toEqual([]);
    expect(old.grid.tram[old.grid.idx(10, 15)]).toBe(0);
    const s2 = new GameSession({ catalog: s.catalog, state: old });
    s2.run(35);
    expect(old.market.prices).toBeTruthy();
  });
});

describe('Fiscalité par quartier (v0.8)', () => {
  /** Carte 64 × 64 : quatre quartiers ; logements dans le quartier nord-ouest et dans le quartier nord-est. */
  function twoDistricts() {
    const s = flatSession({ width: 64, height: 64, row: 15 });
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 60, y: 15 } });
    s.sim.attach(s.state);
    const g = s.state.grid;
    const west = [];
    const east = [];
    for (let x = 6; x <= 24; x += 2) west.push(spawn(s, 'res_high_2', x, 14, { residents: 60, employed: 30, workforce: 32, access: g.idx(x, 15), powered: true, watered: true }));
    for (let x = 38; x <= 56; x += 2) east.push(spawn(s, 'res_high_2', x, 14, { residents: 60, employed: 30, workforce: 32, access: g.idx(x, 15), powered: true, watered: true }));
    return { s, west, east, wKey: districtKeyAt(s.state, 6, 14), eKey: districtKeyAt(s.state, 40, 14) };
  }

  it('les quartiers de la commune ont des noms stables, la mairie fait le centre-ville', () => {
    const { s, wKey, eKey } = twoDistricts();
    const list = districtList(s.state);
    expect(list.length).toBe(4);
    expect(new Set(list.map((d) => d.name)).size).toBe(4);
    spawn(s, 'city_hall', 44, 20, { access: s.state.grid.idx(44, 15) });
    expect(districtName(s.state, eKey)).toBe('Centre-ville');
    expect(districtName(s.state, wKey)).not.toBe('Centre-ville');
    expect(s.execute({ type: 'districtName', key: wKey, name: 'Les Docks' }).ok).toBe(true);
    expect(districtName(s.state, wKey)).toBe('Les Docks');
  });

  it('écart de taux borné, réservé aux quartiers de la commune', () => {
    const { s, wKey } = twoDistricts();
    expect(s.execute({ type: 'districtTax', key: wKey, sector: 'R', value: 12 }).value).toBe(TAX_DELTA_MAX);
    expect(s.execute({ type: 'districtTax', key: wKey, sector: 'X', value: 1 }).ok).toBe(false);
    expect(s.execute({ type: 'districtTax', key: '0,0', sector: 'R', value: 1 }).ok).toBe(false);
    expect(localTax(s.state, 6, 14, 'R')).toBe(s.state.economy.taxes.R + TAX_DELTA_MAX);
    expect(localTax(s.state, 40, 14, 'R')).toBe(s.state.economy.taxes.R);
  });

  it('le quartier taxé rapporte plus, ses habitants sont moins satisfaits et il attire moins de constructions', () => {
    const { s, west, east, wKey } = twoDistricts();
    const eco = s.sim.economy;
    eco.accrueDaily(s.state);
    const base = eco.closeMonth(s.state).revenue.taxR;
    s.execute({ type: 'districtTax', key: wKey, sector: 'R', value: 4 });
    eco.accrueDaily(s.state);
    const taxed = eco.closeMonth(s.state).revenue.taxR;
    // La moitié de la base est imposée à 13 % au lieu de 9 %
    expect(taxed / base).toBeCloseTo((9 + 13) / 18, 2);
    const def = s.catalog.building('res_high_2');
    const sw = s.sim.population.satisfactionFactors(s.state, west[0], def);
    const se = s.sim.population.satisfactionFactors(s.state, east[0], def);
    expect(sw.factors.taxes).toBeLessThan(se.factors.taxes);
    expect(districtGrowthFactor(s.state, 6, 14, 'R')).toBeLessThan(1);
    expect(districtGrowthFactor(s.state, 40, 14, 'R')).toBe(1);
    expect(effectiveTaxes(s.state).R).toBeCloseTo(11, 0);
  });
});

describe('Emprunts par échéances (v0.8)', () => {
  const P = 120_000_00;
  const loan = (type) => ({ type, principal: P, remaining: P, rateAnnual: 0.04, months: 120, monthsLeft: 120, payment: 0 });

  it('chaque profil rembourse tout le capital', () => {
    for (const type of Object.keys(LOAN_TYPES)) {
      const l = loan(type);
      if (type === 'annuity') l.payment = loanPreview(P, 0.04, 120, 'annuity').first;
      const sched = loanSchedule(l);
      expect(sched.reduce((a, x) => a + x.principal, 0)).toBe(P);
      expect(sched.at(-1).remaining).toBe(0);
    }
  });

  it('amortissement constant : échéances dégressives, moins d\'intérêts ; in fine : capital à la fin', () => {
    const ann = loanPreview(P, 0.04, 120, 'annuity');
    const lin = loanPreview(P, 0.04, 120, 'linear');
    const bul = loanPreview(P, 0.04, 120, 'bullet');
    expect(lin.first).toBeGreaterThan(lin.last);
    expect(lin.interest).toBeLessThan(ann.interest);
    expect(bul.interest).toBeGreaterThan(ann.interest);
    expect(bul.first).toBeLessThan(ann.first);
    expect(bul.last).toBeGreaterThan(P);
  });

  it('souscription selon le profil, remboursement anticipé avec indemnité', () => {
    const s = flatSession();
    s.state.economy.treasury = 0;
    s.state.economy.opening = 0;
    const annuityRate = s.sim.economy.loanRate(s.state, 'annuity');
    const r = s.execute({ type: 'loan', amountEuros: 100000, months: 60, loanType: 'bullet' });
    expect(r.ok).toBe(true);
    expect(r.loan.type).toBe('bullet');
    expect(r.loan.rateAnnual).toBeCloseTo(annuityRate + LOAN_TYPES.bullet.spread, 4);
    s.sim.economy.closeMonth(s.state);
    expect(s.state.economy.loans[0].remaining).toBe(100000_00);
    const penalty = s.sim.economy.prepaymentPenalty(s.state.economy.loans[0], 40000_00);
    expect(penalty).toBe(Math.round(Math.min(40000_00 * r.loan.rateAnnual / 2, 40000_00 * 0.03)));
    expect(s.execute({ type: 'repayLoan', loanId: r.loan.id, amountEuros: 40000 }).ok).toBe(true);
    expect(s.state.economy.loans[0].remaining).toBe(60000_00);
    expect(s.execute({ type: 'repayLoan', loanId: r.loan.id }).ok).toBe(false); // trésorerie insuffisante
    expect(s.execute({ type: 'loan', amountEuros: 1000, months: 7 }).ok).toBe(false);
    expect(checkInvariants(s.state, s.catalog)).toEqual([]);
  });
});

describe('Marché régional à prix variables (v0.8)', () => {
  it('saisons : électricité chère en hiver, eau chère en été', () => {
    const M = defaultMarket();
    expect(spotPrice(M, 'power', 'buy', 0)).toBeGreaterThan(spotPrice(M, 'power', 'buy', 4));
    expect(spotPrice(M, 'water', 'buy', 6)).toBeGreaterThan(spotPrice(M, 'water', 'buy', 0));
    M.event = { kind: 'coldwave', since: 0, until: 2 };
    expect(spotPrice(M, 'power', 'buy', 0)).toBeCloseTo(defaultMarketPrice('power', 0) * MARKET_EVENTS.coldwave.mult, 2);
  });

  it('profondeur du marché : vendre beaucoup rapporte de moins en moins', () => {
    const one = tradeValue('power', 'sell', 1000, 0.3);
    const ten = tradeValue('power', 'sell', 10000, 0.3);
    expect(ten).toBeLessThan(10 * one);
    expect(tradeValue('power', 'buy', 10000, 3) / 10000).toBeGreaterThan(3);
  });

  it('les cours évoluent chaque mois, restent bornés et sont déterministes', () => {
    const run = () => {
      const s = flatSession();
      for (let m = 0; m < 36; m++) {
        s.state.time.tick += 30;
        s.sim.market.monthly(s.state);
      }
      return s.state.market;
    };
    const a = run();
    const b = run();
    expect(a.history.length).toBe(36);
    expect(a.history).toEqual(b.history);
    const idx = Object.values(a.index);
    expect(Math.min(...idx)).toBeGreaterThanOrEqual(0.7);
    expect(Math.max(...idx)).toBeLessThanOrEqual(1.4);
    expect(new Set(a.history.map((h) => h.power.buy)).size).toBeGreaterThan(5);
  });

  it('contrat à prix fixe : prix bloqué douze mois, indemnité en cas de résiliation', () => {
    const s = flatSession();
    s.sim.market.ensure(s.state);
    const offer = contractOffer(s.state, 'power', 'buy');
    expect(s.execute({ type: 'contract', good: 'power', side: 'buy', enabled: true }).ok).toBe(true);
    expect(s.execute({ type: 'contract', good: 'power', side: 'buy', enabled: true }).ok).toBe(false);
    for (let m = 0; m < 5; m++) {
      s.state.time.tick += 30;
      s.sim.market.monthly(s.state);
      expect(marketPrice(s.state, 'power', 'buy')).toBe(offer);
    }
    const before = s.state.economy.treasury;
    const r = s.execute({ type: 'contract', good: 'power', side: 'buy', enabled: false });
    expect(r.ok).toBe(true);
    expect(before - s.state.economy.treasury).toBe(r.penalty);
    expect(r.penalty).toBeGreaterThanOrEqual(100000);
    expect(marketPrice(s.state, 'power', 'buy')).toBe(s.state.market.prices.power.buy);
  });
});

function defaultMarketPrice(good, month) {
  return spotPrice(defaultMarket(), good, 'buy', month);
}
