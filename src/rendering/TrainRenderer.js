import { Graphics } from 'pixi.js';
import { gridToWorld, footDepth, depthOf } from './IsometricProjection.js';

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
    /** Trains régionaux sur les voies (v0.6) : par gare reliée, tracé et objet graphique. */
    this.lines = new Map();
  }

  /** Après un changement de partie : les objets graphiques ont été détruits avec le calque. */
  reset() {
    this.gfx.clear();
    this.lines = new Map();
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
      g.zIndex = footDepth(b.x, b.y, b.w, b.h) * 10 + 5.5;
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
    this.#lineTrains(state, rect);
  }

  /**
   * Trains régionaux (v0.6) : pour chaque gare reliée par les rails au bord de la carte, une rame de trois voitures
   * arrive de la région le long de la voie, marque l'arrêt, puis repart. Fréquence selon la fréquentation.
   */
  #lineTrains(state, rect) {
    const grid = state.grid;
    const rev = `${state.revisions?.rail ?? 0}:${grid.width}`;
    const alive = new Set();
    for (const st of this.stations) {
      if (st.kind !== 'train') continue;
      const b = state.buildings.get(st.id);
      if (!b?.railLinked || !b.transitActive) continue;
      alive.add(st.id);
      let line = this.lines.get(st.id);
      if (!line || line.rev !== rev) {
        line?.g.destroy();
        const path = railPathToEdge(grid, b);
        const g = new Graphics();
        this.layer.addChild(g);
        line = { rev, path, g, pts: path.map((i) => { const w = gridToWorld(grid.xOf(i) + 0.5, grid.yOf(i) + 0.5, grid.surfaceAlt(i)); return { x: w.x, y: w.y, i }; }) };
        this.lines.set(st.id, line);
      }
      const g = line.g;
      g.clear();
      const n = line.pts.length;
      if (n < 2) continue;
      const pax = b.transitPassengers ?? 0;
      const travel = Math.max(4, n * 0.45);
      const period = travel * 2 + 4 + Math.max(4, 22 - pax / 200);
      const t = (this.time + (b.id % 11) * 2.1) % period;
      // Distance (en cases) depuis le bord : aller, arrêt, retour, puis voie libre
      let d;
      if (t < travel) d = (t / travel) * (n - 1);
      else if (t < travel + 4) d = n - 1;
      else if (t < travel * 2 + 4) d = (1 - (t - travel - 4) / travel) * (n - 1);
      else continue;
      const head = line.pts[Math.min(n - 1, Math.round(d))];
      if (head.x < rect.x0 - 120 || head.x > rect.x1 + 120 || head.y < rect.y0 - 120 || head.y > rect.y1 + 120) continue;
      g.zIndex = depthOf(grid.xOf(head.i), grid.yOf(head.i)) * 10 + 6.5;
      const at = (s) => {
        const k = Math.max(0, Math.min(n - 1, s));
        const a = Math.floor(k);
        const z = Math.min(n - 1, a + 1);
        const f = k - a;
        return { x: line.pts[a].x + (line.pts[z].x - line.pts[a].x) * f, y: line.pts[a].y + (line.pts[z].y - line.pts[a].y) * f - 5 };
      };
      for (let c = 0; c < 3; c++) {
        const s1 = d - c * 0.95;
        const s0 = s1 - 0.8;
        if (s1 < 0) break;
        const A = at(Math.max(0, s0));
        const B = at(s1);
        g.moveTo(A.x, A.y).lineTo(B.x, B.y).stroke({ width: 7, color: 0xeef1f4, cap: 'round' });
        g.moveTo(A.x, A.y + 1).lineTo(B.x, B.y + 1).stroke({ width: 1.6, color: 0xc84b3c });
        if (c === 0) g.circle(B.x, B.y, 1.4).fill(0xfff3b0);
      }
    }
    for (const [id, line] of this.lines) {
      if (!alive.has(id)) {
        line.g.destroy();
        this.lines.delete(id);
      }
    }
  }

  destroy() {
    for (const g of this.gfx.values()) g.destroy();
    this.gfx.clear();
    for (const l of this.lines.values()) l.g.destroy();
    this.lines.clear();
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

/**
 * Plus court chemin sur les rails entre le bord de la carte et une case de voie qui touche la gare
 * (liste de cases du bord vers la gare ; vide si la gare n'est pas reliée).
 */
export function railPathToEdge(grid, b) {
  const start = [];
  for (let dy = -1; dy <= b.h; dy++) {
    for (let dx = -1; dx <= b.w; dx++) {
      if (dx >= 0 && dy >= 0 && dx < b.w && dy < b.h) continue;
      const x = b.x + dx;
      const y = b.y + dy;
      if (grid.inBounds(x, y) && grid.rail[grid.idx(x, y)]) start.push(grid.idx(x, y));
    }
  }
  const prev = new Int32Array(grid.size).fill(-2);
  const queue = [...start];
  for (const i of start) prev[i] = -1;
  const nb = new Int32Array(4);
  let end = -1;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = grid.xOf(i);
    const y = grid.yOf(i);
    if (x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1) {
      end = i;
      break;
    }
    const n = grid.neighbors4(i, nb);
    for (let k = 0; k < n; k++) {
      const j = nb[k];
      if (grid.rail[j] && prev[j] === -2) {
        prev[j] = i;
        queue.push(j);
      }
    }
  }
  if (end < 0) return [];
  const path = [];
  for (let i = end; i !== -1; i = prev[i]) path.push(i);
  return path; // du bord vers la gare
}
