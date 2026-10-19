import { describe, it, expect } from 'vitest';
import { flatSession, newSession, spawn, getCatalog } from '../helpers/session.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { parcelPrice, defaultLand } from '../../src/world/Land.js';
import { EconomySystem } from '../../src/simulation/EconomySystem.js';
import { computeModifiers } from '../../src/simulation/Modifiers.js';
import { exitsBySide } from '../../src/systems/ConstructionService.js';
import { TERRAIN } from '../../src/world/Terrain.js';
import { checkInvariants } from '../../src/debug/Invariants.js';

const reload = (state, patch) => {
  const raw = JSON.parse(JSON.stringify(serializeState(state)));
  patch?.(raw);
  return deserializeState(raw);
};

describe('v1.4 — construire sur des bâtiments de zone', () => {
  it('un parc posé sur des maisons les démolit (frais compris), et « Annuler » rétablit tout', () => {
    const s = flatSession();
    const g = s.state.grid;
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
    s.execute({ type: 'zone', zoneId: 'R_LOW', rect: { x0: 8, y0: 16, x1: 11, y1: 17 } });
    const a = spawn(s, 'res_low_1', 8, 16, { residents: 4 });
    const b = spawn(s, 'res_low_1', 9, 16, { residents: 3 });
    const keep = spawn(s, 'res_low_1', 11, 16, { residents: 2 });
    const park = s.catalog.building('park');
    // Les scénarios (placeNear) ne démolissent jamais : keepZoned
    expect(s.preview({ type: 'building', defId: 'park', x: 8, y: 16, keepZoned: true }).reasons).toContain('occupied');
    const pv = s.preview({ type: 'building', defId: 'park', x: 8, y: 16 });
    expect(pv.ok).toBe(true);
    expect(pv.replaced.sort()).toEqual([a.id, b.id].sort());
    expect(pv.residents).toBe(7);
    expect(pv.demolition).toBe(s.sim ? s.construction.demolitionCost(a) * 2 : 0);
    expect(pv.cost).toBe(park.costCents + pv.works + pv.demolition);
    const treasury = s.state.economy.treasury;
    const r = s.execute({ type: 'building', defId: 'park', x: 8, y: 16 });
    expect(r.ok).toBe(true);
    expect(s.state.economy.treasury).toBe(treasury - pv.cost);
    expect(s.state.buildings.has(a.id)).toBe(false);
    expect(s.state.buildings.has(keep.id)).toBe(true);
    expect(g.building[g.idx(8, 16)]).toBe(r.building.id);
    expect(checkInvariants(s.state, s.catalog)).toEqual([]);
    expect(s.execute({ type: 'undo' }).ok).toBe(true);
    expect(s.state.economy.treasury).toBe(treasury);
    expect(s.state.buildings.get(a.id).residents).toBe(4);
    expect(g.building[g.idx(9, 16)]).toBe(b.id);
    expect(checkInvariants(s.state, s.catalog)).toEqual([]);
  });

  it('un équipement public ou une route bloque toujours la pose', () => {
    const s = flatSession();
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
    expect(s.execute({ type: 'building', defId: 'park_small', x: 8, y: 16 }).ok).toBe(true);
    const pv = s.preview({ type: 'building', defId: 'park_small', x: 8, y: 16 });
    expect(pv.ok).toBe(false);
    expect(pv.reasons).toContain('occupied');
  });
});

