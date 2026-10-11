import { describe, it, expect } from 'vitest';
import { newSession, flatSession, spawn, getCatalog } from '../helpers/session.js';
import { buildStarterTown } from '../../src/app/scenarios.js';
import { WeatherSystem, defaultWeather, weatherEffects } from '../../src/simulation/WeatherSystem.js';
import { computeModifiers } from '../../src/simulation/Modifiers.js';
import { CRISIS_KINDS, responseCost } from '../../src/simulation/CrisisSystem.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { migrate } from '../../src/persistence/SaveMigration.js';
import { GameSession } from '../../src/app/GameSession.js';
import { CHALLENGES, setupChallenge } from '../../src/app/challenges.js';
import { evaluateGoal } from '../../src/simulation/ScenarioSystem.js';

describe('Météo et saisons', () => {
  it('est déterministe, saisonnière et sans effet sur le générateur aléatoire de la partie', () => {
    const run = () => {
      const st = { meta: { seed: 77 }, time: { tick: 0 }, events: { active: [] }, dirty: {}, weather: defaultWeather() };
      const ws = new WeatherSystem();
      const kinds = {};
      const winter = { snow: 0 };
      for (let t = 1; t <= 720; t++) {
        st.time.tick = t;
        ws.daily(st);
        kinds[st.weather.kind] = (kinds[st.weather.kind] ?? 0) + 1;
        const m = Math.floor(t / 30) % 12;
        if (st.weather.kind === 'snow') {
          expect([11, 0, 1, 2]).toContain(m);
          winter.snow++;
        }
        if (st.weather.kind === 'heat') expect([5, 6, 7]).toContain(m);
      }
      return { kinds, temp: st.weather.temp, winter };
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(Object.keys(a.kinds).length).toBeGreaterThanOrEqual(5);
    expect(a.winter.snow).toBeGreaterThan(0);
  });

  it('la neige ralentit les routes et coûte du déneigement ; la chaleur fait grimper la demande', () => {
    const s = newSession();
    const st = s.state;
    st.weather = { ...defaultWeather(), kind: 'snow', intensity: 1, temp: -2 };
    const snow = computeModifiers(st, getCatalog());
    st.weather = { ...defaultWeather(), kind: 'clear', intensity: 0.5, temp: 15 };
    const clear = computeModifiers(st, getCatalog());
    expect(snow.roadCapacityMult).toBeLessThan(clear.roadCapacityMult);
    expect(snow['upkeep.roads']).toBeGreaterThan(clear['upkeep.roads']);
    expect(snow.powerDemandMult).toBeGreaterThan(clear.powerDemandMult);
    expect(weatherEffects({ kind: 'heat', intensity: 1, temp: 35 }).some((e) => e.key === 'waterDemandMult')).toBe(true);
  });

  it('une partie rechargée retrouve exactement la même météo et les mêmes crises', () => {
    const s = newSession();
    buildStarterTown(s);
    s.state.crises.graceUntil = 0;
    s.state.options.disasters = 'frequent';
    s.run(400);
    const copy = new GameSession({ catalog: getCatalog(), state: deserializeState(JSON.parse(JSON.stringify(serializeState(s.state)))) });
    s.run(300);
    copy.run(300);
    expect(serializeState(copy.state).weather).toEqual(serializeState(s.state).weather);
    expect(copy.state.crises).toEqual(s.state.crises);
    expect(copy.state.economy.treasury).toBe(s.state.economy.treasury);
  });
});

describe('Catastrophes et crises', () => {
  it('chaque type de crise se déclenche dans une ville équipée, a deux réponses et se termine', () => {
    const s = newSession();
    buildStarterTown(s, { size: 'large' });
    s.run(200);
    s.execute({ type: 'debug', op: 'unlock', population: 5000 });
    s.execute({ type: 'research', techId: 'predictive_maintenance' });
    s.execute({ type: 'research', techId: 'ai_waste' });
    const results = {};
    for (const kind of CRISIS_KINDS) {
      const r = s.execute({ type: 'triggerDisaster', kind });
      results[kind] = r.ok ? 'ok' : r.reason;
    }
    // Inondation et grève dépendent de la géographie et du réseau : les autres doivent toujours partir
    expect(results.heat).toBe('ok');
    expect(results.cyber).toBe('ok');
    expect(results.blackout).toBe('ok');
    expect(results.fire).toBe('ok');
    const active = s.state.crises.active;
    expect(active.length).toBeGreaterThanOrEqual(4);
    // Cyberattaque : toutes les technologies à l'arrêt ; panne géante : centrales arrêtées
    expect(Object.keys(s.state.tech.outages).length).toBe(Object.keys(s.state.tech.researched).length);
    const blackout = active.find((c) => c.kind === 'blackout');
    expect(blackout.buildings.every((id) => s.state.buildings.get(id).disabledUntil > s.state.time.tick)).toBe(true);
    // Réponse payante : débit au journal, une seule décision possible
    const cyber = active.find((c) => c.kind === 'cyber');
    const before = s.state.economy.treasury;
    expect(s.execute({ type: 'crisisResponse', crisisId: cyber.id, option: 'ransom' }).ok).toBe(true);
    expect(s.state.economy.treasury).toBe(before - responseCost(s.state, cyber, 'ransom') * 100);
    expect(s.execute({ type: 'crisisResponse', crisisId: cyber.id, option: 'restore' }).ok).toBe(false);
    s.run(90);
    expect(s.state.crises.active.length).toBe(0);
    expect(s.state.crises.history.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(s.state.tech.outages).length).toBe(0);
    expect(s.state.crises.ransomsPaid).toBe(1);
  });

  it('un incendie se propage moins là où les pompiers sont proches', () => {
    const burnt = (withStation) => {
      const s = flatSession({ width: 30, height: 30 });
      s.state.options.disasters = 'normal';
      for (let x = 3; x < 27; x++) s.execute({ type: 'road', roadId: 'road_street', from: { x, y: 15 }, to: { x, y: 15 } });
      for (let y = 8; y < 23; y++) for (let x = 8; x < 22; x++) if (y !== 15) spawn(s, 'res_low_1', x, y, { residents: 3 });
      // Couverture incendie complète (caserne voisine) ou nulle
      s.state.grid.coverFire.fill(withStation ? 1 : 0);
      s.state.crises.graceUntil = 0;
      s.execute({ type: 'triggerDisaster', kind: 'fire' });
      for (let k = 0; k < 40; k++) {
        s.sim.crises.daily(s.state);
        s.state.time.tick++;
      }
      return s.state.crises.history[0]?.summary ?? s.state.crises.active[0]?.burnt?.length;
    };
    const parse = (v) => (typeof v === 'string' ? Number(v.match(/(\d+) bâtiment/)?.[1] ?? 0) : v ?? 0);
    expect(parse(burnt(true))).toBeLessThanOrEqual(parse(burnt(false)));
  });

  it('aucune crise aléatoire quand les catastrophes sont désactivées', () => {
    const s = newSession();
    buildStarterTown(s, { size: 'large' });
    s.state.options.disasters = 'off';
    s.state.crises.graceUntil = 0;
    s.run(720);
    expect(s.state.crises.total).toBe(0);
  });
});

describe('Scénarios', () => {
  it('chaque scénario démarre avec des objectifs non atteints et une échéance', () => {
    for (const c of CHALLENGES) {
      const s = GameSession.newGame({ catalog: getCatalog(), seed: c.seed ?? 99, width: c.size, height: c.size, name: c.name });
      setupChallenge(s, c.id);
      const sc = s.state.scenario;
      expect(sc.status).toBe('active');
      expect(sc.deadlineTick).toBe(sc.startTick + c.years * 360);
      expect(sc.goals.length).toBeGreaterThanOrEqual(3);
      expect(sc.goals.some((g) => !evaluateGoal(s.state, g).ok)).toBe(true);
      expect(s.state.options.disasters).toBe(c.disasters);
    }
  }, 120_000);

  it('victoire quand tous les objectifs sont atteints, échec à l\'échéance', () => {
    const s = newSession();
    setupChallenge(s, 'symbiose');
    const sc = s.state.scenario;
    let ended = null;
    s.bus.on('scenario:ended', (e) => (ended = e.scenario.status));
    // Objectifs rendus atteignables artificiellement : victoire à la fin du mois suivant
    sc.goals = [{ id: 'ok', metric: 'population', op: '>=', target: 0, label: 'test' }];
    s.run(30);
    expect(s.state.scenario.status).toBe('won');
    expect(ended).toBe('won');

    const t = newSession();
    setupChallenge(t, 'symbiose');
    t.state.scenario.deadlineTick = t.state.time.tick + 30;
    t.run(30);
    expect(t.state.scenario.status).toBe('lost');
  });
});

describe('Sauvegardes v5', () => {
  it('une sauvegarde v4 est migrée : météo neutre, catastrophes désactivées, pas de scénario', () => {
    const s = newSession();
    const v4 = structuredClone(serializeState(s.state));
    v4.formatVersion = 4;
    delete v4.weather;
    delete v4.crises;
    delete v4.scenario;
    delete v4.options;
    const { data, applied } = migrate(v4);
    expect(applied).toEqual([4]);
    expect(data.options.disasters).toBe('off');
    expect(data.crises.active).toEqual([]);
    const back = deserializeState(v4);
    expect(back.scenario).toBeNull();
    expect(back.weather.kind).toBe('cloudy');
  });
});
