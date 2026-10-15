import { describe, it, expect } from 'vitest';
import { flatSession, spawn } from '../helpers/session.js';
import { SIM } from '../../src/simulation/config.js';
import { checkInvariants } from '../../src/debug/Invariants.js';
import { marketPrice, tradeValue } from '../../src/simulation/MarketSystem.js';

/** Montant attendu au prix du marché régional (v0.8), profondeur du marché comprise. */
const atMarket = (s, good, side, units) => Math.round(tradeValue(good, side, units, marketPrice(s.state, good, side)) * 100);

/** Rue reliée à l'autoroute (ligne 15) et immeubles habités le long de la rue. */
function town({ connected = true } = {}) {
  const s = flatSession();
  const from = connected ? 3 : 6; // sans liaison : la rue s'arrête avant l'autoroute
  s.execute({ type: 'road', roadId: 'road_street', from: { x: from, y: 15 }, to: { x: 26, y: 15 } });
  s.sim.attach(s.state);
  const homes = [];
  for (let x = 8; x <= 24; x += 2) homes.push(spawn(s, 'res_high_2', x, 14, { residents: 60, workforce: 30, employed: 30 }));
  return { s, homes };
}

const power = (s) => s.state.utilities.power;

describe('Échanges régionaux', () => {
  it('sans production, l\'achat d\'électricité à la région alimente une partie de la ville, au plus 60 % des besoins', () => {
    const { s, homes } = town();
    s.sim.utilities.update(s.state);
    expect(homes.every((b) => !b.powered)).toBe(true);
    expect(power(s).imported).toBe(0);
    expect(s.execute({ type: 'trade', resource: 'power', side: 'buy', enabled: true }).ok).toBe(true);
    s.sim.utilities.update(s.state);
    const p = power(s);
    expect(p.imported).toBeGreaterThan(0);
    expect(p.imported).toBeLessThanOrEqual(Math.max(SIM.TRADE.importMin, SIM.TRADE.importMaxShare * p.demand) + 1e-9);
    expect(homes.some((b) => b.powered)).toBe(true);
  });

  it('l\'achat est facturé à prix prohibitif : plus cher que ce que paient les habitants', () => {
    const { s } = town();
    s.execute({ type: 'trade', resource: 'power', side: 'buy', enabled: true });
    s.sim.utilities.update(s.state);
    const imported = power(s).imported;
    s.sim.economy.accrueDaily(s.state);
    const expected = atMarket(s, 'power', 'buy', imported);
    const p = s.sim.economy.closeMonth(s.state);
    expect(p.opex.importPower).toBe(expected);
    expect(p.opex.importPower).toBeGreaterThan(p.revenue.power);
    expect(SIM.TRADE.power.buy).toBeGreaterThan(3 * SIM.START_TARIFFS.power);
  });

  it('un réseau qui n\'est pas relié à l\'autoroute ne peut rien acheter ni vendre', () => {
    const { s, homes } = town({ connected: false });
    for (const side of ['buy', 'sell']) s.execute({ type: 'trade', resource: 'power', side, enabled: true });
    s.sim.utilities.update(s.state);
    expect(power(s).imported).toBe(0);
    expect(power(s).connected).toBe(false);
    expect(homes.every((b) => !b.powered)).toBe(true);
  });

  it('les excédents sont vendus à la région, après la recharge des batteries', () => {
    const { s } = town();
    spawn(s, 'power_gas', 10, 16, { jobsFilled: 20 });
    s.sim.utilities.update(s.state);
    expect(power(s).exported).toBe(0); // vente désactivée par défaut
    s.execute({ type: 'trade', resource: 'power', side: 'sell', enabled: true });
    s.sim.utilities.update(s.state);
    const p = power(s);
    expect(p.exported).toBeCloseTo(p.capacity - p.consumed, 6);
    const bat = spawn(s, 'power_battery', 20, 16, { charge: 0 });
    s.sim.utilities.update(s.state);
    expect(power(s).exported).toBeLessThan(p.exported);
    expect(bat.charge).toBeGreaterThan(0);
    s.sim.economy.accrueDaily(s.state);
    const expected = atMarket(s, 'power', 'sell', power(s).exported);
    const period = s.sim.economy.closeMonth(s.state);
    expect(period.revenue.exportPower).toBe(expected);
  });

  it('eau : achat en cas de pénurie, vente des excédents', () => {
    const { s, homes } = town();
    s.execute({ type: 'trade', resource: 'power', side: 'buy', enabled: true });
    s.sim.utilities.update(s.state);
    expect(s.state.utilities.water.imported).toBe(0);
    s.execute({ type: 'trade', resource: 'water', side: 'buy', enabled: true });
    s.sim.utilities.update(s.state);
    expect(s.state.utilities.water.imported).toBeGreaterThan(0);
    expect(homes.some((b) => b.watered)).toBe(true);
    // une grosse station de pompage (alimentée) dégage un excédent vendable
    spawn(s, 'power_gas', 10, 16, { jobsFilled: 20 });
    spawn(s, 'desalination', 20, 16, { jobsFilled: 10 });
    s.execute({ type: 'trade', resource: 'water', side: 'sell', enabled: true });
    s.sim.utilities.update(s.state);
    s.sim.utilities.update(s.state);
    const w = s.state.utilities.water;
    expect(w.imported).toBe(0);
    expect(w.exported).toBeGreaterThan(0);
  });

  it('déchets : sans installation de traitement, le traitement extérieur évite l\'accumulation… à prix fort', () => {
    const { s, homes } = town();
    spawn(s, 'waste_depot', 14, 16, { jobsFilled: 10, powered: true, access: s.state.grid.idx(14, 15) });
    for (const b of homes) b.powered = true;
    s.sim.waste.update(s.state, 10);
    expect(s.state.waste.stats.collected).toBe(0);
    expect(s.state.waste.stats.limitedBy).toBe('processing');
    s.execute({ type: 'trade', resource: 'waste', side: 'buy', enabled: true });
    s.sim.waste.update(s.state, 10);
    const ws = s.state.waste.stats;
    expect(ws.collected).toBeGreaterThan(0);
    expect(ws.exportedPerDay).toBeCloseTo(ws.collected, 6);
    s.sim.economy.accrueDaily(s.state);
    const expected = atMarket(s, 'waste', 'buy', ws.exportedPerDay);
    const p = s.sim.economy.closeMonth(s.state);
    expect(p.opex.wasteExport).toBe(expected);
  });

  it('commande invalide refusée ; la comptabilité reste cohérente', () => {
    const { s } = town();
    expect(s.execute({ type: 'trade', resource: 'waste', side: 'sell', enabled: true }).ok).toBe(false);
    expect(s.execute({ type: 'trade', resource: 'gold', side: 'buy', enabled: true }).ok).toBe(false);
    s.execute({ type: 'trade', resource: 'power', side: 'buy', enabled: true });
    s.run(65);
    expect(checkInvariants(s.state, s.catalog)).toEqual([]);
  });
});