describe('v1.4 — lignes électriques', () => {
  it('ne sont plus constructibles ni proposées dans les menus', () => {
    const s = flatSession();
    const plops = [...s.catalog.plopsByCategory().values()].flat().map((d) => d.id);
    expect(plops).not.toContain('power_line');
    expect(plops).not.toContain('power_nuclear_legacy');
    expect(s.preview({ type: 'building', defId: 'power_line', x: 8, y: 20 }).ok).toBe(false);
  });

  it('une ancienne partie perd ses pylônes inutiles et garde ceux qui relient deux réseaux', () => {
    const s = flatSession({ width: 40, height: 30 });
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 12, y: 15 } });
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 20, y: 15 }, to: { x: 30, y: 15 } });
    // Chaîne utile : de x = 13 à 19, entre les deux tronçons de rue
    const bridge = [];
    for (let x = 13; x <= 19; x++) bridge.push(spawn(s, 'power_line', x, 15));
    // Chaîne inutile : collée à la rue d'un seul réseau
    const useless = [spawn(s, 'power_line', 5, 16), spawn(s, 'power_line', 5, 17)];
    const lone = spawn(s, 'power_line', 35, 5);
    const back = reload(s.state, (raw) => {
      raw.formatVersion = 6;
    });
    for (const b of bridge) expect(back.buildings.has(b.id)).toBe(true);
    for (const b of [...useless, lone]) expect(back.buildings.has(b.id)).toBe(false);
    expect(back.grid.building[back.grid.idx(5, 16)]).toBe(0);
    expect(back.loadNotes[0]).toMatch(/3 lignes électriques inutiles retirées/);
    // Une partie au format courant n'est pas retouchée
    expect(reload(s.state).buildings.has(lone.id)).toBe(true);
  });
});

describe('v1.4 — centrales 8 × 8 et anciennes générations', () => {
  it('nucléaire et fusion : 8 × 8, production × 5, prix × 2', () => {
    const c = getCatalog();
    for (const [id, legacy] of [['power_nuclear', 'power_nuclear_legacy'], ['power_fusion', 'power_fusion_legacy']]) {
      const d = c.building(id);
      const l = c.building(legacy);
      expect(d.footprint).toEqual({ w: 8, h: 8 });
      expect(d.capacity.powerOutput).toBe(l.capacity.powerOutput * 5);
      expect(d.costCents).toBe(l.costCents * 2);
      expect(d.placement.autoLevel).toBe(true);
      expect(l.hidden).toBe(true);
    }
  });

  it('une centrale d\'une sauvegarde v6 devient « ancienne génération » et garde son emprise', () => {
    const s = flatSession({ width: 40, height: 30 });
    const old = spawn(s, 'power_nuclear_legacy', 10, 18);
    const back = reload(s.state, (raw) => {
      raw.formatVersion = 6;
      raw.buildings.find((b) => b.id === old.id).defId = 'power_nuclear';
    });
    const b = back.buildings.get(old.id);
    expect(b.defId).toBe('power_nuclear_legacy');
    expect([b.w, b.h]).toEqual([4, 4]);
  });
});

