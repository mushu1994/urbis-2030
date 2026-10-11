/**
 * Horloge de simulation à pas fixe.
 * Le rendu peut tourner à n'importe quelle fréquence : l'horloge accumule le temps réel écoulé
 * et indique combien de ticks déterministes exécuter, avec un plafond par image pour éviter
 * de bloquer le navigateur (rattrapage limité après un onglet en arrière-plan).
 */
export const SPEEDS = Object.freeze([
  { id: 'pause', label: 'Pause', ticksPerSecond: 0 },
  // Vitesse normale : un mois (30 jours) par minute de temps réel
  { id: 'normal', label: 'Normale', ticksPerSecond: 0.5 },
  { id: 'fast', label: 'Rapide', ticksPerSecond: 1.5 },
  { id: 'ultra', label: 'Très rapide', ticksPerSecond: 4.5 }
]);

export class SimulationClock {
  /**
   * @param {{maxTicksPerFrame?:number, maxFrameMs?:number}} [opts]
   */
  constructor({ maxTicksPerFrame = 6, maxFrameMs = 250 } = {}) {
    this.speedIndex = 1;
    this.accumulator = 0;
    this.maxTicksPerFrame = maxTicksPerFrame;
    this.maxFrameMs = maxFrameMs;
    this.droppedMs = 0;
  }

  get speed() {
    return SPEEDS[this.speedIndex];
  }

  get paused() {
    return this.speedIndex === 0;
  }

  setSpeed(index) {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, index));
    if (this.speedIndex === 0) this.accumulator = 0;
  }

  /**
   * @param {number} dtMs temps réel écoulé depuis l'image précédente
   * @returns {number} nombre de ticks à exécuter maintenant
   */
  advance(dtMs) {
    const tps = this.speed.ticksPerSecond;
    if (tps <= 0 || !(dtMs > 0)) return 0;
    // Un onglet inactif peut renvoyer un dt de plusieurs secondes : on le borne.
    const dt = Math.min(dtMs, this.maxFrameMs);
    if (dtMs > dt) this.droppedMs += dtMs - dt;
    this.accumulator += dt;
    const interval = 1000 / tps;
    // Tolérance d'arrondi : le découpage en images ne doit pas changer le nombre de ticks.
    let ticks = Math.floor(this.accumulator / interval + 1e-6);
    if (ticks > this.maxTicksPerFrame) {
      ticks = this.maxTicksPerFrame;
      this.accumulator = 0; // on abandonne le retard plutôt que de geler l'affichage
    } else {
      this.accumulator = Math.max(0, this.accumulator - ticks * interval);
    }
    return ticks;
  }
}
