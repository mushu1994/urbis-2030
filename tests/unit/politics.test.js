import { describe, it, expect } from 'vitest';
import { flatSession, newSession, getCatalog, spawn } from '../helpers/session.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { GameSession } from '../../src/app/GameSession.js';
import { TERM_MONTHS, CAMPAIGN_MONTHS, LEGACY_FIRST_ELECTION_MONTHS } from '../../src/simulation/PoliticsSystem.js';

const month = (s) => Math.floor(s.state.time.tick / 30);
/** Avance jusqu'à la fin du mois `m` (inclus). */
function runToMonth(s, m) {
  while (month(s) < m) s.run(30 - (s.state.time.tick % 30));
}

/** Petite ville habitée (logements, emplois, services) sur carte plate. */
function town() {
  const s = flatSession({ width: 40, height: 40, row: 20 });
  s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 20 }, to: { x: 36, y: 20 } });
  s.execute({ type: 'building', defId: 'power_gas', x: 30, y: 21 });
  s.execute({ type: 'zone', zoneId: 'R_LOW', rect: { x0: 4, y0: 18, x1: 35, y1: 19 } });
  s.execute({ type: 'zone', zoneId: 'C', rect: { x0: 4, y0: 21, x1: 28, y1: 21 } });
  for (let x = 4; x < 36; x += 1) spawn(s, 'res_low_1', x, 19, { residents: 4 });
  for (let x = 4; x < 29; x += 1) spawn(s, 'com_1', x, 21);
  return s;
}