describe('v1.4 — améliorations par niveaux', () => {
  it('chaque centrale a au moins deux nouveaux niveaux qui doublent sa production', () => {
    const c = getCatalog();
    const plants = [...c.buildings.values()].filter((d) => d.capacity.powerOutput && d.kind === 'plop');
    expect(plants.length).toBeGreaterThanOrEqual(8);
    for (const d of plants) {
      const track = c.upgradeTracks(d.id).find((t) => t.track === 'power');
      expect(track, d.id).toBeDefined();
      const added = track.levels.filter((u) => !['gas_combined', 'solar_trackers', 'wind_large'].includes(u.id));
      expect(added.length, d.id).toBeGreaterThanOrEqual(2);
      const mult = added.reduce((m, u) => m * u.effects.powerOutput, 1);
      expect(mult, d.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('un niveau demande le précédent ; la production double avec les deux nouveaux niveaux', () => {
    const s = flatSession();
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
    const plant = s.execute({ type: 'building', defId: 'power_gas', x: 8, y: 16 }).building;
    const base = s.catalog.buildingFor(plant).capacity.powerOutput;
    const pv = s.preview({ type: 'upgrade', buildingId: plant.id, upgradeId: 'gas_turbines' });
    expect(pv.ok).toBe(false);
    expect(pv.messages[0]).toMatch(/Installez d'abord « Centrale à cycle combiné »|Installez d'abord/);
    for (const id of ['gas_combined', 'gas_turbines', 'gas_hydrogen']) expect(s.execute({ type: 'upgrade', buildingId: plant.id, upgradeId: id }).ok, id).toBe(true);
    const out = s.catalog.buildingFor(plant).capacity.powerOutput;
    expect(out / (base * 1.3)).toBeCloseTo(2, 1);
    expect(s.catalog.upgradeTracks('police').find((t) => t.track === 'police').levels.map((u) => u.level)).toEqual([1, 2, 3]);
  });
});

describe('v1.4 — technologies de services urbains', () => {
  const NEW = ['smart_grid', 'superconducting_grid', 'smart_water', 'water_reuse', 'robot_sorting', 'molecular_recycling', 'adaptive_learning', 'immersive_campus'];

  it('deux niveaux par domaine (ère 2 puis ère 3), +30 % chacun', () => {
    const c = getCatalog();
    for (const id of NEW) expect(c.techById.get(id), id).toBeDefined();
    for (const track of ['power', 'water', 'waste', 'education']) {
      const lv = c.technologies.filter((t) => t.track === track).sort((a, b) => a.level - b.level);
      expect(lv.map((t) => t.unlock.era)).toEqual([2, 3]);
      expect(lv[1].unlock.tech).toBe(lv[0].id);
      for (const t of lv) for (const e of t.effects.filter((x) => !x.side)) expect(e.value).toBe(0.3);
    }
  });

  it('ère et prérequis contrôlés ; les modificateurs s\'appliquent', () => {
    const s = newSession();
    s.state.economy.treasury = 1e10;
    s.state.stats.peakPopulation = 50000;
    s.state.progression.era = 1;
    expect(s.sim.ai.canResearch(s.state, 'smart_grid').ok).toBe(false);
    s.state.progression.era = 2;
    expect(s.sim.ai.canResearch(s.state, 'smart_grid').ok).toBe(true);
    expect(s.sim.ai.canResearch(s.state, 'superconducting_grid').ok).toBe(false);
    for (const id of NEW) s.state.tech.researched[id] = 0;
    // Calcul illimité pour le test : seuls les effets comptent
    s.state.stats.peakPopulation = 1e6;
    const m = computeModifiers(s.state, s.catalog);
    const r = m.compute.ratio;
    expect(m['power.outputMult']).toBeCloseTo((1 + 0.3 * r) ** 2, 5);
    expect(m['water.outputMult']).toBeCloseTo((1 + 0.3 * r) ** 2, 5);
    expect(m['waste.processMult']).toBeCloseTo((1 + 0.3 * r) ** 2, 5);
    expect(m['education.mult']).toBeCloseTo((1 + 0.3 * r) ** 2, 5);
  });

  it('la production des centrales suit le réseau intelligent', () => {
    const s = flatSession();
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
    const plant = s.execute({ type: 'building', defId: 'power_solar', x: 8, y: 16 }).building;
    s.sim.utilities.update(s.state);
    const before = plant.output;
    s.state.modifiers['power.outputMult'] = 1.3;
    s.sim.utilities.update(s.state);
    expect(plant.output).toBeCloseTo(before * 1.3, 5);
  });
});

describe('v1.4 — prix des extensions', () => {
  it('10 extensions à prix fixe croissant, puis prix fondé sur l\'épargne', () => {
    const s = flatSession();
    s.state.land = defaultLand(30, 30);
    const prices = [];
    for (let n = 0; n < 12; n++) {
      s.state.land.purchases = n;
      prices.push(parcelPrice(s.state, EconomySystem.summarize) / 100);
    }
    expect(prices.slice(0, 10)).toEqual([400000, 600000, 800000, 1000000, 1200000, 1400000, 1600000, 1800000, 2000000, 2200000]);
    expect(prices[10]).toBeGreaterThanOrEqual(2400000);
    expect(prices[11]).toBe(Math.round((prices[10] * 1.2) / 100) * 100);
  });
});

describe('v1.4 — sorties d\'autoroute sur les quatre côtés', () => {
  function city() {
    const s = newSession({ width: 96, height: 96 });
    s.state.economy.treasury = 1e10;
    s.state.economy.opening = 1e10;
    s.state.stats.peakPopulation = 20000;
    const g = s.state.grid;
    const row = g.yOf(s.state.entries[0]);
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: row }, to: { x: 60, y: row } });
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 40, y: 20 }, to: { x: 40, y: 75 } });
    return s;
  }

  it('déblocage au statut Grande ville', () => {
    const s = city();
    s.state.stats.peakPopulation = 6000;
    expect(s.preview({ type: 'exit', side: 'E' }).ok).toBe(false);
  });

  it('une sortie par côté, la moins chère ; le nord se franchit en pont jusqu\'au bord', () => {
    const s = city();
    const g = s.state.grid;
    for (const side of ['E', 'S', 'N']) {
      const pv = s.preview({ type: 'exit', side });
      expect(pv.ok, `${side} : ${pv.messages}`).toBe(true);
      const r = s.execute({ type: 'exit', side });
      expect(r.ok, side).toBe(true);
      expect(exitsBySide(s.state)[side]).toHaveLength(1);
    }
    expect(s.state.entries).toHaveLength(4);
    const north = exitsBySide(s.state).N[0];
    // Bord nord en partie sur l'eau : la sortie peut finir en pont
    expect(g.road[north]).toBe(s.catalog.road('road_motorway').code);
    expect(checkInvariants(s.state, s.catalog)).toEqual([]);
    s.sim.network.rebuild?.(s.state);
    s.run(10);
    expect(s.state.entries).toHaveLength(4);
  });

  it('seule l\'autoroute de sortie peut finir en pont au bord de la carte', () => {
    const s = city();
    const g = s.state.grid;
    let x = -1;
    for (let k = 0; k < g.width && x < 0; k++) if (g.terrain[g.idx(k, 0)] === TERRAIN.WATER && g.terrain[g.idx(k, 6)] !== TERRAIN.WATER) x = k;
    expect(x).toBeGreaterThanOrEqual(0);
    let y = 0;
    while (g.terrain[g.idx(x, y)] === TERRAIN.WATER) y++;
    const street = s.preview({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x, y: 0 } });
    expect(street.ok).toBe(false);
    const mw = s.preview({ type: 'road', roadId: 'road_motorway', from: { x, y }, to: { x, y: 0 } });
    expect(mw.reasons).not.toContain('bridgeEnds');
  });
});

