import { describe, it, expect } from 'vitest';
import { flatSession, newSession, spawn, getCatalog } from '../helpers/session.js';
import { GameSession } from '../../src/app/GameSession.js';
import { EconomySystem } from '../../src/simulation/EconomySystem.js';
import { growthChecks } from '../../src/simulation/BuildingSystem.js';
import { isUnlocked } from '../../src/systems/ConstructionService.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { migrate } from '../../src/persistence/SaveMigration.js';
import {
  MILESTONES, rankFor, milestoneOf, featureUnlocked, structureEuros, structureCents, balancePhase,
  roadUpkeepFactor, applyDifficulty, DIFFICULTIES, savingsRate
} from '../../src/simulation/Milestones.js';

const toMonthEnd = (s) => s.run(30 - (s.state.time.tick % 30));

describe('v1.0 — statut de la ville', () => {
  it('sept paliers, acquis sur la population maximale atteinte et jamais perdus', () => {
    expect(MILESTONES.map((m) => m.population)).toEqual([0, 500, 2000, 5000, 15000, 40000, 80000]);
    expect([0, 499, 500, 1999, 2000, 4999, 5000, 15000, 39999, 40000, 80000, 1e6].map(rankFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 4, 4, 5, 6, 6]);
    const s = newSession();
    s.state.stats.peakPopulation = 6000;
    s.state.stats.population = 900;
    expect(milestoneOf(s.state).name).toBe('Ville');
  });

  it('bâtiments, routes et zones verrouillés indiquent le statut requis ; la préparation d\'un bourg y échappe', () => {
    const s = newSession();
    const st = s.state;
    expect(isUnlocked(st, { milestone: 3 }).reason).toMatch(/statut « Ville \(5\s000 habitants\) »/);
    expect(isUnlocked(st, s.catalog.building('school').unlock).ok).toBe(false);
    expect(isUnlocked(st, s.catalog.building('clinic').unlock).ok).toBe(true);
    expect(isUnlocked(st, s.catalog.road('road_avenue').unlock).ok).toBe(false);
    expect(s.preview({ type: 'zone', zoneId: 'O', rect: { x0: 10, y0: 10, x1: 12, y1: 12 } }).reasons).toContain('locked');
    st.meta.preparing = true;
    expect(isUnlocked(st, s.catalog.building('airport').unlock).ok).toBe(true);
    delete st.meta.preparing;
    st.stats.peakPopulation = 500;
    expect(isUnlocked(st, s.catalog.building('school').unlock).ok).toBe(true);
    // Chaque équipement constructible est rattaché à un palier, une ère ou une technologie (ou disponible au départ)
    for (const d of s.catalog.buildings.values()) {
      if (d.kind !== 'plop') continue;
      expect(d.unlock?.population, d.id).toBeUndefined();
    }
  });

  it('le statut plafonne le niveau des bâtiments de zone', () => {
    const s = flatSession({ unlockAll: false });
    s.state.stats.peakPopulation = 900;
    const b = spawn(s, 'res_low_2', 10, 10, { residents: 7 });
    const def = s.catalog.building('res_low_2');
    const cap = growthChecks(s.state, b, def).find((c) => c.key === 'milestone');
    expect(cap.ok).toBe(false);
    expect(cap.label).toMatch(/Niveau 3 : statut « Bourg »/);
    s.state.stats.peakPopulation = 2000;
    expect(growthChecks(s.state, b, def).find((c) => c.key === 'milestone')).toBeUndefined();
  });

  it('fonctions débloquées par palier : lignes, emprunts, quartiers, territoire, contrats', () => {
    const s = newSession();
    const st = s.state;
    expect(s.preview({ type: 'line', mode: 'bus', stops: [] }).messages[0]).toMatch(/Lignes de bus.*Bourg/);
    expect(s.execute({ type: 'loan', amountEuros: 10000, months: 60, loanType: 'bullet' }).ok).toBe(false);
    expect(s.execute({ type: 'loan', amountEuros: 10000, months: 60, loanType: 'annuity' }).ok).toBe(true);
    const key = st.land.owned[0];
    expect(s.execute({ type: 'districtTax', key, sector: 'R', value: 2 }).ok).toBe(false);
    expect(s.execute({ type: 'districtTax', key, sector: 'R', value: 0 }).ok).toBe(true);
    expect(s.execute({ type: 'contract', good: 'power', side: 'buy', enabled: true }).ok).toBe(false);
    expect(featureUnlocked(st, 'territory').ok).toBe(false);
    st.stats.peakPopulation = 15000;
    for (const f of ['busLines', 'tramLines', 'loanProfiles', 'districtTax', 'territory', 'fixedContracts']) expect(featureUnlocked(st, f).ok, f).toBe(true);
    expect(s.execute({ type: 'districtTax', key, sector: 'R', value: 2 }).ok).toBe(true);
    expect(s.execute({ type: 'contract', good: 'power', side: 'buy', enabled: true }).ok).toBe(true);
  });

  it('nouveau statut : dotation de l\'État versée une seule fois, en flux d\'investissement, et annonce', () => {
    const s = newSession();
    const st = s.state;
    const seen = [];
    s.bus.on('milestone:reached', (e) => seen.push(e));
    const t0 = st.economy.treasury;
    st.stats.peakPopulation = 2100;
    s.run(1);
    expect(seen.map((e) => e.ranks)).toEqual([[1, 2]]);
    expect(seen[0].rank).toBe(2);
    expect(seen[0].grant).toBe((60000 + 150000) * 100);
    expect(seen[0].unlocks.buildings).toEqual(expect.arrayContaining([s.catalog.building('police').name, s.catalog.building('school').name]));
    expect(st.economy.treasury - t0).toBe((60000 + 150000) * 100);
    expect(st.milestones).toEqual({ granted: 2, announced: 2 });
    s.run(5);
    expect(seen).toHaveLength(1);
    expect(st.economy.treasury - t0).toBe((60000 + 150000) * 100);
    const p = st.economy.current;
    const sum = EconomySystem.summarize(p);
    expect(sum.revenues).toBe(0);
    expect(sum.cashInvesting).toBe(210000 * 100);
    expect(p.cashEnd - p.cashStart).toBe(sum.cashChange);
  });

  it('l\'outil de débogage « unlock » acquiert les paliers sans dotation', () => {
    const s = newSession();
    const t0 = s.state.economy.treasury;
    s.execute({ type: 'debug', op: 'unlock', population: 50000 });
    s.run(2);
    expect(s.state.milestones.announced).toBe(5);
    expect(s.state.economy.treasury).toBeLessThanOrEqual(t0);
  });

  it('difficulté : trésorerie initiale, dotations et capacité d\'emprunt', () => {
    expect(Object.fromEntries(Object.entries(DIFFICULTIES).map(([k, d]) => [k, d.treasury]))).toEqual({ easy: 550000, normal: 380000, hard: 300000 });
    const s = newSession();
    expect(s.state.economy.treasury).toBe(380000 * 100);
    const capNormal = s.sim.economy.debtCapacity(s.state);
    applyDifficulty(s.state, 'hard');
    expect(s.state.economy.treasury).toBe(300000 * 100);
    expect(s.sim.economy.debtCapacity(s.state)).toBe(Math.round(capNormal * 0.7));
    const t0 = s.state.economy.treasury;
    s.state.stats.peakPopulation = 600;
    s.run(1);
    expect(s.state.economy.treasury - t0).toBe(30000 * 100);
  });
});

