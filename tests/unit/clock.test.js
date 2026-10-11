import { describe, it, expect } from 'vitest';
import { SimulationClock } from '../../src/simulation/SimulationClock.js';

describe('Horloge de simulation', () => {
  it('ne produit aucun tick en pause', () => {
    const c = new SimulationClock();
    c.setSpeed(0);
    expect(c.advance(5000)).toBe(0);
  });

  it('le nombre de ticks dépend du temps écoulé, pas du nombre d\'images', () => {
    const a = new SimulationClock();
    const b = new SimulationClock();
    a.setSpeed(2);
    b.setSpeed(2);
    let ta = 0;
    let tb = 0;
    for (let k = 0; k < 600; k++) ta += a.advance(1000 / 60); // 60 images/s pendant 10 s
    for (let k = 0; k < 300; k++) tb += b.advance(1000 / 30); // 30 images/s pendant 10 s
    expect(ta).toBe(tb);
    expect(ta).toBe(15); // vitesse rapide : 1,5 jour par seconde
  });

  it('borne le rattrapage après un onglet inactif et limite les ticks par image', () => {
    const c = new SimulationClock({ maxTicksPerFrame: 4 });
    c.setSpeed(3);
    const t = c.advance(60_000);
    expect(t).toBeLessThanOrEqual(4);
    expect(c.droppedMs).toBeGreaterThan(0);
  });
});