describe('v1.4 — bourg existant près d\'une rivière', () => {
  it('l\'axe principal franchit une rivière étroite et le maire hérite d\'au moins 60 000 €', async () => {
    const { GameSession } = await import('../../src/app/GameSession.js');
    const { buildStarterTown, placeNear, ensureStartingCash } = await import('../../src/app/scenarios.js');
    const { applyDifficulty } = await import('../../src/simulation/Milestones.js');
    // Graines où une rivière coupait l'axe à quelques cases de l'autoroute (bourg vide auparavant)
    for (const seed of [1005, 1010]) {
      const session = GameSession.newGame({ catalog: getCatalog(), seed, width: 64, height: 64, name: 'T' });
      applyDifficulty(session.state, 'normal');
      session.state.meta.preparing = true;
      const town = buildStarterTown(session, { size: 'small' });
      expect(town.xEnd, `graine ${seed}`).toBeGreaterThan(20);
      expect([...session.state.grid.bridge].some((v) => v > 0), `graine ${seed}`).toBe(true);
      session.run(120);
      for (const id of ['police', 'fire', 'school', 'clinic']) placeNear(session, id, town.xEnd - 6, town.row - 2);
      session.run(240);
      ensureStartingCash(session);
      expect(session.state.stats.population, `graine ${seed}`).toBeGreaterThan(300);
      expect(session.state.economy.treasury).toBeGreaterThanOrEqual(60000_00);
      expect(checkInvariants(session.state, session.catalog)).toEqual([]);
    }
  });
});
