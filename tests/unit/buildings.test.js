import { describe, it, expect } from 'vitest';
import { getCatalog, newSession } from '../helpers/session.js';
import { Catalog } from '../../src/data/Catalog.js';
import { defaultData } from '../../src/data/defaultData.js';
import { computeModifiers } from '../../src/simulation/Modifiers.js';
import { TERRAIN, CLEARING_COST_EUROS, ROCK_CLEARING_COST_EUROS } from '../../src/world/Terrain.js';
import { toCents } from '../../src/util/money.js';

/** Partie de 64×64 où tout est débloqué, avec un quadrillage de rues pour desservir les emplacements. */
function sandbox() {
  const s = newSession();
  const st = s.state;
  st.stats.peakPopulation = 1e6;
  st.progression.era = 3;
  for (const t of s.catalog.technologies) st.tech.researched[t.id] = 0;
  st.economy.treasury = 1e12;
  const g = st.grid;
  for (let y = 4; y < 60; y += 6) s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y }, to: { x: 60, y } });
  return s;
}

function findSpot(s, defId) {
  const g = s.state.grid;
  for (let y = 1; y < g.height - 1; y++) for (let x = 1; x < g.width - 1; x++) {
    const pv = s.preview({ type: 'building', defId, x, y });
    if (pv.ok) return { x, y, pv };
  }
  return null;
}

describe('Catalogue des équipements', () => {
  const NEW = ['power_hydro', 'power_nuclear', 'power_fusion', 'desalination', 'waste_depot', 'landfill', 'incinerator', 'recycling', 'biogas',
    'valorisation', 'police_post', 'library', 'high_school', 'fire_drone', 'health_ai', 'plaza', 'playground', 'sports_field', 'statue', 'marina',
    'mayor_house', 'museum', 'zoo', 'stadium', 'vertical_garden', 'holo_park', 'bus_stop', 'bus_depot', 'metro_station', 'train_station',
    'hyperloop', 'seaport', 'airport'];

  it('chaque nouvel équipement existe et se pose au coût exact, sur exactement son emprise', () => {
    const s = sandbox();
    const g = s.state.grid;
    for (const id of NEW) {
      const def = s.catalog.building(id);
      const spot = findSpot(s, id);
      expect(spot, `aucun emplacement pour ${id}`).not.toBeNull();
      const before = s.state.economy.treasury;
      const forest = spot.pv.tiles.filter((i) => g.terrain[i] === TERRAIN.FOREST).length;
      const rock = spot.pv.tiles.filter((i) => g.terrain[i] === TERRAIN.ROCK).length;
      const r = s.execute({ type: 'building', defId: id, x: spot.x, y: spot.y });
      expect(r.ok, id).toBe(true);
      expect(before - s.state.economy.treasury).toBe(spot.pv.cost);
      // Coût = prix catalogue + travaux de terrain (défrichage, dérochage, nivellement) seulement
      expect(spot.pv.cost).toBeGreaterThanOrEqual(def.costCents + forest * toCents(CLEARING_COST_EUROS) + rock * toCents(ROCK_CLEARING_COST_EUROS));
      let tiles = 0;
      for (let i = 0; i < g.size; i++) if (g.building[i] === r.building.id) tiles++;
      expect(tiles, id).toBe(def.footprint.w * def.footprint.h);
    }
  });

  it('les équipements « au bord de l\'eau » sont refusés loin de l\'eau', () => {
    const s = sandbox();
    const g = s.state.grid;
    for (const id of ['power_hydro', 'desalination', 'marina', 'seaport']) {
      // une case dont tout le voisinage est terrestre
      let refused = null;
      for (let y = 5; y < 55 && !refused; y++) for (let x = 5; x < 30 && !refused; x++) {
        const pv = s.preview({ type: 'building', defId: id, x, y });
        if (pv.reasons.length === 1 && pv.reasons[0] === 'needWater') refused = pv;
      }
      expect(refused, id).not.toBeNull();
      expect(refused.messages[0]).toMatch(/bord de l'eau/);
    }
  });

  it('les équipements verrouillés indiquent ce qui les débloque', () => {
    const s = newSession();
    expect(s.preview({ type: 'building', defId: 'power_fusion', x: 10, y: 10 }).messages.join()).toMatch(/symbiotique/);
    expect(s.preview({ type: 'building', defId: 'airport', x: 10, y: 10 }).messages.join()).toMatch(/6\s?000 habitants/);
  });

  it('port et aéroport agissent sur la demande de toute la ville', () => {
    const s = sandbox();
    const base = computeModifiers(s.state, s.catalog);
    const port = findSpot(s, 'seaport');
    const r = s.execute({ type: 'building', defId: 'seaport', x: port.x, y: port.y });
    r.building.powered = true;
    r.building.jobsFilled = 80;
    const m = computeModifiers(s.state, s.catalog);
    expect(m['demand.I'] - base['demand.I']).toBeCloseTo(14);
    r.building.abandoned = true;
    expect(computeModifiers(s.state, s.catalog)['demand.I']).toBe(base['demand.I']);
  });

  it('un arrêt d\'urgence de centrale nucléaire coupe sa production pendant la durée prévue', () => {
    const data = structuredClone(defaultData.buildings);
    data.buildings.find((b) => b.id === 'power_nuclear').risk.monthlyChance = 1;
    const catalog = new Catalog(data, defaultData.technologies, defaultData.policies);
    const s = newSession({ catalog });
    s.state.stats.peakPopulation = 1e6;
    s.state.economy.treasury = 1e12;
    for (let y = 4; y < 60; y += 6) s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y }, to: { x: 60, y } });
    const spot = findSpot(s, 'power_nuclear');
    const plant = s.execute({ type: 'building', defId: 'power_nuclear', x: spot.x, y: spot.y }).building;
    plant.jobsFilled = 90;
    s.sim.utilities.update(s.state);
    expect(plant.output).toBeGreaterThan(1000);
    s.sim.events.monthly(s.state);
    expect(plant.disabledUntil).toBe(s.state.time.tick + 45);
    s.sim.utilities.update(s.state);
    expect(plant.output).toBe(0);
    expect(s.state.events.active.some((e) => e.id === `risk-${plant.id}`)).toBe(true);
  });

  it('les recettes des équipements de loisirs sont comptabilisées séparément', () => {
    const s = sandbox();
    const spot = findSpot(s, 'stadium');
    const st = s.execute({ type: 'building', defId: 'stadium', x: spot.x, y: spot.y }).building;
    Object.assign(st, { powered: true, jobsFilled: 40 });
    const p = s.sim.economy.closeMonth(s.state);
    expect(p.revenue.facilities).toBe(700000);
  });

  it('le catalogue refuse une condition d\'évolution inconnue', () => {
    const data = structuredClone(defaultData.buildings);
    data.buildings.find((b) => b.id === 'res_low_1').growth.requires.push('teleportation');
    expect(() => new Catalog(data, defaultData.technologies, defaultData.policies)).toThrow(/teleportation/);
    expect(getCatalog().buildings.size).toBe(115);
  });
});
