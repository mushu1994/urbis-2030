import { describe, it, expect } from 'vitest';
import { flatSession, spawn, getCatalog } from '../helpers/session.js';
import { Catalog } from '../../src/data/Catalog.js';
import { defaultData } from '../../src/data/defaultData.js';
import { applyUpgrades, formatUpgradeEffect, isGoodEffect, UPGRADE_EFFECTS } from '../../src/data/Upgrades.js';
import { GameSession } from '../../src/app/GameSession.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { checkInvariants } from '../../src/debug/Invariants.js';

/** Commissariat posé par le joueur (avec son immobilisation) le long d'une rue. */
function withPolice(opts) {
  const s = flatSession(opts);
  s.state.stats.peakPopulation = Math.max(s.state.stats.peakPopulation, 5000);
  s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y: 15 }, to: { x: 26, y: 15 } });
  const r = s.execute({ type: 'building', defId: 'police', x: 10, y: 13 });
  expect(r.ok).toBe(true);
  s.run(1);
  return { s, b: r.building };
}

describe('Améliorations des équipements', () => {
  it('le catalogue charge les améliorations, toutes valides et rattachées à des équipements constructibles', () => {
    const c = getCatalog();
    expect(c.upgrades.length).toBeGreaterThanOrEqual(30);
    for (const u of c.upgrades) {
      expect(u.appliesTo.length).toBeGreaterThan(0);
      for (const id of u.appliesTo) expect(c.building(id).kind).toBe('plop');
      for (const k of Object.keys(u.effects)) expect(UPGRADE_EFFECTS[k]).toBeDefined();
    }
    // chaque grande famille d'équipements publics a au moins une amélioration
    for (const id of ['police', 'fire', 'hospital', 'school', 'city_hall', 'power_gas', 'water_pump', 'waste_depot', 'landfill', 'bus_depot', 'train_station', 'park']) {
      expect(c.upgradesFor(id).length, id).toBeGreaterThan(0);
    }
  });

  it('un effet inconnu ou un bâtiment inexistant est refusé au chargement', () => {
    const bad = structuredClone(defaultData.upgrades);
    bad.upgrades[0].effects = { teleportation: 2 };
    bad.upgrades[1].appliesTo = ['licorne'];
    expect(() => new Catalog(defaultData.buildings, defaultData.technologies, defaultData.policies, bad)).toThrow(/teleportation[\s\S]*licorne|licorne[\s\S]*teleportation/);
  });

  it('applyUpgrades ne modifie jamais la définition de base', () => {
    const c = getCatalog();
    const base = c.building('police');
    const r0 = base.capacity.service.radius;
    const d = applyUpgrades(base, [c.upgradeById.get('police_patrols')]);
    expect(d.capacity.service.radius).toBe(r0 + 4);
    expect(base.capacity.service.radius).toBe(r0);
    expect(d.upkeepCents).toBe(base.upkeepCents + c.upgradeById.get('police_patrols').upkeepCents);
  });

  it('installer une amélioration : paiement, rayon élargi, couverture étendue et entretien mensuel', () => {
    const { s, b } = withPolice();
    const g = s.state.grid;
    const far = g.idx(10 + 16, 13); // hors du rayon de base (14), dans le rayon amélioré (18)
    s.sim.environment.updateCoverage(s.state);
    const before = g.coverPolice[far];
    const treasury = s.state.economy.treasury;
    const up = s.catalog.upgradeById.get('police_patrols');
    const r = s.execute({ type: 'upgrade', buildingId: b.id, upgradeId: 'police_patrols' });
    expect(r.ok).toBe(true);
    expect(s.state.economy.treasury).toBe(treasury - up.costCents);
    expect(b.upgrades).toEqual(['police_patrols']);
    expect(s.catalog.buildingFor(b).capacity.service.radius).toBe(18);
    s.run(1);
    expect(g.coverPolice[far]).toBeGreaterThan(before);
    // l'entretien mensuel inclut celui de l'amélioration
    const p = s.sim.economy.closeMonth(s.state);
    const k = s.state.modifiers['upkeep.services'] ?? 1;
    expect(p.opex.services).toBe(Math.round((s.catalog.building('police').upkeepCents + up.upkeepCents) * k));
    expect(checkInvariants(s.state, s.catalog)).toEqual([]);
  });

  it('refus : déjà installée, mauvaise cible, ère non atteinte, budget insuffisant', () => {
    const { s, b } = withPolice({ unlockAll: false });
    expect(s.execute({ type: 'upgrade', buildingId: b.id, upgradeId: 'police_patrols' }).ok).toBe(true);
    expect(s.preview({ type: 'upgrade', buildingId: b.id, upgradeId: 'police_patrols' }).messages[0]).toMatch(/déjà/);
    expect(s.preview({ type: 'upgrade', buildingId: b.id, upgradeId: 'gas_scrubbers' }).ok).toBe(false);
    const era = s.preview({ type: 'upgrade', buildingId: b.id, upgradeId: 'police_predictive' });
    expect(era.ok).toBe(false);
    expect(era.messages[0]).toMatch(/ère/);
    s.state.economy.treasury = 100;
    const poor = s.preview({ type: 'upgrade', buildingId: b.id, upgradeId: 'police_video' });
    expect(poor.reasons).toEqual(['budget']);
  });

  it('« Annuler » retire l\'amélioration et rembourse l\'investissement', () => {
    const { s, b } = withPolice();
    const treasury = s.state.economy.treasury;
    const assets = s.state.economy.assets.length;
    s.execute({ type: 'upgrade', buildingId: b.id, upgradeId: 'police_patrols' });
    const u = s.execute({ type: 'undo' });
    expect(u.ok).toBe(true);
    expect(b.upgrades).toEqual([]);
    expect(s.state.economy.treasury).toBe(treasury);
    expect(s.state.economy.assets.length).toBe(assets);
  });

  it('la démolition sort aussi l\'amélioration des immobilisations', () => {
    const { s, b } = withPolice();
    s.execute({ type: 'upgrade', buildingId: b.id, upgradeId: 'police_patrols' });
    const assetId = b.upgradeAssets[0];
    expect(s.state.economy.assets.some((a) => a.id === assetId)).toBe(true);
    expect(s.execute({ type: 'demolish', rect: { x0: b.x, y0: b.y, x1: b.x + 1, y1: b.y + 1 } }).ok).toBe(true);
    expect(s.state.economy.assets.some((a) => a.id === assetId)).toBe(false);
    expect(checkInvariants(s.state, s.catalog)).toEqual([]);
  });

  it('effets sur les réseaux et les déchets : production électrique, stockage de la décharge, pollution', () => {
    const s = flatSession();
    const plant = spawn(s, 'power_gas', 5, 5, { jobsFilled: 20 });
    s.sim.utilities.update(s.state);
    const cap0 = s.state.utilities.power.capacity;
    plant.upgrades = ['gas_combined'];
    s.sim.utilities.update(s.state);
    expect(s.state.utilities.power.capacity).toBeCloseTo(cap0 * 1.3, 6);
    expect(s.catalog.buildingFor(plant).environment.pollution).toBe(45);
    plant.upgrades = ['gas_combined', 'gas_scrubbers'];
    expect(s.catalog.buildingFor(plant).environment.pollution).toBeCloseTo(45 * 0.55, 6);
    const lf = spawn(s, 'landfill', 12, 5, {});
    lf.upgrades = ['landfill_extension'];
    expect(s.catalog.buildingFor(lf).capacity.waste.storage).toBeCloseTo(220000 * 1.6, 3);
  });

  it('les améliorations sont conservées par la sauvegarde', () => {
    const { s, b } = withPolice();
    s.execute({ type: 'upgrade', buildingId: b.id, upgradeId: 'police_patrols' });
    const restored = new GameSession({ catalog: s.catalog, state: deserializeState(JSON.parse(JSON.stringify(serializeState(s.state)))) });
    const rb = restored.state.buildings.get(b.id);
    expect(rb.upgrades).toEqual(['police_patrols']);
    expect(restored.catalog.buildingFor(rb).capacity.service.radius).toBe(18);
  });

  it('textes des effets pour les fiches', () => {
    expect(formatUpgradeEffect('serviceRadius', 4)).toBe('Rayon d\'action +4 cases');
    expect(formatUpgradeEffect('pollution', 0.55)).toBe('Pollution −45 %');
    expect(isGoodEffect('pollution', 0.55)).toBe(true);
    expect(isGoodEffect('noise', 1.2)).toBe(false);
    expect(isGoodEffect('powerOutput', 1.3)).toBe(true);
  });
});
