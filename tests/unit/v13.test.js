import { describe, it, expect } from 'vitest';
import { newSession } from '../helpers/session.js';
import { buildStarterTown } from '../../src/app/scenarios.js';
import {
  GROUP_IDS, groupSizes, groupOpinions, firstRound, decidedInFirstRound, secondRound, allocateSeats, mergeCandidates, mergeAccepted, councilVote
} from '../../src/simulation/ElectorateSystem.js';
import { councilSeats, councilOf } from '../../src/simulation/CouncilSystem.js';

/** Bourg habité (un an et demi), élections activées. */
function town() {
  const s = newSession();
  s.state.economy.treasury += 2_000_000_00;
  buildStarterTown(s, { size: 'large' });
  s.run(450);
  return s;
}
const weighted = (groups, key) => groups.reduce((a, g) => a + g.share * g[key], 0) / groups.reduce((a, g) => a + g.share, 0);

describe('v1.3 — électorat par groupes', () => {
  const s = town();
  const st = s.state;

  it('huit groupes dérivés des ménages ; la moyenne pondérée des groupes redonne la popularité générale', () => {
    const sizes = groupSizes(st);
    expect(Object.keys(sizes)).toEqual(GROUP_IDS);
    expect(sizes.retirees).toBeGreaterThan(0);
    expect(sizes.working + sizes.families).toBeGreaterThan(0);
    const g = groupOpinions(st);
    expect(g).toHaveLength(8);
    expect(weighted(g, 'approval')).toBeCloseTo(st.politics.approval, 0);
    for (const x of g) {
      expect(x.turnout).toBeGreaterThanOrEqual(20);
      expect(x.turnout).toBeLessThanOrEqual(90);
    }
  });

  it('une politique divise les groupes sans changer la moyenne (zone à faibles émissions)', () => {
    const before = Object.fromEntries(groupOpinions(st).map((g) => [g.id, g.approval]));
    st.policies.active.low_emission_zone = st.time.tick;
    const after = groupOpinions(st);
    const byId = Object.fromEntries(after.map((g) => [g.id, g.approval]));
    expect(byId.greens - before.greens).toBeGreaterThan(0);
    expect(byId.drivers - before.drivers).toBeLessThan(0);
    expect(weighted(after, 'approval')).toBeCloseTo(st.politics.approval, 0);
    delete st.policies.active.low_emission_zone;
  });

  it('premier tour : le score du maire suit la formule historique ; listes écologiste et citoyenne selon la situation', () => {
    st.politics.approval = 60;
    const base = s.sim.politics.projectedShare(st, { noise: false });
    const r1 = firstRound(st, { base });
    const mine = r1.lists.find((l) => l.id === 'mayor');
    expect(Math.abs(mine.share - base)).toBeLessThan(3);
    expect(r1.lists.reduce((a, l) => a + l.share, 0)).toBeCloseTo(100, 0);
    expect(decidedInFirstRound(r1)).toBe('mayor');
    st.politics.approval = 40;
    const r1b = firstRound(st, { base: s.sim.politics.projectedShare(st, { noise: false }) });
    expect(r1b.lists.map((l) => l.id)).toContain('citizen');
    st.stats.avgPollution = 20;
    expect(firstRound(st, { base: 45 }).lists.map((l) => l.id)).toContain('green');
    st.stats.avgPollution = 0;
  });

  it('second tour : une fusion reporte 80 % des voix ; l\'adversaire fusionne avec la liste restante la plus forte', () => {
    st.politics.approval = 47;
    st.stats.avgPollution = 20;
    const r1 = firstRound(st, { base: 46 });
    expect(decidedInFirstRound(r1)).toBeNull();
    const cands = mergeCandidates(r1);
    expect(cands.length).toBeGreaterThan(0);
    const alone = secondRound(st, r1, { seed: 3 });
    expect(alone.merged.rival).toContain(cands[0].id);
    const together = secondRound(st, r1, { mergeWith: cands[0].id, seed: 3 });
    const m1 = alone.lists.find((l) => l.id === 'mayor').share;
    const m2 = together.lists.find((l) => l.id === 'mayor').share;
    expect(m2).toBeGreaterThan(m1);
    st.stats.avgPollution = 0;
  });

  it('prime majoritaire : la moitié des sièges à la liste en tête, le reste à la plus forte moyenne', () => {
    const lists = [{ id: 'mayor', share: 52 }, { id: 'rival', share: 40 }, { id: 'green', share: 8 }];
    const r = allocateSeats(12000, lists);
    expect(r.total).toBe(councilSeats(12000));
    expect(r.seats.mayor + r.seats.rival + r.seats.green).toBe(r.total);
    expect(r.seats.mayor).toBeGreaterThanOrEqual(Math.ceil(r.total / 2) + Math.floor((r.total / 2) * 0.45));
    expect(r.seats.green).toBeGreaterThanOrEqual(1);
    expect(r.majority).toBeGreaterThan(0.7);
  });
});

