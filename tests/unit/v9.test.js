import { describe, it, expect } from 'vitest';
import { flatSession, spawn } from '../helpers/session.js';
import { trafficDiagnosis, congestionHotspots, pollutionSources } from '../../src/simulation/TrafficAdvisor.js';
import { GUIDE } from '../../src/ui/GuideContent.js';
import { OVERLAY_BY_ID } from '../../src/rendering/Overlays.js';
import { tiltSpeed, screenTilt, GyroController, GYRO_DEAD_ZONE, GYRO_SPEEDS } from '../../src/app/GyroController.js';

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

describe('Vue gyroscopique (v0.9)', () => {
  it('zone morte, vitesse progressive et plafonnée', () => {
    expect(tiltSpeed(GYRO_DEAD_ZONE - 0.5, 700)).toBe(0);
    expect(tiltSpeed(-2, 700)).toBe(0);
    expect(tiltSpeed(10, 700)).toBeGreaterThan(0);
    expect(tiltSpeed(-10, 700)).toBeLessThan(0);
    expect(tiltSpeed(20, 700)).toBeGreaterThan(tiltSpeed(10, 700));
    expect(tiltSpeed(80, 700)).toBe(700);
  });

  it('tient compte de l\'orientation de l\'écran', () => {
    expect(screenTilt(10, 5, 0)).toEqual({ x: 5, y: 10 });
    expect(screenTilt(10, 5, 90)).toEqual({ x: 10, y: -5 });
    expect(screenTilt(10, 5, 270)).toEqual({ x: -10, y: 5 });
    expect(screenTilt(10, 5, 180)).toEqual({ x: -5, y: -10 });
  });

  it('déplace la caméra selon l\'écart à la position de repos, et s\'interrompt pendant un geste', () => {
    const pans = [];
    let blocked = false;
    const cam = { pan: (dx, dy) => pans.push([dx, dy]) };
    const gyro = new GyroController({ camera: () => cam, isBlocked: () => blocked });
    gyro.active = true;
    gyro.raw = { beta: 40, gamma: 0 };
    gyro.update(16); // première mesure : position de repos
    expect(pans.length).toBe(0);
    gyro.raw = { beta: 40, gamma: 20 }; // penché vers la droite
    for (let k = 0; k < 30; k++) gyro.update(16);
    expect(pans.length).toBeGreaterThan(0);
    expect(pans.at(-1)[0]).toBeLessThan(0); // la caméra avance vers la droite (pan négatif)
    const n = pans.length;
    blocked = true;
    gyro.update(16);
    expect(pans.length).toBe(n);
    // Retour : la position actuelle devient le repos, pas d'à-coup
    blocked = false;
    gyro.update(16);
    gyro.update(16);
    expect(pans.length).toBe(n);
    gyro.sensitivity = 'high';
    expect(GYRO_SPEEDS.high).toBeGreaterThan(GYRO_SPEEDS.medium);
  });
});
