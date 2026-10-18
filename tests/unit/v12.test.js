import { describe, it, expect } from 'vitest';
import { flatSession, newSession, spawn, getCatalog } from '../helpers/session.js';
import { GameSession } from '../../src/app/GameSession.js';
import { placeNear } from '../../src/app/scenarios.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { controversiesOf, controversyPenalty, controversyEdge, CONTROVERSIES, CONTROVERSY_KINDS } from '../../src/simulation/ControversySystem.js';
import { civicOf, EVENT_TYPES, eventCost, eventMonth, localEventBonus, localLifeFactor, clientelismEdge } from '../../src/simulation/CivicEventSystem.js';

const M = 30;
const toMonthEnd = (s) => s.run(M - (s.state.time.tick % M));

/** Ville d'au moins un an, sans crise, avec une hausse brutale de la taxe d'habitation. */
function withTaxHike() {
  const s = flatSession();
  s.state.time.tick = 400;
  s.state.politics.memory.taxes = [{ R: 9, C: 9, O: 9, I: 9 }];
  s.execute({ type: 'tax', key: 'R', value: 12 });
  toMonthEnd(s);
  return s;
}

describe('v1.2 — polémiques', () => {
  it('douze polémiques, chacune avec un déclencheur, une intensité et au moins deux réponses', () => {
    expect(CONTROVERSY_KINDS).toHaveLength(12);
    for (const k of CONTROVERSY_KINDS) {
      const d = CONTROVERSIES[k];
      expect(typeof d.detect).toBe('function');
      expect(d.intensity).toBeGreaterThan(0);
      expect(Object.keys(d.responses).length).toBeGreaterThanOrEqual(2);
      expect(d.responses.assume).toBeDefined();
    }
  });

  it('aucune polémique la première année ; une hausse d\'impôt brutale en déclenche une', () => {
    const young = flatSession();
    young.state.politics.memory.taxes = [{ R: 9, C: 9, O: 9, I: 9 }];
    young.execute({ type: 'tax', key: 'R', value: 12 });
    toMonthEnd(young);
    expect(controversiesOf(young.state).active).toHaveLength(0);
    const s = withTaxHike();
    const C = controversiesOf(s.state);
    expect(C.active.map((c) => c.kind)).toContain('taxHike');
    const c = C.active.find((x) => x.kind === 'taxHike');
    expect(c.intensity).toBe(5);
    expect(controversyPenalty(s.state)).toBeCloseTo(-0.4 * C.active.reduce((a, x) => a + x.intensity, 0), 6);
    expect(s.state.politics.factors.find((f) => f.id === 'controversies')).toBeUndefined();
    toMonthEnd(s);
    expect(s.state.politics.factors.find((f) => f.id === 'controversies').value).toBeLessThan(0);
  });

  it('sans réponse elle monte ; concerter la fait retomber (et améliore la presse) ; reculer la clôt (revirement)', () => {
    const s = withTaxHike();
    const C = controversiesOf(s.state);
    const c = C.active.find((x) => x.kind === 'taxHike');
    toMonthEnd(s);
    expect(c.intensity).toBe(6);
    const press = C.press;
    expect(s.execute({ type: 'controversy', id: c.id, response: 'consult' }).ok).toBe(true);
    expect(s.state.economy.taxes.R).toBe(10.5);
    expect(C.press).toBe(press + 5);
    toMonthEnd(s);
    expect(c.intensity).toBe(3);
    const s2 = withTaxHike();
    const c2 = controversiesOf(s2.state).active.find((x) => x.kind === 'taxHike');
    const flips = s2.state.politics.memory.flipflops.length;
    expect(s2.execute({ type: 'controversy', id: c2.id, response: 'retreat' }).ok).toBe(true);
    expect(s2.state.economy.taxes.R).toBe(9);
    expect(controversiesOf(s2.state).active.find((x) => x.kind === 'taxHike')).toBeUndefined();
    expect(s2.state.politics.memory.flipflops.length).toBe(flips + 1);
  });

  it('à 10 : affaire, popularité −6, souvenir pour la campagne', () => {
    const s = withTaxHike();
    const C = controversiesOf(s.state);
    const c = C.active.find((x) => x.kind === 'taxHike');
    c.intensity = 9;
    s.state.politics.approval = 60;
    toMonthEnd(s);
    expect(C.affairs.map((a) => a.kind)).toContain('taxHike');
    expect(C.active.find((x) => x.kind === 'taxHike')).toBeUndefined();
    s.state.politics.campaign = { chosen: [], offers: [], attacks: [] };
    expect(controversyEdge(s.state)).toBeGreaterThanOrEqual(1.5);
    expect(C.front.at(-1).title).toMatch(/affaire/i);
  });

  it('gel des investissements après une dépense de prestige ; suspension d\'une technologie après un accident', () => {
    const s = flatSession();
    const C = controversiesOf(s.state);
    C.active.push({ id: 99, kind: 'prestige', title: 'x', intensity: 4, since: 0, response: null, ctx: {} });
    expect(s.execute({ type: 'controversy', id: 99, response: 'retreat' }).ok).toBe(true);
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 26, y: 15 } });
    expect(s.preview({ type: 'building', defId: 'hospital', x: 10, y: 11 }).reasons).toContain('frozen');
    expect(s.preview({ type: 'building', defId: 'park_small', x: 10, y: 16 }).reasons).not.toContain('frozen');
    C.active.push({ id: 100, kind: 'autonomyAccident', title: 'x', intensity: 4, since: 0, response: null, ctx: { techId: 'autonomous_vehicles' } });
    expect(s.execute({ type: 'controversy', id: 100, response: 'retreat' }).ok).toBe(true);
    expect(s.state.tech.outages.autonomous_vehicles).toBeGreaterThan(s.state.time.tick);
  });

  it('au plus une nouvelle polémique par trimestre ; un journal paraît chaque mois', () => {
    const s = withTaxHike();
    const C = controversiesOf(s.state);
    const n = C.active.length;
    s.state.politics.memory.taxes.push({ R: 9, C: 14, O: 9, I: 9 });
    s.state.economy.taxes.C = 14;
    toMonthEnd(s);
    expect(C.active.length).toBe(n);
    expect(C.front.length).toBeGreaterThanOrEqual(2);
    for (const f of C.front) {
      expect(typeof f.title).toBe('string');
      expect(f.briefs.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('v1.2 — événements populaires', () => {
  function town() {
    const s = flatSession();
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 26, y: 15 } });
    const park = s.execute({ type: 'building', defId: 'park', x: 10, y: 16 }).building;
    for (let x = 4; x <= 24; x += 2) spawn(s, 'res_high_2', x, 13, { residents: 120, access: s.state.grid.idx(x, 15) });
    s.state.stats.population = 1300;
    s.state.weather = { ...s.state.weather, kind: 'clear' };
    s.state.politics.enabled = false;
    return { s, park };
  }

  it('organiser : statut requis, lieu adapté, un seul à la fois, frais payés d\'avance', () => {
    const n = newSession();
    expect(n.sim.civic.preview(n.state, { type: 'music', buildingId: 1 }).reason).toMatch(/statut/);
    const { s, park } = town();
    expect(s.preview({ type: 'civicEvent', eventType: 'stadium', buildingId: park.id }).ok).toBe(false);
    const t0 = s.state.economy.treasury;
    const r = s.execute({ type: 'civicEvent', op: 'plan', eventType: 'neighborhood', buildingId: park.id });
    expect(r.ok).toBe(true);
    expect(t0 - s.state.economy.treasury).toBe(eventCost(s.state, 'neighborhood') * 100);
    expect(s.execute({ type: 'civicEvent', op: 'plan', eventType: 'market', buildingId: park.id }).ok).toBe(false);
    expect(eventMonth(s.state, 'christmas') % 12).toBe(0);
  });

  it('la fête a lieu à la fin du mois : satisfaction locale, vie locale, rendements décroissants', () => {
    const { s, park } = town();
    s.execute({ type: 'civicEvent', op: 'plan', eventType: 'neighborhood', buildingId: park.id });
    toMonthEnd(s);
    const C = civicOf(s.state);
    const e = C.history.at(-1);
    expect(e.cancelled).toBe(false);
    expect(e.visitors).toBeGreaterThan(0);
    if (!e.incident) {
      expect(localEventBonus(s.state, park.x, park.y)).toBeGreaterThan(0);
      expect(localEventBonus(s.state, park.x + 40, park.y + 40)).toBe(0);
      expect(localLifeFactor(s.state)).toBeGreaterThan(0);
    }
    // Même type dans l'année, autre lieu : effet × 0,6
    const plaza = s.execute({ type: 'building', defId: 'plaza', x: 20, y: 16 }).building;
    s.execute({ type: 'civicEvent', op: 'plan', eventType: 'neighborhood', buildingId: plaza.id });
    toMonthEnd(s);
    const e2 = C.history.at(-1);
    expect(e2.effect ?? 0).toBeLessThan((e.effect ?? 1) + 1e-9);
    // Le même lieu ne peut pas resservir avant 4 mois
    expect(s.execute({ type: 'civicEvent', op: 'plan', eventType: 'market', buildingId: park.id }).ok).toBe(false);
  });

  it('orage : annulé et moitié des frais perdue, sauf repli couvert', () => {
    const { s, park } = town();
    s.execute({ type: 'civicEvent', op: 'plan', eventType: 'neighborhood', buildingId: park.id });
    s.run(M - (s.state.time.tick % M) - 1);
    s.state.weather = { ...s.state.weather, kind: 'storm' };
    s.sim.weather.daily = () => {};
    s.run(1);
    expect(civicOf(s.state).history.at(-1).cancelled).toBe(true);
    const { s: s2, park: p2 } = town();
    s2.execute({ type: 'civicEvent', op: 'plan', eventType: 'neighborhood', buildingId: p2.id, cover: true });
    s2.sim.weather.daily = () => {};
    s2.state.weather = { ...s2.state.weather, kind: 'storm' };
    toMonthEnd(s2);
    expect(civicOf(s2.state).history.at(-1).cancelled).toBe(false);
  });

  it('année électorale : effet réduit de moitié ; trois événements en campagne : clientélisme', () => {
    const { s, park } = town();
    s.state.politics.enabled = true;
    const m = Math.floor(s.state.time.tick / M);
    s.state.politics.nextElection = m + 6;
    s.execute({ type: 'civicEvent', op: 'plan', eventType: 'neighborhood', buildingId: park.id });
    toMonthEnd(s);
    const e = civicOf(s.state).history.at(-1);
    const { s: s2, park: p2 } = town();
    s2.execute({ type: 'civicEvent', op: 'plan', eventType: 'neighborhood', buildingId: p2.id });
    toMonthEnd(s2);
    const e2 = civicOf(s2.state).history.at(-1);
    if (!e.incident && !e2.incident) expect(e.effect).toBeCloseTo(e2.effect / 2, 2);
    const C = civicOf(s.state);
    C.history.push({ month: m + 1, type: 'market', cancelled: false }, { month: m + 2, type: 'tournament', cancelled: false });
    s.state.politics.campaign = { chosen: [], offers: [], attacks: [] };
    expect(clientelismEdge(s.state)).toBe(0.5);
  });

  it('match au stade : billetterie comptabilisée ; événements sauvegardés', () => {
    const { s } = town();
    const stadium = placeNear(s, 'stadium', 14, 20, { maxRadius: 12 }).building;
    expect(stadium).toBeDefined();
    s.execute({ type: 'civicEvent', op: 'plan', eventType: 'stadium', buildingId: stadium.id, cover: true });
    toMonthEnd(s);
    const e = civicOf(s.state).history.at(-1);
    if (!e.incident) expect(s.state.economy.periods.at(-1).revenue.events).toBe(e.revenue * 100);
    const back = new GameSession({ catalog: getCatalog(), state: deserializeState(JSON.parse(JSON.stringify(serializeState(s.state)))) });
    expect(civicOf(back.state).history).toEqual(civicOf(s.state).history);
    expect(EVENT_TYPES.grand.milestone).toBe(6);
  });
});
