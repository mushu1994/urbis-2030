import { describe, it, expect } from 'vitest';
import { flatSession, spawn } from '../helpers/session.js';
import { trafficDiagnosis, congestionHotspots, pollutionSources } from '../../src/simulation/TrafficAdvisor.js';
import { GUIDE } from '../../src/ui/GuideContent.js';
import { OVERLAY_BY_ID } from '../../src/rendering/Overlays.js';
import { setView, gridToWorld, worldToGridFloat, rotateTile, unrotateTile, screenCorners, depthOf, footDepth, gridDir, heightStep, TOP_TILE } from '../../src/rendering/IsometricProjection.js';

/** Rue saturée artificiellement : flux et congestion écrits dans la grille, comme après un cycle de trafic. */
function jammed() {
  const s = flatSession();
  s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 26, y: 15 } });
  s.sim.attach(s.state);
  const g = s.state.grid;
  for (let x = 8; x <= 14; x++) {
    const i = g.idx(x, 15);
    g.traffic[i] = 900;
    g.congestion[i] = 900 / 650;
  }
  for (let x = 20; x <= 21; x++) {
    const i = g.idx(x, 15);
    g.traffic[i] = 700;
    g.congestion[i] = 700 / 650;
  }
  for (let x = 4; x <= 24; x += 2) spawn(s, 'res_high_2', x, 14, { residents: 60, employed: 30, workforce: 32, access: g.idx(x, 15) });
  s.state.stats.population = 2600;
  s.state.stats.peakPopulation = 2600;
  s.state.stats.avgPollution = 6;
  s.state.traffic.stats = { vehicleTrips: 4000, vkt: 9000, avgCommute: 22, congestedTiles: 9, roadTiles: 26, avgCongestion: 0.72, unreachableTrips: 0, topAxes: [], cycle: 3 };
  s.state.transit.stats = { coveredShare: 0.1, saturation: {}, depots: 0, metroStations: 0, fare: 1.2 };
  return s;
}

describe('Conseiller circulation et pollution (v0.9)', () => {
  it('regroupe les axes saturés contigus en points noirs, du plus chargé au moins chargé', () => {
    const s = jammed();
    const hs = congestionHotspots(s.state, s.catalog);
    expect(hs.length).toBe(2);
    expect(hs[0].tiles).toBe(7);
    expect(hs[1].tiles).toBe(2);
    expect(hs[0].roadId).toBe('road_street');
    expect(hs[0].widenTo).toBe('road_avenue');
    expect(hs[0].flow).toBeGreaterThan(hs[1].flow);
  });

  it('estime la part de la pollution due au trafic', () => {
    const s = jammed();
    const p = pollutionSources(s.state, s.catalog);
    expect(p.traffic).toBeGreaterThan(0);
    expect(p.share).toBeGreaterThan(0.5); // aucune usine : la pollution vient des voitures
    spawn(s, 'ind_1', 5, 18, { jobsFilled: 20 });
    expect(pollutionSources(s.state, s.catalog).share).toBeLessThan(p.share);
  });

  it('classe des conseils pertinents et actionnables', () => {
    const s = jammed();
    const d = trafficDiagnosis(s.state, s.catalog);
    expect(d.indicators.level).toBe('saturée');
    const ids = d.advice.map((a) => a.id);
    expect(ids[0]).toBe('widen');
    expect(ids).toContain('transit_cover');
    expect(ids).toContain('mix'); // trajets de 22 minutes
    expect(ids).toContain('tram');
    expect(ids).toContain('policy_remote_work');
    expect(ids).toContain('policy_low_emission_zone');
    expect(ids).toContain('green');
    for (let k = 1; k < d.advice.length; k++) expect(d.advice[k - 1].score).toBeGreaterThanOrEqual(d.advice[k].score);
    // Chaque action renvoie vers un outil, un panneau, une couche, une politique ou une technologie existants
    const tools = new Set();
    for (const a of d.advice) {
      expect(a.actions.length).toBeGreaterThan(0);
      for (const act of a.actions) {
        if (act.kind === 'overlay') expect(OVERLAY_BY_ID.has(act.overlay)).toBe(true);
        if (act.kind === 'policy') expect(s.catalog.policyById.has(act.policy)).toBe(true);
        if (act.kind === 'research') expect(s.catalog.techById.has(act.tech)).toBe(true);
        if (act.kind === 'tool') tools.add(act.tool);
      }
    }
    for (const t of tools) {
      const [kind, id] = t.split(':');
      if (kind === 'road') expect(s.catalog.road(id)).toBeTruthy();
      if (kind === 'building') expect(s.catalog.building(id)).toBeTruthy();
    }
  });

  it('une politique adoptée n\'est plus conseillée ; une ville fluide reçoit peu de conseils', () => {
    const s = jammed();
    expect(s.execute({ type: 'policy', policyId: 'remote_work', enabled: true }).ok).toBe(true);
    expect(trafficDiagnosis(s.state, s.catalog).advice.map((a) => a.id)).not.toContain('policy_remote_work');
    const calm = flatSession();
    calm.state.stats.population = 400;
    calm.state.traffic.stats = { vehicleTrips: 300, avgCommute: 8, congestedTiles: 0, roadTiles: 30, avgCongestion: 0.1, unreachableTrips: 0 };
    calm.state.transit.stats = { coveredShare: 0.8, saturation: {} };
    const d = trafficDiagnosis(calm.state, calm.catalog);
    expect(d.indicators.level).toBe('fluide');
    expect(d.hotspots).toEqual([]);
    expect(d.advice.filter((a) => a.impact === 'fort')).toEqual([]);
  });
});