describe('Vie politique (v0.7)', () => {
  it('une nouvelle partie démarre au 1er mandat, scrutin dans 6 ans, popularité initiale 58', () => {
    const s = newSession();
    const p = s.state.politics;
    expect(p.enabled).toBe(true);
    expect(p.mandate).toBe(1);
    expect(p.nextElection).toBe(TERM_MONTHS);
    expect(p.approval).toBe(58);
    s.run(60);
    expect(p.factors.length).toBeGreaterThan(0);
    expect(p.history).toHaveLength(2);
  });

  it('la popularité suit ses facteurs avec inertie ; une forte hausse d\'impôts la fait chuter', () => {
    const s = town();
    s.run(120);
    const p = s.state.politics;
    const before = p.target;
    s.execute({ type: 'tax', key: 'R', value: 20 });
    s.execute({ type: 'tax', key: 'C', value: 20 });
    s.run(30);
    const taxes = p.factors.find((f) => f.id === 'taxes');
    expect(taxes.value).toBeLessThan(-10);
    expect(p.target).toBeLessThan(before - 5);
    // Inertie : la popularité ne rejoint pas la cible en un mois
    expect(p.approval).toBeGreaterThan(p.target);
  });

  it('la campagne s\'ouvre 6 mois avant le scrutin ; le programme est validé (3 au plus, un par thème)', () => {
    const s = town();
    const p = s.state.politics;
    p.nextElection = month(s) + 8;
    runToMonth(s, p.nextElection - CAMPAIGN_MONTHS);
    expect(p.campaign).not.toBeNull();
    const offers = p.campaign.offers;
    expect(offers.length).toBeGreaterThan(5);
    const themes = [...new Set(offers.map((o) => o.theme))];
    const pick = themes.slice(0, 3).map((t) => offers.find((o) => o.theme === t).id);
    const four = [...pick, offers.find((o) => !pick.includes(o.id) && !themes.slice(0, 3).includes(o.theme))?.id].filter(Boolean);
    expect(s.execute({ type: 'politics', op: 'programme', promises: four }).ok).toBe(false);
    const sameTheme = offers.filter((o) => o.theme === offers[0].theme).map((o) => o.id);
    if (sameTheme.length > 1) expect(s.execute({ type: 'politics', op: 'programme', promises: sameTheme.slice(0, 2) }).ok).toBe(false);
    expect(s.execute({ type: 'politics', op: 'programme', promises: pick, theme: 'growth' }).ok).toBe(true);
    expect(s.sim.politics.programmeBonus(s.state)).toBeGreaterThan(2);
  });

  it('élection gagnée : nouveau mandat, les engagements deviennent des promesses suivies', () => {
    const s = town();
    const p = s.state.politics;
    p.nextElection = month(s) + 7;
    runToMonth(s, p.nextElection - CAMPAIGN_MONTHS);
    p.approval = 75;
    const pop = p.campaign.offers.find((o) => o.metric === 'population' && o.level === 'modest');
    expect(s.execute({ type: 'politics', op: 'programme', promises: [pop.id] }).ok).toBe(true);
    const events = [];
    s.bus.on('politics:election', (e) => events.push(e.result));
    // Popularité maintenue haute pour un résultat net
    const target = p.nextElection;
    while (month(s) < target) {
      p.approval = Math.max(p.approval, 72);
      s.run(30 - (s.state.time.tick % 30));
    }
    expect(events).toHaveLength(1);
    const r = events[0];
    expect(r.won).toBe(true);
    expect(r.share).toBeGreaterThan(50);
    expect(r.districts.length).toBeGreaterThan(0);
    // Moyenne pondérée des quartiers = score de la commune
    const w = r.districts.reduce((a, d) => a + d.share * d.residents, 0) / r.districts.reduce((a, d) => a + d.residents, 0);
    expect(Math.abs(w - r.share)).toBeLessThan(1.5);
    expect(p.mandate).toBe(2);
    expect(p.nextElection).toBe(target + TERM_MONTHS);
    expect(p.promises).toHaveLength(1);
    expect(p.promises[0].status).toBe('pending');
    expect(p.campaign).toBeNull();
  });

  it('promesse tenue dès que l\'objectif est atteint ; promesse « à maintenir » rompue au premier écart', () => {
    const s = town();
    const p = s.state.politics;
    s.run(60);
    p.promises = [
      { id: 'a', theme: 'growth', metric: 'population', kind: 'reach', level: 'modest', target: 1, baseline: 0, points: 1, label: 'Atteindre 1 hab.', status: 'pending', deadline: month(s) + 60 },
      { id: 'b', theme: 'taxes', metric: 'taxR', kind: 'keep', level: 'modest', target: s.state.economy.taxes.R, baseline: s.state.economy.taxes.R, points: 1, label: 'Pas de hausse', status: 'pending', deadline: month(s) + 60 }
    ];
    s.execute({ type: 'tax', key: 'R', value: s.state.economy.taxes.R + 2 });
    s.run(30);
    expect(p.promises[0].status).toBe('kept');
    expect(p.promises[1].status).toBe('broken');
    expect(p.record).toEqual({ kept: 1, broken: 1 });
    expect(p.factors.find((f) => f.id === 'promises').value).toBeCloseTo(2.5 - 4, 5);
    expect(s.sim.politics.credibility(s.state)).toBeLessThan(0.8);
  });

  it('défaite : la partie peut continuer sans élections', () => {
    const s = town();
    const p = s.state.politics;
    p.nextElection = month(s) + 1;
    const events = [];
    s.bus.on('politics:election', (e) => events.push(e.result));
    p.approval = 20;
    s.execute({ type: 'tax', key: 'R', value: 25 });
    runToMonth(s, p.nextElection);
    expect(events[0].won).toBe(false);
    expect(p.defeated).toBe(true);
    expect(s.execute({ type: 'politics', op: 'continue' }).ok).toBe(true);
    expect(p.enabled).toBe(false);
    expect(s.state.options.elections).toBe('off');
    s.run(60);
    expect(p.elections).toHaveLength(1);
  });

  it('popularité effondrée pendant 9 mois : élections anticipées', () => {
    const s = town();
    const p = s.state.politics;
    s.execute({ type: 'tax', key: 'R', value: 25 });
    s.execute({ type: 'tax', key: 'C', value: 25 });
    s.execute({ type: 'tax', key: 'O', value: 25 });
    s.execute({ type: 'tax', key: 'I', value: 25 });
    for (let k = 0; k < 10; k++) {
      p.approval = 10;
      s.run(30);
    }
    expect(p.early).toBe(true);
    expect(p.campaign).not.toBeNull();
    expect(p.nextElection - month(s)).toBeLessThanOrEqual(CAMPAIGN_MONTHS);
  });

  it('abroger une politique moins d\'un an après son adoption : revirement pénalisé', () => {
    const s = town();
    s.run(30);
    expect(s.execute({ type: 'policy', policyId: 'remote_work', enabled: true }).ok).toBe(true);
    s.run(60);
    expect(s.execute({ type: 'policy', policyId: 'remote_work', enabled: false }).ok).toBe(true);
    s.run(30);
    expect(s.state.politics.factors.find((f) => f.id === 'flipflops')?.value).toBeLessThan(0);
  });

  it('sauvegarde : la vie politique est conservée ; une ancienne partie démarre avec un scrutin dans 3 ans', () => {
    const s = town();
    s.run(90);
    const data = serializeState(s.state);
    const back = deserializeState(structuredClone(data));
    expect(back.politics).toEqual(s.state.politics);
    delete data.politics;
    delete data.options.elections;
    const legacy = deserializeState(data);
    const m = Math.floor(legacy.time.tick / 30);
    expect(legacy.politics.nextElection).toBe(m + LEGACY_FIRST_ELECTION_MONTHS);
    expect(legacy.politics.enabled).toBe(true);
    expect(legacy.options.elections).toBe('on');
    const s2 = new GameSession({ catalog: getCatalog(), state: legacy });
    const notes = [];
    s2.bus.on('notify', (n) => notes.push(n.message));
    s2.run(30);
    expect(notes.some((n) => /vie politique/.test(n))).toBe(true);
  });

  it('déterminisme : deux parties identiques donnent le même scrutin', () => {
    const results = [];
    for (let k = 0; k < 2; k++) {
      const s = town();
      s.state.politics.nextElection = 8;
      const ev = [];
      s.bus.on('politics:election', (e) => ev.push(e.result));
      runToMonth(s, 8);
      results.push(ev[0]);
    }
    expect(results[0].share).toBe(results[1].share);
    expect(results[0].turnout).toBe(results[1].turnout);
  });
});