describe('v1.3 — scrutin à deux tours', () => {
  function toElection(s, approval) {
    const p = s.state.politics;
    p.nextElection = Math.floor(s.state.time.tick / 30) + 7;
    const ev = [];
    let sr = null;
    s.bus.on('politics:election', (e) => ev.push(e.result));
    s.bus.on('politics:secondRound', (e) => (sr = e.secondRound));
    while (!ev.length && !sr) {
      p.approval = approval;
      p.target = approval;
      s.run(1);
    }
    return { ev, get sr() { return sr; } };
  }

  it('sans décision, le second tour a lieu une semaine après le premier', () => {
    const s = town();
    s.state.stats.avgPollution = 20;
    const t = toElection(s, 50);
    expect(t.ev).toHaveLength(0);
    expect(s.state.politics.secondRound).not.toBeNull();
    s.run(8);
    expect(t.ev).toHaveLength(1);
    expect(t.ev[0].rounds).toHaveLength(2);
    expect(t.ev[0].seats.total).toBe(councilSeats(s.state.stats.population));
    expect(s.state.politics.secondRound).toBeNull();
  });

  it('fusion acceptée : engagement imposé, délégation pour la tête de liste partenaire, majorité au conseil', () => {
    const s = town();
    s.state.stats.peakPopulation = Math.max(s.state.stats.peakPopulation, 2000);
    // Priorités alignées sur la liste citoyenne (solidarités ≥ 20 %) : elle accepte la fusion même si le maire est derrière
    s.state.politics.agenda.shares = { urban: 15, finance: 15, mobility: 15, safety: 15, ecology: 15, social: 25 };
    const t = toElection(s, 50);
    expect(t.ev).toHaveLength(0);
    const sr = s.state.politics.secondRound;
    expect(sr).not.toBeNull();
    const partner = sr.candidates.find((c) => c.accepts);
    expect(partner).toBeDefined();
    expect(mergeAccepted(s.state, sr.r1, partner.id)).toBe(true);
    const r = s.execute({ type: 'politics', op: 'secondRound', mergeWith: partner.id });
    expect(r.ok).toBe(true);
    const res = t.ev[0];
    expect(res.mergeWith).toBe(partner.id);
    expect(res.rounds).toHaveLength(2);
    if (res.won) {
      expect(councilOf(s.state).members.some((m) => m.partner === partner.id)).toBe(true);
      expect(s.state.politics.majority.total).toBe(res.seats.total);
    }
  });

  it('majorité étroite : le conseil peut rejeter une hausse d\'impôt de plus de 2 points ; jamais avec une large majorité', () => {
    const s = town();
    const p = s.state.politics;
    p.majority = { seats: 15, total: 19, share: 0.79 };
    expect(councilVote(s.state).needed).toBe(false);
    expect(s.execute({ type: 'tax', key: 'R', value: s.state.economy.taxes.R + 3 }).ok).toBe(true);
    p.majority = { seats: 10, total: 19, share: 0.4 };
    const r = s.execute({ type: 'tax', key: 'R', value: s.state.economy.taxes.R + 3 });
    expect(r.ok).toBe(false);
    expect(r.messages[0]).toMatch(/conseil municipal/);
    expect(s.execute({ type: 'tax', key: 'R', value: s.state.economy.taxes.R + 1 }).ok).toBe(true);
  });

  it('présidence de la métropole : capitale régionale et deux réélections', () => {
    const s = town();
    const p = s.state.politics;
    expect(s.execute({ type: 'politics', op: 'presidency' }).ok).toBe(false);
    s.state.stats.peakPopulation = 90000;
    p.mandate = 3;
    expect(s.execute({ type: 'politics', op: 'presidency' }).ok).toBe(true);
    s.run(30 - (s.state.time.tick % 30));
    expect(p.factors.find((f) => f.id === 'career').value).toBe(1);
  });
});
