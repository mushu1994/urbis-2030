import { describe, it, expect } from 'vitest';
import { flatSession, newSession, spawn, getCatalog } from '../helpers/session.js';
import { buildStarterTown } from '../../src/app/scenarios.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { MapMirror, T3, catalog3d, facingOf, waterSideOf, visualStateOf, nightOf, activeTechs, constructionDays, DIRS } from '../../src/rendering3d/Adapter3D.js';
import { CrimeSystem, crimeOf, crimeKind, defaultCrime, CRIME_MEMORY_DAYS } from '../../src/simulation/CrimeSystem.js';
import { RECOVERY_DAYS } from '../../src/simulation/CrisisSystem.js';
import { SCALAR_KEYS, SnapshotEncoder, SnapshotDecoder } from '../../src/app/SimSync.js';
import { GameSession } from '../../src/app/GameSession.js';
import { EventBus } from '../../src/app/EventBus.js';
import { nightAt } from '../../src/rendering/EffectsRenderer.js';
import { TERRAIN } from '../../src/world/Terrain.js';
import { checkInvariants } from '../../src/debug/Invariants.js';
import { THREE, setCatalog, buildGroup } from '../../src/rendering3d/Engine3D.js';

const TERR = { [TERRAIN.GRASS]: T3.GRASS, [TERRAIN.WATER]: T3.WATER, [TERRAIN.FOREST]: T3.FOREST, [TERRAIN.SAND]: T3.SAND, [TERRAIN.ROCK]: T3.ROCK };

/** Bourg de départ, comme le menu « Départ : bourg existant ». */
function town() {
  const s = newSession({ width: 64, height: 64 });
  s.state.meta.preparing = true;
  buildStarterTown(s, { size: 'small' });
  s.run(60);
  delete s.state.meta.preparing;
  return s;
}

/** Empreinte d'un état sérialisé (pour vérifier que la vue 3D ne modifie rien). */
const fingerprint = (state) => {
  const d = serializeState(state);
  delete d.meta.createdAt; // date de création (horloge réelle), propre à chaque session
  return JSON.stringify(d);
};

/** Le miroir correspond-il exactement à l'état ? (liste des écarts) */
function mirrorDiff(mirror, state) {
  const m = mirror.map;
  const g = state.grid;
  const out = [];
  for (let i = 0; i < g.size; i++) {
    if (m.terr[i] !== TERR[g.terrain[i]]) out.push(`terr ${i}`);
    if (m.alt[i] !== Math.max(0, g.altitude[i] - 1)) out.push(`alt ${i}`);
    if (m.road[i] !== g.road[i]) out.push(`road ${i}`);
    if (m.rail[i] !== g.rail[i]) out.push(`rail ${i}`);
    if (m.zone[i] !== g.zone[i]) out.push(`zone ${i}`);
    if (m.occ[i] !== (g.building[i] || -1)) out.push(`occ ${i}`);
    if (out.length > 10) break;
  }
  if (m.buildings.length !== state.buildings.size) out.push(`buildings ${m.buildings.length}/${state.buildings.size}`);
  for (const b of state.buildings.values()) {
    const o = m.byId.get(b.id);
    if (!o) {
      out.push(`missing ${b.id}`);
      continue;
    }
    if (o.x !== b.x || o.z !== b.y || o.w !== b.w || o.h !== b.h) out.push(`footprint ${b.id}`);
    const vs = visualStateOf(state, b, getCatalog());
    if (o.def.id !== vs.defId || (o.state ?? null) !== (vs.state ?? null)) out.push(`state ${b.id} ${o.def.id}/${vs.defId} ${o.state}/${vs.state}`);
    if (o.rot !== facingOf(state, b, vs.defId)) out.push(`facing ${b.id}`);
    if ([...o.ups].sort().join() !== [...(b.upgrades ?? [])].sort().join()) out.push(`ups ${b.id}`);
  }
  return out;
}