describe('v1.0 — rééquilibrage économique', () => {
  it('charges de structure : rien sous 4 000 habitants, 9 € par habitant à partir de 40 000', () => {
    expect(structureEuros(3999)).toBe(0);
    expect(structureEuros(40000)).toBeCloseTo(360000, 6);
    expect(structureEuros(80000)).toBeCloseTo(720000, 6);
    let prev = 0;
    for (let p = 4000; p <= 60000; p += 2000) {
      const v = structureEuros(p) / p;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('la clôture mensuelle comptabilise la structure ; voirie au tarif v1.0', () => {
    const s = flatSession({ unlockAll: false });
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 26, y: 15 } });
    s.state.stats.population = 20000;
    const p = s.sim.economy.closeMonth(s.state);
    expect(p.opex.structure).toBe(Math.round(structureEuros(20000) * 100 * (s.state.modifiers['upkeep.structure'] ?? 1)));
    const roads = 24 * 150;
    expect(p.opex.roads).toBe(Math.round(roads * (s.state.modifiers['upkeep.roads'] ?? 1)));
  });

  it('le copilote budgétaire réduit les charges de structure', () => {
    const s = newSession();
    s.state.stats.peakPopulation = 3000;
    s.state.stats.population = 30000;
    s.sim.ai.refreshModifiers(s.state);
    const before = structureCents(s.state);
    expect(s.execute({ type: 'research', techId: 'municipal_copilot' }).ok).toBe(true);
    s.sim.ai.refreshModifiers(s.state);
    expect(structureCents(s.state) / before).toBeCloseTo(0.95, 3);
  });

  it('taux d\'épargne brute', () => {
    expect(savingsRate({ revenues: 1000, operatingResult: 200 })).toBeCloseTo(0.2);
    expect(savingsRate({ revenues: 0, operatingResult: 0 })).toBeNull();
  });
});

