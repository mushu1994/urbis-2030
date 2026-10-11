import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GameLoop } from '../../src/app/GameLoop.js';
import { SimulationClock, SPEEDS } from '../../src/simulation/SimulationClock.js';
import { newSession } from '../helpers/session.js';
import { buildStarterTown } from '../../src/app/scenarios.js';

let raf;
beforeAll(() => {
  raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame ??= () => {};
});
afterAll(() => {
  globalThis.requestAnimationFrame = raf;
});

/** Fait tourner la boucle pendant `seconds` secondes à `fps` images par seconde (temps simulé). */
function drive(fps, seconds, speed, session) {
  const clock = new SimulationClock();
  clock.setSpeed(speed);
  let frames = 0;
  const loop = new GameLoop({ clock, step: () => session.sim.step(session.state), frame: () => frames++, budgetMs: 1e9 });
  loop.running = true;
  loop.last = 0;
  const dt = 1000 / fps;
  for (let t = dt; t <= seconds * 1000 + 1e-6; t += dt) loop.loop(t);
  return { ticks: loop.ticksRun, frames };
}

describe('Boucle de jeu', () => {
  it('le nombre d\'images par seconde ne modifie ni le temps ni les résultats économiques', () => {
    const a = newSession();
    const b = newSession();
    buildStarterTown(a);
    buildStarterTown(b);
    const ra = drive(60, 20, 2, a);
    const rb = drive(24, 20, 2, b);
    expect(ra.frames).toBeGreaterThan(rb.frames);
    expect(ra.ticks).toBe(rb.ticks);
    expect(a.state.time.tick).toBe(b.state.time.tick);
    expect(a.state.economy.treasury).toBe(b.state.economy.treasury);
    expect(a.state.stats.population).toBe(b.state.stats.population);
  });

  it('la pause arrête le temps et l\'accélération augmente le nombre de jours simulés', () => {
    const results = SPEEDS.map((_, i) => drive(60, 10, i, newSession()).ticks);
    expect(results[0]).toBe(0);
    expect(results[1]).toBeLessThan(results[2]);
    expect(results[2]).toBeLessThan(results[3]);
    expect(results[1]).toBe(15); // 1,5 jour par seconde pendant 10 s
  });
});