describe('v1.5 — vue 3D : catalogue et miroir de la carte', () => {
  it('le catalogue 3D reprend tous les bâtiments, routes, améliorations et technologies du jeu', () => {
    const c = getCatalog();
    const c3 = catalog3d(c);
    expect(c3.b.length).toBe(c.buildings.size);
    expect(c3.b.length).toBe(119);
    for (const d of c.buildings.values()) {
      const o = c3.byId.get(d.id);
      expect(o, d.id).toBeTruthy();
      expect([o.w, o.h]).toEqual([d.footprint.w, d.footprint.h]);
      expect(o.cat).toBe(d.category);
      expect(o.v).toBe(d.visual);
    }
    // les codes de route du jeu (index + 1) désignent le même type de route en 3D
    expect(c3.roads.map((r) => r.id)).toEqual(c.roads.map((r) => r.id));
    expect(c3.ups.map((u) => u.id)).toEqual(c.upgrades.map((u) => u.id));
    expect(c3.techs.map((t) => t.id)).toEqual(c.technologies.map((t) => t.id));
  });

  it('la carte 3D est une copie fidèle de la partie (cases, routes, bâtiments, emprises)', () => {
    const s = town();
    const mirror = new MapMirror(s.catalog);
    const map = mirror.build(s.state);
    expect([map.W, map.H]).toEqual([s.state.grid.width, s.state.grid.height]);
    expect(mirrorDiff(mirror, s.state)).toEqual([]);
    // l'occupation des cases correspond exactement aux emprises des bâtiments
    for (const b of map.buildings) {
      for (let z = b.z; z < b.z + b.h; z++) for (let x = b.x; x < b.x + b.w; x++) expect(map.occ[map.idx(x, z)]).toBe(b.id);
    }
  });

  it('la façade d\'un bâtiment donne sur sa route d\'accès', () => {
    const s = town();
    let checked = 0;
    for (const b of s.state.buildings.values()) {
      // gare et tube : façade (quais) toujours sur un grand côté
      if (b.access < 0 || b.defId === 'train_station' || b.defId === 'hyperloop') continue;
      const d = facingOf(s.state, b);
      const [dx, dz] = DIRS[d];
      const g = s.state.grid;
      const ax = g.xOf(b.access);
      const ay = g.yOf(b.access);
      // la case d'accès est du côté de la façade quand elle touche l'emprise
      const touching = (ax >= b.x && ax < b.x + b.w && (ay === b.y - 1 || ay === b.y + b.h)) || (ay >= b.y && ay < b.y + b.h && (ax === b.x - 1 || ax === b.x + b.w));
      if (!touching) continue;
      checked++;
      if (dx) expect(dx > 0 ? ax === b.x + b.w : ax === b.x - 1, `bâtiment ${b.id}`).toBe(true);
      else expect(dz > 0 ? ay === b.y + b.h : ay === b.y - 1, `bâtiment ${b.id}`).toBe(true);
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('un équipement au bord de l\'eau connaît le côté de la rive', () => {
    const s = flatSession();
    const g = s.state.grid;
    for (let y = 0; y < g.height; y++) for (let x = 24; x < 30; x++) {
      g.terrain[g.idx(x, y)] = TERRAIN.WATER;
      g.altitude[g.idx(x, y)] = 0;
    }
    const b = spawn(s, 'marina', 22, 8);
    expect(waterSideOf(s.state, b)).toBe(1); // est
    const mirror = new MapMirror(s.catalog);
    const map = mirror.build(s.state);
    expect(map.byId.get(b.id).water).toBe(1);
    expect(map.terr[map.idx(25, 3)]).toBe(T3.WATER);
  });

  it('la mise à jour par différences reste identique à une reconstruction complète, tout au long d\'une partie', () => {
    const s = town();
    const mirror = new MapMirror(s.catalog);
    mirror.build(s.state);
    let changes = 0;
    for (let step = 0; step < 8; step++) {
      // actions du joueur et évolution de la ville
      if (step === 1) s.execute({ type: 'road', roadId: 'road_street', from: { x: 30, y: 40 }, to: { x: 40, y: 40 } });
      if (step === 2) s.execute({ type: 'zone', zoneId: 'R_LOW', rect: { x0: 31, y0: 41, x1: 38, y1: 42 } });
      if (step === 3) {
        const b = [...s.state.buildings.values()].find((o) => s.catalog.building(o.defId).kind === 'growable');
        s.execute({ type: 'demolish', rect: { x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 } });
      }
      s.run(30);
      const ch = mirror.sync(s.state);
      changes += (ch.tiles?.size ?? 0) + ch.changed.length + ch.removed.length;
      expect(mirrorDiff(mirror, s.state)).toEqual([]);
    }
    expect(changes).toBeGreaterThan(0);
    const fresh = new MapMirror(s.catalog);
    fresh.build(s.state);
    for (const k of ['terr', 'alt', 'road', 'rail', 'tram', 'bridge', 'zone', 'occ']) expect(Array.from(mirror.map[k])).toEqual(Array.from(fresh.map[k]));
  });

  it('la vue 3D ne modifie jamais la partie (lecture seule)', () => {
    const s = town();
    s.sim.crises.trigger(s.state, 'fire', { manual: true });
    const before = fingerprint(s.state);
    const rng = s.state.rng.state;
    const mirror = new MapMirror(s.catalog);
    mirror.build(s.state);
    for (let k = 0; k < 5; k++) mirror.sync(s.state);
    activeTechs(s.state);
    for (const b of s.state.buildings.values()) {
      facingOf(s.state, b);
      waterSideOf(s.state, b);
      visualStateOf(s.state, b, s.catalog);
    }
    expect(fingerprint(s.state)).toBe(before);
    expect(s.state.rng.state).toBe(rng);
    expect(checkInvariants(s.state, s.catalog)).toEqual([]);
  });

  it('une simulation donne le même résultat avec ou sans miroir 3D (déterminisme)', () => {
    const a = town();
    const b = town();
    const mirror = new MapMirror(b.catalog);
    mirror.build(b.state);
    for (let k = 0; k < 6; k++) {
      a.run(20);
      b.run(20);
      mirror.sync(b.state);
    }
    expect(fingerprint(b.state)).toBe(fingerprint(a.state));
  });

  it('état visible des bâtiments : chantier, ruines, abandon, crue et remise en état', () => {
    const s = flatSession();
    const c = s.catalog;
    const st = s.state;
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
    const house = spawn(s, 'res_low_1', 8, 16, { residents: 4 });
    expect(visualStateOf(st, house, c).state).toBeUndefined();
    house.constructionStart = st.time.tick;
    house.constructionUntil = st.time.tick + 10;
    st.time.tick += 5;
    const v = visualStateOf(st, house, c);
    expect(v.state).toBe('construction');
    expect(v.progress).toBeCloseTo(0.5, 1);
    delete house.constructionUntil;
    house.abandoned = true;
    expect(visualStateOf(st, house, c).state).toBe('abandoned');
    house.abandoned = false;
    house.recoverUntil = st.time.tick + 3;
    expect(visualStateOf(st, house, c).state).toBe('flooded');
    st.time.tick += 4;
    expect(visualStateOf(st, house, c).state).toBeUndefined();
    house.ruins = { since: st.time.tick, cause: 'fire' };
    expect(visualStateOf(st, house, c).state).toBe('burnt');
    house.ruins.cause = 'flood';
    expect(visualStateOf(st, house, c).state).toBe('rubble');
    // un équipement posé par le joueur passe par un chantier décoratif, comme en 2D
    const r = s.execute({ type: 'building', defId: 'police_post', x: 12, y: 16 });
    expect(r.ok).toBe(true);
    const days = constructionDays(c.building('police_post'));
    expect(visualStateOf(st, r.building, c).state).toBe(days ? 'construction' : undefined);
    st.time.tick += days + 1;
    expect(visualStateOf(st, r.building, c).state).toBeUndefined();
  });

  it('le cycle jour/nuit de la 3D suit exactement celui de la 2D', () => {
    for (let p = 0; p <= 1.0001; p += 0.01) expect(nightOf(p)).toBeCloseTo(nightAt(p), 6);
  });

  it('une technologie en panne (cyberattaque) disparaît de la vue', () => {
    const s = flatSession();
    const st = s.state;
    expect(activeTechs(st).has('ai_traffic_lights')).toBe(true);
    st.tech.outages.ai_traffic_lights = st.time.tick + 5;
    expect(activeTechs(st).has('ai_traffic_lights')).toBe(false);
  });
});

describe('v1.5 — modèles 3D des bâtiments', () => {
  it('les 119 modèles se construisent dans les quatre orientations sans déborder de leur emprise', () => {
    const c3 = catalog3d(getCatalog());
    setCatalog(c3);
    const mat = new THREE.MeshBasicMaterial();
    const mats = { body: mat, lit: mat, litc: mat, glow: mat };
    const bad = [];
    for (const def of c3.b) {
      for (let rot = 0; rot < 4; rot++) {
        // emprise au sol (après rotation) et rive côté opposé à la façade pour les équipements au bord de l'eau
        const water = def.water ? (rot + 2) % 4 : -1;
        // gare et tube : la façade est toujours un grand côté (voir facingOf)
        if ((def.id === 'train_station' || def.id === 'hyperloop') && (rot % 2 === 0 ? def.w : def.h) < (rot % 2 === 0 ? def.h : def.w)) continue;
        const b = { id: 1, def, x: 0, z: 0, w: def.w, h: def.h, rot, alt: 0, water, ups: new Set(), state: undefined };
        const box = new THREE.Box3().setFromObject(buildGroup(b, mats));
        const over = [box.max.z - def.h / 2, box.max.x - def.w / 2, -box.min.z - def.h / 2, -box.min.x - def.w / 2]; // sud, est, nord, ouest
        over.forEach((e, d) => {
          // pontons et quais avancent sur l'eau
          if (e > 0.02 && d !== water) bad.push(`${def.id} (orientation ${rot}) déborde de ${e.toFixed(2)} côté ${['sud', 'est', 'nord', 'ouest'][d]}`);
        });
      }
    }
    expect(bad).toEqual([]);
  });

  it('chaque amélioration et chaque état dégradé se construit pour tous les bâtiments concernés', () => {
    const c3 = catalog3d(getCatalog());
    setCatalog(c3);
    const mat = new THREE.MeshBasicMaterial();
    const mats = { body: mat, lit: mat, litc: mat, glow: mat };
    for (const def of c3.b) {
      const ups = new Set(c3.ups.filter((u) => u.appliesTo.includes(def.id)).map((u) => u.id));
      const b = { id: 2, def, x: 0, z: 0, w: def.w, h: def.h, rot: 0, alt: 0, water: def.water ? 2 : -1, ups, state: undefined };
      expect(() => buildGroup(b, mats), def.id).not.toThrow();
    }
  });
});

describe('v1.5 — délinquance (cambriolages et braquages)', () => {
  it('nature du risque selon le bâtiment', () => {
    const c = getCatalog();
    expect(crimeKind(c.building('res_low_1'))).toBe('burglary');
    expect(crimeKind(c.building('res_high_2'))).toBe('burglary');
    expect(crimeKind(c.building('off_1') ?? [...c.buildings.values()].find((d) => d.category === 'offices'))).toBe('burglary');
    expect(crimeKind(c.building('com_1'))).toBe('robbery');
    expect(crimeKind(c.building('police'))).toBe(null);
    expect(crimeKind(c.building('park'))).toBe(null);
  });

  it('la police fait baisser le risque et monter les interpellations, surtout améliorée', () => {
    const s = flatSession();
    const st = s.state;
    const g = st.grid;
    const crime = new CrimeSystem({ catalog: s.catalog });
    const house = spawn(s, 'res_low_1', 8, 16, { residents: 4 });
    g.coverPolice[g.idx(8, 16)] = 0;
    const p0 = crime.risk(st, house);
    g.coverPolice[g.idx(8, 16)] = 1;
    const p1 = crime.risk(st, house);
    expect(p0).toBeGreaterThan(0);
    expect(p1).toBeCloseTo(p0 * 0.15, 8);
    // logement vide, abandonné ou sinistré : aucun risque
    expect(crime.risk(st, { ...house, residents: 0 })).toBe(0);
    expect(crime.risk(st, { ...house, abandoned: true })).toBe(0);
    expect(crime.risk(st, { ...house, disasterUntil: st.time.tick + 2 })).toBe(0);
    g.coverPolice[g.idx(8, 16)] = 0.6;
    const a0 = crime.arrestChance(st, house);
    const station = spawn(s, 'police', 12, 16);
    const a1 = crime.arrestChance(st, house);
    station.upgrades = ['police_patrols', 'police_video', 'police_predictive'];
    const a2 = crime.arrestChance(st, house);
    expect(a1).toBeGreaterThanOrEqual(a0);
    expect(a2).toBeGreaterThan(a1);
    expect(a2).toBeLessThanOrEqual(0.95);
  });

  it('les incidents sont déterministes et ne consomment pas le générateur de la partie', () => {
    const a = town();
    const b = town();
    a.run(240);
    b.run(240);
    expect(crimeOf(a.state).incidents.length + crimeOf(a.state).history.reduce((n, m) => n + m.burglaries + m.robberies, 0)).toBeGreaterThan(0);
    expect(JSON.stringify(a.state.crime)).toBe(JSON.stringify(b.state.crime));
    const crime = new CrimeSystem({ catalog: a.catalog });
    const rng = a.state.rng.state;
    for (let k = 0; k < 30; k++) {
      crime.daily(a.state);
      a.state.time.tick++;
    }
    expect(a.state.rng.state).toBe(rng);
    expect(checkInvariants(a.state, a.catalog)).toEqual([]);
  });

  it('la délinquance est un indicateur : elle ne change ni la croissance, ni la satisfaction, ni les finances', () => {
    const a = town();
    const b = town();
    b.sim.crime.daily = () => {};
    a.run(300);
    b.run(300);
    const total = crimeOf(a.state).history.reduce((n, m) => n + m.burglaries + m.robberies, 0) + crimeOf(a.state).month.burglaries + crimeOf(a.state).month.robberies;
    expect(total).toBeGreaterThan(0);
    const strip = (state) => {
      const d = serializeState(state);
      delete d.meta.createdAt;
      delete d.crime;
      for (const o of d.buildings) {
        delete o.crimeUntil;
        delete o.crimeKind;
      }
      d.events.history = d.events.history.filter((e) => !/Braquage/.test(e.message ?? ''));
      return JSON.stringify(d);
    };
    expect(strip(a.state)).toBe(strip(b.state));
  });

  it('bilan mensuel et mémoire du bâtiment touché', () => {
    const s = flatSession();
    const st = s.state;
    const crime = new CrimeSystem({ catalog: s.catalog, bus: s.bus });
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
    const houses = [];
    for (let x = 4; x < 20; x++) houses.push(spawn(s, 'res_high_2', x, 16, { residents: 60, incomeClass: 'low' }));
    st.stats.unemploymentRate = 0.3;
    let days = 0;
    while (!crimeOf(st).incidents.length && days < 4000) {
      crime.daily(st);
      st.time.tick++;
      days++;
    }
    const f = crimeOf(st).incidents[0];
    expect(f).toBeTruthy();
    const victim = st.buildings.get(f.buildingId);
    expect(victim.crimeUntil).toBe(f.tick + CRIME_MEMORY_DAYS);
    // aucun facteur de satisfaction : la délinquance reste un indicateur
    const factors = s.sim.population.satisfactionFactors(st, victim, s.catalog.building(victim.defId)).factors;
    expect(factors.crime).toBeUndefined();
    expect(crimeOf(st).month.burglaries).toBe(1);
    crime.monthly(st);
    expect(crimeOf(st).month).toEqual({ burglaries: 0, robberies: 0, arrests: 0 });
    expect(crimeOf(st).history.at(-1).burglaries).toBe(1);
    for (let k = 0; k < 20; k++) crime.monthly(st);
    expect(crimeOf(st).history.length).toBe(12);
  });

  it('sauvegarde, chargement d\'une ancienne partie et synchronisation du Web Worker', () => {
    const s = town();
    s.run(120);
    crimeOf(s.state).incidents.push({ id: 77, tick: s.state.time.tick, kind: 'robbery', buildingId: 1, x: 1, y: 1, arrested: true });
    const raw = JSON.parse(JSON.stringify(serializeState(s.state)));
    expect(deserializeState(raw).crime).toEqual(s.state.crime);
    delete raw.crime;
    expect(deserializeState(raw).crime).toEqual(defaultCrime());
    // la réplique du fil principal reçoit les incidents (la vue 3D les met en scène)
    expect(SCALAR_KEYS).toContain('crime');
    const enc = new SnapshotEncoder(s);
    const replica = new GameSession({ catalog: s.catalog, state: deserializeState(JSON.parse(JSON.stringify(serializeState(s.state)))), bus: new EventBus() });
    replica.state.crime = defaultCrime();
    const dec = new SnapshotDecoder(replica);
    dec.apply(enc.encode({ full: true }).msg);
    expect(replica.state.crime.incidents.at(-1).id).toBe(77);
  });
});

describe('v1.5 — crues et incendies', () => {
  /** Plaine au ras de l'eau : une rivière à l'est, des maisons sur la berge. */
  function riverside() {
    const s = flatSession();
    const g = s.state.grid;
    for (let y = 0; y < g.height; y++) for (let x = 24; x < 30; x++) {
      g.terrain[g.idx(x, y)] = TERRAIN.WATER;
      g.altitude[g.idx(x, y)] = 0;
    }
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 22, y: 15 } });
    s.execute({ type: 'zone', zoneId: 'R_LOW', rect: { x0: 18, y0: 12, x1: 22, y1: 14 } });
    const houses = [];
    for (let x = 18; x <= 22; x++) for (let y = 12; y <= 14; y++) houses.push(spawn(s, 'res_low_1', x, y, { residents: 4 }));
    s.state.crises.graceUntil = 0;
    s.state.options.disasters = 'off';
    return { s, houses };
  }

  for (const response of ['wait', 'rescue']) {
    it(`les bâtiments inondés restent sinistrés après la décrue (réponse « ${response} »)`, () => {
      const { s } = riverside();
      const st = s.state;
      const r = s.sim.crises.trigger(st, 'flood', { manual: true });
      expect(r.ok).toBe(true);
      const c = r.crisis;
      expect(c.buildings.length).toBeGreaterThan(0);
      s.execute({ type: 'crisisResponse', crisisId: c.id, option: response });
      const id = c.buildings[0];
      const mirror = new MapMirror(s.catalog);
      mirror.build(st);
      expect(mirror.map.byId.get(id).state).toBe('flooded');
      let guard = 0;
      while (st.crises.active.some((x) => x.id === c.id) && guard++ < 200) s.run(1);
      const end = st.crises.history.find((h) => h.id === c.id).end;
      // une crue majeure peut détruire quelques maisons (reconstruites par leurs propriétaires) : on suit une survivante
      const b = c.buildings.map((k) => st.buildings.get(k)).find((o) => o && !o.ruins);
      expect(b).toBeTruthy();
      void id;
      expect(b.recoverUntil).toBe(end + (response === 'rescue' ? RECOVERY_DAYS / 2 : RECOVERY_DAYS));
      const f = s.sim.population.satisfactionFactors(st, b, s.catalog.building(b.defId)).factors;
      expect(f.recovery).toBe(-8);
      mirror.sync(st);
      expect(mirror.map.byId.get(b.id).state).toBe('flooded');
      s.run(b.recoverUntil - st.time.tick + 1);
      expect(s.sim.population.satisfactionFactors(st, b, s.catalog.building(b.defId)).factors.recovery).toBeUndefined();
      mirror.sync(st);
      expect(mirror.map.byId.get(b.id).state).toBeUndefined();
      expect(checkInvariants(st, s.catalog)).toEqual([]);
    });
  }

  it('un bâtiment à l\'abandon peut prendre feu, et la vue le montre ensuite calciné', () => {
    let abandoned = 0;
    for (let k = 0; k < 60; k++) {
      const s = flatSession();
      const st = s.state;
      s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 20, y: 15 } });
      const a = spawn(s, 'res_low_1', 8, 16, { abandoned: true });
      spawn(s, 'res_low_1', 14, 16, { residents: 4 });
      st.time.tick = 1000 + k * 7;
      const r = s.sim.crises.trigger(st, 'fire', { manual: true });
      expect(r.ok).toBe(true);
      if (Number(Object.keys(r.crisis.burning)[0]) === a.id) abandoned++;
    }
    expect(abandoned).toBeGreaterThan(0);
    const s = flatSession();
    const b = spawn(s, 'res_low_1', 8, 16, { abandoned: true });
    b.ruins = { since: s.state.time.tick, cause: 'fire' };
    expect(visualStateOf(s.state, b, s.catalog).state).toBe('burnt');
  });
});
