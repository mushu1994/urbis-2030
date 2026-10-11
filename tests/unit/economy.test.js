import { describe, it, expect } from 'vitest';
import { newSession } from '../helpers/session.js';
import { EconomySystem } from '../../src/simulation/EconomySystem.js';

describe('Économie municipale', () => {
  it('stocke la trésorerie en centimes entiers et refuse les montants non entiers', () => {
    const s = newSession();
    expect(Number.isInteger(s.state.economy.treasury)).toBe(true);
    expect(() => s.sim.economy.post(s.state, { kind: 'opex', category: 'services', label: 'x', amount: -10.5 })).toThrow();
  });

  it('un investissement est atomique : refusé en bloc si le budget est insuffisant', () => {
    const s = newSession();
    const eco = s.sim.economy;
    s.state.economy.treasury = 1000;
    const before = JSON.stringify(s.state.economy);
    const r = eco.payCapex(s.state, { amount: 1001, category: 'roads', label: 'Test', lifeYears: 10 });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(s.state.economy)).toBe(before);
  });

  it('distingue décaissement d\'investissement, charges et amortissements', () => {
    const s = newSession();
    const eco = s.sim.economy;
    const st = s.state;
    const start = st.economy.treasury;
    eco.payCapex(st, { amount: 1_200_000, category: 'energy', label: 'Centrale', lifeYears: 10 });
    eco.payOpex(st, { amount: 5_000, category: 'demolition', label: 'Démolition' });
    const p = eco.closeMonth(st);
    const sum = EconomySystem.summarize(p);
    expect(sum.capex).toBe(1_200_000);
    expect(sum.cashInvesting).toBe(-1_200_000);
    // l'investissement ne pèse pas sur le résultat opérationnel, seulement via l'amortissement
    expect(sum.depreciation).toBe(Math.round(1_200_000 / 120));
    expect(sum.netResult).toBe(sum.operatingResult - sum.depreciation);
    expect(st.economy.treasury - start).toBe(sum.cashChange);
    // chaque mouvement correspond à une transaction identifiable
    const ids = st.economy.ledger.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assoit les impôts sur des bases taxables (pas de pourcentage arbitraire de la richesse)', () => {
    const s = newSession();
    const st = s.state;
    const eco = s.sim.economy;
    st.economy.accrual = { days: 30, taxR: 30 * 10000, taxC: 0, taxO: 0, taxI: 0, property: 0, water: 0, power: 0, logisticsUnits: 0 };
    st.economy.taxes.R = 10;
    st.modifiers.taxEfficiency = 1;
    const p = eco.closeMonth(st);
    expect(p.revenue.taxR).toBe(100000); // 10 % de 10 000 € de revenus imposables mensuels = 1 000 €
  });

  it('calcule des annuités constantes et sépare intérêts et capital', () => {
    const s = newSession();
    const st = s.state;
    const eco = s.sim.economy;
    const r = eco.takeLoan(st, 12_000_000, 24);
    expect(r.ok).toBe(true);
    const loan = r.loan;
    eco.closeMonth(st);
    const p = st.economy.periods.at(-1);
    const sum = EconomySystem.summarize(p);
    expect(sum.cashFinancing).toBe(12_000_000 - p.principal);
    expect(p.interest + p.principal).toBe(loan.payment);
    expect(st.economy.loans[0].remaining).toBe(12_000_000 - p.principal);
    // le remboursement total couvre exactement le capital
    let paid = p.principal;
    for (let m = 1; m < 24; m++) {
      eco.closeMonth(st);
      paid += st.economy.periods.at(-1).principal;
    }
    expect(paid).toBe(12_000_000);
    expect(st.economy.loans.length).toBe(0);
  });

  it('refuse un emprunt au-delà de la capacité', () => {
    const s = newSession();
    expect(s.sim.economy.takeLoan(s.state, 10 ** 12, 120).ok).toBe(false);
  });

  it('produit une prévision de trésorerie intégrant l\'échéancier des emprunts', () => {
    const s = newSession();
    const st = s.state;
    const eco = s.sim.economy;
    eco.closeMonth(st);
    eco.takeLoan(st, 5_000_000, 12);
    const fc = eco.forecast(st, 12);
    expect(fc.months).toHaveLength(12);
    const debt = fc.months.reduce((x, m) => x + m.debtService, 0);
    expect(debt).toBeGreaterThan(5_000_000);
  });
});
