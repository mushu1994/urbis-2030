import { describe, it, expect } from 'vitest';
import { Catalog } from '../../src/data/Catalog.js';
import { defaultData } from '../../src/data/defaultData.js';
import { validateCatalogData } from '../../src/data/Validators.js';

describe('Catalogue', () => {
  it('charge les données par défaut sans erreur et convertit en centimes', () => {
    const c = new Catalog(defaultData.buildings, defaultData.technologies, defaultData.policies);
    expect(c.building('power_gas').costCents).toBe(8_250_000);
    expect(c.road('road_street').code).toBe(1);
    expect(c.firstGrowable(1).id).toBe('res_low_1');
    for (const zone of [1, 2, 3, 4, 5]) expect([...new Set(c.growablesByZone.get(zone).map((d) => d.level))]).toEqual([1, 2, 3, 4, 5]);
    // chaque niveau mène au suivant, le dernier n'évolue plus
    // chaque filière (variantes et grands formats compris) monte d'un niveau à la fois, dans la même zone et au même format
    for (const d of c.buildings.values()) {
      if (d.kind !== 'growable' || !d.growth.next) continue;
      const n = c.building(d.growth.next);
      expect(n.zoneCode, d.id).toBe(d.zoneCode);
      expect(n.level, d.id).toBe(d.level + 1);
      expect([n.footprint.w, n.footprint.h], d.id).toEqual([d.footprint.w, d.footprint.h]);
    }
    for (const d of c.buildings.values()) {
      expect(Number.isInteger(d.costCents)).toBe(true);
      expect(d.footprint.w).toBeGreaterThan(0);
    }
  });

  it('chaque bâtiment déclare emprise, coûts, réseaux, capacités, effets, évolution et visuel', () => {
    for (const d of defaultData.buildings.buildings) {
      expect(d.id && d.name && d.category && d.footprint && d.visual).toBeTruthy();
      if (d.kind === 'plop') expect(typeof d.cost === 'number' && typeof d.upkeep === 'number').toBe(true);
    }
  });

  it('refuse un catalogue incohérent avec des messages explicites', () => {
    const bad = structuredClone(defaultData.buildings);
    bad.buildings.push({ ...bad.buildings[0] }); // doublon
    bad.buildings.push({ id: 'x', name: 'X', category: 'inconnue', kind: 'plop', footprint: { w: 0, h: 1 }, cost: -1, upkeep: 0, visual: {} });
    const errors = validateCatalogData(bad, defaultData.technologies, defaultData.policies);
    expect(errors.some((e) => e.includes('dupliqué'))).toBe(true);
    expect(errors.some((e) => e.includes('catégorie inconnue'))).toBe(true);
    expect(errors.some((e) => e.includes('emprise invalide'))).toBe(true);
    expect(() => new Catalog(bad, defaultData.technologies, defaultData.policies)).toThrow(/Catalogue invalide/);
  });

  it('détecte une référence de technologie inexistante', () => {
    const t = structuredClone(defaultData.technologies);
    t.technologies[0].unlock = { tech: 'nexiste_pas' };
    expect(validateCatalogData(defaultData.buildings, t, defaultData.policies).join()).toMatch(/prérequis/);
  });
});