describe('Guide du maire (v0.9)', () => {
  it('13 chapitres complets, aux identifiants uniques', () => {
    expect(GUIDE.length).toBe(13);
    expect(new Set(GUIDE.map((c) => c.id)).size).toBe(GUIDE.length);
    for (const c of GUIDE) {
      expect(c.title && c.intro).toBeTruthy();
      expect(c.sections.length).toBeGreaterThan(0);
      for (const s of c.sections) expect(s.items.length).toBeGreaterThan(0);
    }
  });

  it('chaque « Montre-moi » mène à un outil, un panneau, une couche ou un menu existant', () => {
    const s = flatSession();
    const panels = new Set(['city', 'demand', 'finance', 'politics', 'ai', 'territory', 'lines', 'traffic']);
    for (const c of GUIDE) {
      for (const sec of c.sections) {
        for (const a of sec.show ?? []) {
          if (a.overlay) expect(OVERLAY_BY_ID.has(a.overlay), a.overlay).toBe(true);
          else if (a.panel) expect(panels.has(a.panel), a.panel).toBe(true);
          else if (a.category) expect(['energy', 'water', 'waste', 'transport']).toContain(a.category);
          else if (a.tool) {
            const [kind, id] = a.tool.split(':');
            if (kind === 'road') expect(s.catalog.road(id)).toBeTruthy();
            else if (kind === 'zone') expect(s.catalog.zoneById.has(id)).toBe(true);
            else expect(['rail', 'line', 'terraform', 'building']).toContain(kind);
          } else throw new Error(`Action sans cible : ${a.label}`);
        }
      }
    }
  });
});

describe('Navigation : rotation et vue de dessus (v0.9)', () => {
  const reset = () => setView({ rot: 0, top: false, width: 40, height: 30 });

  it('chaque orientation reste inversible : pointer une case la retrouve', () => {
    for (const top of [false, true]) {
      for (let rot = 0; rot < 4; rot++) {
        setView({ rot, top, width: 40, height: 30 });
        for (const [x, y] of [[0, 0], [39, 0], [12, 29], [25, 7]]) {
          const c = gridToWorld(x + 0.5, y + 0.5, 0);
          const f = worldToGridFloat(c.x, c.y, 0);
          expect(Math.floor(f.x)).toBe(x);
          expect(Math.floor(f.y)).toBe(y);
          const [rx, ry] = rotateTile(x, y);
          expect(unrotateTile(rx, ry)).toEqual([x, y]);
        }
      }
    }
    reset();
  });

  it('un quart de tour à droite fait passer le coin est en bas de l\'écran', () => {
    setView({ rot: 0, top: false, width: 40, height: 30 });
    const eastBefore = screenCorners(0, 0, 40, 30);
    expect(eastBefore.R).toEqual(gridToWorld(40, 0));
    setView({ rot: 1, top: false, width: 40, height: 30 });
    const after = screenCorners(0, 0, 40, 30);
    expect(after.B).toEqual(gridToWorld(40, 0));
    reset();
  });

  it('ordre du peintre : la case la plus en avant change avec l\'orientation', () => {
    setView({ rot: 0, width: 40, height: 30 });
    expect(depthOf(39, 29)).toBeGreaterThan(depthOf(0, 0));
    setView({ rot: 2, width: 40, height: 30 });
    expect(depthOf(0, 0)).toBeGreaterThan(depthOf(39, 29));
    expect(footDepth(0, 0, 2, 2)).toBe(depthOf(0, 0));
    // Voisins « derrière » : en orientation 2, derrière = +x et +y
    expect(gridDir(-1, 0)).toEqual([1, 0]);
    expect(gridDir(0, -1)).toEqual([0, 1]);
    reset();
  });

  it('vue de dessus : plan carré, sans élévation', () => {
    setView({ rot: 0, top: true, width: 40, height: 30 });
    expect(gridToWorld(2, 3, 4)).toEqual({ x: 2 * TOP_TILE, y: 3 * TOP_TILE });
    expect(heightStep()).toBe(0);
    const c = screenCorners(2, 3, 2, 1);
    expect(c.R.x - c.T.x).toBe(2 * TOP_TILE);
    expect(c.B.y - c.T.y).toBe(TOP_TILE);
    reset();
    expect(heightStep()).toBeGreaterThan(0);
  });
});
