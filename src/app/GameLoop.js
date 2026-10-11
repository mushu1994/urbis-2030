/**
 * Boucle principale : sépare les ticks de simulation (pas fixe, déterministes) du rendu (fréquence du navigateur).
 * Un budget de temps par image évite de bloquer l'affichage quand la simulation prend du retard.
 */
export class GameLoop {
  /**
   * @param {{clock: import('../simulation/SimulationClock.js').SimulationClock, step:()=>void, frame:(dtMs:number, ticks:number)=>void, budgetMs?:number}} p
   */
  constructor({ clock, step, frame, budgetMs = 10 }) {
    this.clock = clock;
    this.step = step;
    this.frame = frame;
    this.budgetMs = budgetMs;
    this.running = false;
    this.last = 0;
    this.raf = 0;
    this.ticksRun = 0;
    this.onError = null;
    this.loop = this.loop.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  loop(now) {
    if (!this.running) return;
    const dt = now - this.last;
    this.last = now;
    let ticks = 0;
    try {
      const wanted = this.clock.advance(dt);
      const t0 = performance.now();
      for (; ticks < wanted; ticks++) {
        if (ticks > 0 && performance.now() - t0 > this.budgetMs) {
          this.clock.accumulator = 0; // retard abandonné plutôt que de figer l'affichage
          break;
        }
        this.step();
      }
      this.ticksRun += ticks;
      this.frame(dt, ticks);
    } catch (err) {
      this.running = false;
      this.onError?.(err);
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  }
}