describe('v1.0 — anciennes parties', () => {
  it('une sauvegarde v5 garde l\'ancien équilibrage, ses paliers sont acquis sans dotation', () => {
    const s = newSession();
    s.state.stats.peakPopulation = 6200;
    const v5 = structuredClone(serializeState(s.state));
    v5.formatVersion = 5;
    delete v5.milestones;
    delete v5.options.balance;
    delete v5.options.difficulty;
    const { data, applied } = migrate(v5);
    expect(applied).toEqual([5, 6]);
    expect(data.options.balance).toBe('legacy');
    expect(data.milestones).toEqual({ granted: 3, announced: 3 });
    const st = deserializeState(v5);
    const g = new GameSession({ catalog: getCatalog(), state: st });
    expect(balancePhase(st)).toBe(0);
    expect(roadUpkeepFactor(st)).toBeCloseTo(0.4);
    st.stats.population = 30000;
    expect(structureCents(st)).toBe(0);
    const t0 = st.economy.treasury;
    st.stats.peakPopulation = 16000;
    g.run(1);
    expect(st.milestones.announced).toBe(4);
    expect(st.economy.treasury).toBe(t0);
  });

  it('bascule vers l\'équilibrage v1.0 : progressive sur 24 mois et définitive', () => {
    const s = newSession();
    const st = s.state;
    st.options.balance = 'legacy';
    expect(s.execute({ type: 'option', key: 'balance', value: 'v1' }).ok).toBe(true);
    expect(st.options.balance).toBe('v1');
    expect(balancePhase(st)).toBe(0);
    st.time.tick += 12 * 30;
    expect(balancePhase(st)).toBeCloseTo(0.5);
    expect(roadUpkeepFactor(st)).toBeCloseTo(0.7);
    st.time.tick += 24 * 30;
    expect(balancePhase(st)).toBe(1);
    expect(s.execute({ type: 'option', key: 'balance', value: 'v1' }).ok).toBe(false);
    // Rechargement : même phase
    const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
    expect(balancePhase(back)).toBe(1);
  });
});

describe('v1.0 — ères', () => {
  it('ère 2 à 10 000 habitants, ère 3 à 30 000', () => {
    const s = newSession();
    const ev = s.sim.progression.evaluate(s.state);
    expect(ev.next.requires[0].label).toBe('10 000 habitants');
    s.state.progression.era = 2;
    expect(s.sim.progression.evaluate(s.state).next.requires[0].label).toBe('30 000 habitants');
  });

  it('une nouvelle partie démarre en v1.0, sans dotation de départ, et toMonthEnd reste stable', () => {
    const s = newSession();
    expect(s.state.options.balance).toBe('v1');
    expect(s.state.milestones).toEqual({ granted: 0, announced: 0 });
    toMonthEnd(s);
    expect(s.state.economy.periods.at(-1).opex.structure).toBeUndefined();
  });
});
