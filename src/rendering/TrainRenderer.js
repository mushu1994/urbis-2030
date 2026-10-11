import { Graphics } from 'pixi.js';
import { gridToWorld } from './IsometricProjection.js';

const RAIL_DETAILS = new Set(['train', 'hyperloop']);

/**
 * Animation des rames dans les gares et des capsules d'hyperboucle.
 * Purement visuel : la fréquence de passage suit la fréquentation calculée par la simulation,
 * une gare hors service (électricité, accès, personnel) ne voit passer aucun train.
 * Chaque gare a son objet graphique, trié en profondeur juste devant le bâtiment.
 */
export class TrainRenderer {
  /** @param {import('pixi.js').Container} layer calque des objets (trié par zIndex) */
  constructor(layer) {
    this.layer = layer;
    this.gfx = new Map();
    this.stations = [];
    this.time = 0;
    this.scanTimer = 0;
  }

  /** Après un changement de partie : les objets graphiques ont été détruits avec le calque. */
  reset() {
    this.gfx.clear();
    this.stations = [];
    this.scanTimer = 0;
  }

  #scan(state, catalog) {
    this.stations = [];
    for (const b of state.buildings.values()) {
      const def = catalog.building(b.defId);
      if (RAIL_DETAILS.has(def.visual.detail)) this.stations.push({ id: b.id, kind: def.visual.detail, height: def.visual.height });
    }
    const ids = new Set(this.stations.map((s) => s.id));
    for (const [id, g] of this.gfx) {
      if (!ids.has(id)) {
        g.destroy();
        this.gfx.delete(id);
      }
    }
  }

  /**
   * @param {any} state
   * @param {any} catalog
   * @param {{x0:number,x1:number,y0:number,y1:number}} rect zone visible
   * @param {number} dtMs
   * @param {boolean} paused
   */
  update(state, catalog, rect, dtMs, paused) {
    this.scanTimer -= dtMs;
    if (this.scanTimer <= 0) {
      this.#scan(state, catalog);
      this.scanTimer = 500;
    }
    if (!paused) this.time += Math.min(100, dtMs) / 1000;
    const grid = state.grid;
    for (const st of this.stations) {
      const b = state.buildings.get(st.id);
      if (!b) continue;
      let g = this.gfx.get(st.id);
      if (!g) {
        g = new Graphics();
        this.gfx.set(st.id, g);
        this.layer.addChild(g);
      }
      g.zIndex = (b.x + b.w - 1 + b.y + b.h - 1) * 10 + 5.5;
      g.clear();
      if (!b.transitActive) continue;
      const alt = grid.altitude[grid.idx(b.x, b.y)];
      const p = (u, v, z = 0) => {
        const w = gridToWorld(b.x + u * b.w, b.y + v * b.h, alt);
        return { x: w.x, y: w.y - z };
      };
      const c = p(0.5, 0.5);
      if (c.x < rect.x0 - 80 || c.x > rect.x1 + 80 || c.y < rect.y0 - 80 || c.y > rect.y1 + 80) continue;
      // Plus il y a de voyageurs, plus les passages sont fréquents
      const pax = b.transitPassengers ?? 0;
      const period = Math.max(5, Math.min(16, 16 - pax / 250));
      const phase = ((this.time + (b.id % 7) * 1.3) % period) / period;
      if (st.kind === 'train') drawTrain(g, p, phase);
      else drawCapsule(g, p, phase, st.height);
    }
  }

  destroy() {
    for (const g of this.gfx.values()) g.destroy();
    this.gfx.clear();
  }
}

/** Position de la tête de rame selon la phase : arrivée, arrêt à quai, départ, voie libre. */
export function trainHead(phase) {
  const STOP = 0.9;
  if (phase < 0.3) {
    const k = phase / 0.3;
    return -0.2 + (STOP + 0.2) * (1 - (1 - k) * (1 - k)); // décélération
  }
  if (phase < 0.6) return STOP;
  if (phase < 0.9) {
    const k = (phase - 0.6) / 0.3;
    return STOP + 1.1 * k * k; // accélération
  }
  return null;
}

function drawTrain(g, p, phase) {
  const head = trainHead(phase);
  if (head === null) return;
  const LEN = 0.78;
  const u0 = Math.max(0.02, head - LEN);
  const u1 = Math.min(0.98, head);
  if (u1 - u0 < 0.02) return;
  const V = 1.04;
  const side = [p(u0, V, 2), p(u1, V, 2), p(u1, V, 10), p(u0, V, 10)];
  const top = [p(u0, V, 10), p(u1, V, 10), p(u1, V - 0.12, 10), p(u0, V - 0.12, 10)];
  g.poly(top.flatMap((q) => [q.x, q.y])).fill(0xb9c2cc);
  g.poly(side.flatMap((q) => [q.x, q.y])).fill(0xeef1f4);
  const band = [p(u0, V, 5.5), p(u1, V, 5.5), p(u1, V, 7), p(u0, V, 7)];
  g.poly(band.flatMap((q) => [q.x, q.y])).fill(0xc84b3c);
  // Fenêtres
  for (let u = u0 + 0.05; u < u1 - 0.04; u += 0.09) {
    const a = p(u, V, 7.6);
    const z = p(Math.min(u + 0.05, u1 - 0.02), V, 7.6);
    g.moveTo(a.x, a.y).lineTo(z.x, z.y).stroke({ width: 1.6, color: 0x2f3b48 });
  }
  // Nez profilé à l'avant
  if (head <= 0.98) {
    const n = p(u1, V, 6);
    g.circle(n.x, n.y, 1.2).fill(0xfff3b0);
  }
}

function drawCapsule(g, p, phase, height) {
  const z = height + 6;
  const draw = (k) => {
    const head = -0.3 + 1.6 * k;
    const u0 = Math.max(-0.3, head - 0.22);
    const u1 = Math.min(1.3, head);
    if (u1 <= u0) return;
    const a = p(u0, 0.5, z);
    const b = p(u1, 0.5, z);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 5, color: 0xf4f8fb, cap: 'round' });
    g.circle(b.x, b.y, 1.6).fill(0x5be3f2);
  };
  // Deux capsules en sens inverse, très rapides
  const k = (phase * 2) % 1;
  draw(k);
  draw(1 - ((k + 0.5) % 1));
}
