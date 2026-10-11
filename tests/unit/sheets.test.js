import { describe, it, expect } from 'vitest';
import { getCatalog } from '../helpers/session.js';
import { buildingSheetData, buildingSummary } from '../../src/ui/BuildingSheet.js';

describe('Fiches des bâtiments (menu de construction)', () => {
  const c = getCatalog();
  const plops = [...c.buildings.values()].filter((d) => d.kind === 'plop');

  it('chaque bâtiment constructible a une description rédigée et au moins un effet décrit', () => {
    for (const d of plops) {
      const s = buildingSheetData(d, c);
      expect(s.description.length, d.id).toBeGreaterThan(40);
      if (d.id !== 'power_line') expect(s.effects.length, d.id).toBeGreaterThan(0);
      expect(s.costs[0].value).toMatch(/€/);
    }
  });

  it('les chiffres viennent des données : rayon, capacité, nuisances, contraintes', () => {
    const police = buildingSheetData(c.building('police'), c);
    expect(police.effects.map((e) => e.text).join()).toMatch(/rayon de 14 cases/);
    const gas = buildingSheetData(c.building('power_gas'), c);
    expect(gas.effects.find((e) => /Pollution 45/.test(e.text)).tone).toBe('neg');
    expect(gas.effects.find((e) => /Produit 1\s?200 u\. d'électricité/.test(e.text)).tone).toBe('pos');
    const pump = buildingSheetData(c.building('water_pump'), c);
    expect(pump.needs).toContain('Au bord de l\'eau');
    const train = buildingSheetData(c.building('train_station'), c);
    expect(train.upgrades).toBeGreaterThan(0);
    expect(buildingSummary(c.building('bus_stop'), c)).toMatch(/rayon de 5 cases/);
  });

  it('chaque zone a une description', () => {
    for (const z of c.zones) expect(z.description?.length, z.id).toBeGreaterThan(40);
  });
});
