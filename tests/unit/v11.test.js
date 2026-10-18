import { describe, it, expect } from 'vitest';
import { newSession, flatSession, getCatalog } from '../helpers/session.js';
import { buildStarterTown } from '../../src/app/scenarios.js';
import { GameSession } from '../../src/app/GameSession.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { computeModifiers } from '../../src/simulation/Modifiers.js';
import {
  councilSeats, candidatesFor, councilOf, agendaOf, slotsOf, efficiency, perception, factorWeight, allowanceEuros, AXES
} from '../../src/simulation/CouncilSystem.js';

function village(peak = 600) {
  const s = newSession();
  s.state.stats.peakPopulation = peak;
  s.state.milestones.announced = s.state.milestones.granted = 6;
  return s;
}
const appointFirst = (s, delegation, k = 0) => {
  const c = candidatesFor(s.state, delegation)[k];
  return { r: s.execute({ type: 'council', op: 'appoint', delegation, candidateId: c.id }), c };
};
const member = (s, delegation) => councilOf(s.state).members.find((m) => m.delegation === delegation);

describe('v1.1 — conseil municipal', () => {
  it('taille du conseil selon la population (art. L2121-2 du CGCT)', () => {
    expect([50, 300, 800, 2000, 3000, 4000, 6000, 12000, 25000, 35000, 45000, 55000, 70000, 90000, 120000, 400000].map(councilSeats))
      .toEqual([7, 11, 15, 19, 23, 27, 29, 33, 35, 39, 43, 45, 49, 53, 55, 69]);
  });

  it('trois candidats par délégation, tirés de façon déterministe pour le mandat', () => {
    const a = candidatesFor(village().state, 'finance');
    const b = candidatesFor(village().state, 'finance');
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
    for (const c of a) {
      expect(c.competence).toBeGreaterThanOrEqual(1);
      expect(c.competence).toBeLessThanOrEqual(5);
      expect(c.loyalty).toBeGreaterThanOrEqual(55);
      expect(c.loyalty).toBeLessThanOrEqual(80);
    }
  });

  it('le statut fixe le nombre de délégations ; nomination et effets pondérés par la priorité', () => {
    const s = newSession();
    expect(slotsOf(s.state)).toBe(0);
    expect(appointFirst(s, 'finance').r.ok).toBe(false);
    s.state.stats.peakPopulation = 600;
    expect(slotsOf(s.state)).toBe(2);
    const { r, c } = appointFirst(s, 'finance');
    expect(r.ok).toBe(true);
    expect(appointFirst(s, 'mobility').r.ok).toBe(true);
    expect(appointFirst(s, 'safety').r.messages[0]).toMatch(/2 délégations au plus/);
    const mods = computeModifiers(s.state, getCatalog());
    expect(mods['upkeep.structure']).toBeCloseTo(1 - 0.02 * (c.competence - 1) * efficiency(s.state, 'finance'), 6);
    // Priorité Finances à 40 % : efficacité ×1,21
    const shares = { urban: 12, finance: 40, mobility: 12, safety: 12, ecology: 12, social: 12 };
    expect(s.execute({ type: 'council', op: 'agenda', shares }).ok).toBe(true);
    expect(efficiency(s.state, 'finance')).toBeCloseTo(1.21, 6);
    const mods2 = computeModifiers(s.state, getCatalog());
    expect(mods2['upkeep.structure']).toBeCloseTo(1 - 0.02 * (c.competence - 1) * 1.21, 6);
  });

  it('remaniement : un par an, popularité et loyauté des autres en baisse ; gratuit si l\'adjoint a perdu la confiance', () => {
    const s = village();
    appointFirst(s, 'finance', 0);
    appointFirst(s, 'urban', 0);
    const other = member(s, 'urban');
    const l0 = other.loyalty;
    const flips = s.state.politics.memory.flipflops.length;
    expect(appointFirst(s, 'finance', 1).r.ok).toBe(true);
    expect(s.state.politics.memory.flipflops.length).toBe(flips + 1);
    expect(other.loyalty).toBe(l0 - 5);
    expect(appointFirst(s, 'finance', 2).r.messages[0]).toMatch(/un seul remaniement par an/i);
    member(s, 'finance').loyalty = 10;
    expect(appointFirst(s, 'finance', 2).r.ok).toBe(true);
  });

  it('indemnités des adjoints à la clôture du mois', () => {
    const s = village();
    appointFirst(s, 'finance');
    appointFirst(s, 'urban');
    s.run(30 - (s.state.time.tick % 30));
    expect(s.state.economy.periods.at(-1).opex.councilAllowances).toBe(2 * allowanceEuros(s.state) * 100);
  });

  it('demandes : au plus une tous les 3 mois après la première année ; accepter ou refuser', () => {
    const s = village();
    appointFirst(s, 'finance');
    appointFirst(s, 'social');
    s.state.time.tick = 360;
    const c = councilOf(s.state);
    let req = null;
    for (let k = 0; k < 40 && !req; k++) {
      s.run(30);
      req = c.requests[0] ?? null;
    }
    expect(req).not.toBeNull();
    const m = c.members.find((x) => x.id === req.memberId);
    const l0 = m.loyalty;
    expect(s.execute({ type: 'council', op: 'answer', requestId: req.id, accept: false }).ok).toBe(true);
    expect(m.loyalty).toBe(Math.max(0, l0 - 8));
    expect(c.requests).toHaveLength(0);
  });

  it('démission sous 25 de loyauté : délégation vacante trois mois, popularité en baisse', () => {
    const s = village();
    appointFirst(s, 'safety');
    member(s, 'safety').loyalty = 0;
    s.run(30 - (s.state.time.tick % 30));
    expect(member(s, 'safety')).toBeUndefined();
    const c = councilOf(s.state);
    expect(c.vacantUntil.safety).toBeGreaterThan(Math.floor(s.state.time.tick / 30));
    expect(appointFirst(s, 'safety').r.ok).toBe(false);
    const team = s.state.politics.factors.find((f) => f.id === 'team');
    expect(team.value).toBeLessThan(0);
  });

  it('un adjoint compétent gère seul les crises de son domaine', () => {
    const s = newSession();
    buildStarterTown(s, { size: 'large' });
    s.run(120);
    s.execute({ type: 'debug', op: 'unlock', population: 5000 });
    s.execute({ type: 'debug', op: 'treasury', euros: 2_000_000 });
    const list = candidatesFor(s.state, 'safety');
    const best = list.reduce((a, b) => (b.competence > a.competence ? b : a));
    best.competence = 4;
    expect(s.execute({ type: 'council', op: 'appoint', delegation: 'safety', candidateId: best.id }).ok).toBe(true);
    expect(s.execute({ type: 'council', op: 'autoCrisis', delegation: 'safety', enabled: true }).ok).toBe(true);
    const r = s.execute({ type: 'triggerDisaster', kind: 'fire' });
    expect(r.ok).toBe(true);
    s.run(1);
    const fire = [...s.state.crises.active, ...s.state.crises.history].find((c) => c.kind === 'fire');
    expect(fire.response).toBe('reinforce');
  });
});

describe('v1.1 — priorités du mandat', () => {
  it('100 points entiers ; à 1/6 partout, l\'opinion est inchangée', () => {
    const s = village();
    expect(s.execute({ type: 'council', op: 'agenda', shares: { urban: 50, finance: 50, mobility: 10, safety: 0, ecology: 0, social: 0 } }).ok).toBe(false);
    for (const axis of AXES) expect(perception(s.state, axis)).toBeCloseTo(0.7 + 1.8 * agendaOf(s.state).shares[axis] / 100, 6);
    expect(factorWeight(s.state, 'taxes')).toBeCloseTo(0.7 + 1.8 * 0.17, 6);
    expect(factorWeight(s.state, 'promises')).toBe(1);
  });

  it('un axe prioritaire pèse plus lourd dans l\'opinion ; plus de 30 points déplacés en un an coûtent 1 point', () => {
    const s = village();
    s.state.economy.taxes.R = 14;
    s.state.stats.population = 600;
    const before = s.sim.politics.factors(s.state).find((f) => f.id === 'taxes').value;
    s.execute({ type: 'council', op: 'agenda', shares: { urban: 10, finance: 40, mobility: 10, safety: 15, ecology: 10, social: 15 } });
    const f = s.sim.politics.factors(s.state);
    const after = f.find((x) => x.id === 'taxes').value;
    expect(after).toBeLessThan(before);
    expect(f.find((x) => x.id === 'agenda')).toBeUndefined();
    s.execute({ type: 'council', op: 'agenda', shares: { urban: 40, finance: 10, mobility: 10, safety: 15, ecology: 10, social: 15 } });
    expect(s.sim.politics.factors(s.state).find((x) => x.id === 'agenda').value).toBe(-1);
  });

  it('cohérence du thème de campagne avec les priorités', () => {
    const s = village();
    const a = agendaOf(s.state);
    a.topMonths = { mobility: 30 };
    expect(s.sim.politics.coherenceFor(s.state, 'mobility')).toBe(1);
    s.execute({ type: 'council', op: 'agenda', shares: { urban: 30, finance: 30, mobility: 5, safety: 15, ecology: 10, social: 10 } });
    a.topMonths = {};
    expect(s.sim.politics.coherenceFor(s.state, 'mobility')).toBe(-1.5);
    expect(s.sim.politics.coherenceFor(s.state, 'taxes')).toBe(0);
  });

  it('liste dissidente en campagne : un ancien adjoint ambitieux et peu loyal prend des voix', () => {
    const s = village();
    const { c } = appointFirst(s, 'urban');
    const x = member(s, 'urban');
    x.ambition = 5;
    x.loyalty = 20;
    x.loyalty = 30;
    const p = s.state.politics;
    p.approval = 40;
    p.target = 40;
    p.nextElection = Math.floor(s.state.time.tick / 30) + 3;
    const before = s.sim.politics.projectedShare(s.state, { noise: false });
    s.run(30 - (s.state.time.tick % 30));
    expect(p.campaign.dissident?.name).toBe(c.name);
    expect(member(s, 'urban')).toBeUndefined();
    expect(s.sim.politics.dissidentPenalty(s.state)).toBe(6);
    expect(s.sim.politics.projectedShare(s.state, { noise: false })).toBeLessThan(before);
  });

  it('le conseil et les priorités sont sauvegardés', () => {
    const s = village();
    appointFirst(s, 'finance');
    s.execute({ type: 'council', op: 'agenda', shares: { urban: 12, finance: 40, mobility: 12, safety: 12, ecology: 12, social: 12 } });
    const back = new GameSession({ catalog: getCatalog(), state: deserializeState(JSON.parse(JSON.stringify(serializeState(s.state)))) });
    expect(councilOf(back.state).members).toEqual(councilOf(s.state).members);
    expect(agendaOf(back.state).shares.finance).toBe(40);
  });

  it('une ancienne partie sans priorités garde exactement son opinion', () => {
    const s = flatSession();
    delete s.state.politics.agenda;
    s.state.stats.population = 900;
    for (const f of s.sim.politics.factors(s.state)) expect(f.weight).toBeUndefined();
  });
});
