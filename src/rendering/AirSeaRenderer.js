import { Graphics } from 'pixi.js';
import { gridToWorld, footDepth, depthOf } from './IsometricProjection.js';
import { TERRAIN } from '../world/Terrain.js';

/**
 * Avions et navires (v0.6), purement décoratifs :
 * - un avion décolle ou atterrit à l'aéroport à intervalles réguliers (ombre au sol, montée, disparition) ;
 * - un porte-conteneurs relie le port au bord de la carte par l'eau, marque l'escale, puis repart.
 * `onSound(name)` est appelé quand un passage commence à l'écran (« jet » ou « horn »).
 */
export class AirSeaRenderer {
  /** @param {import('pixi.js').Container} layer calque des objets (trié par zIndex) */
  constructor(layer) {
    this.layer = layer;
    this.time = 0;
    this.items = new Map();
    this.scanTimer = 0;
    this.onSound = null;
  }

  reset() {
    for (const it of this.items.values()) it.g.destroy();
    this.items.clear();
    this.scanTimer = 0;
  }

  #scan(state, catalog) {
    const want = new Map();
    for (const b of state.buildings.values()) {
      const id = catalog.building(b.defId).id;
      if (id === 'airport' || id === 'seaport') want.set(b.id, id);
    }
    for (const [id, it] of this.items) {
      if (!want.has(id)) {
        it.g.destroy();
        this.items.delete(id);
      }
    }
    for (const [id, kind] of want) {
      if (this.items.has(id)) continue;
      const g = new Graphics();
      this.layer.addChild(g);
      this.items.set(id, { kind, g, path: null, rev: '', lastCycle: -1 });
    }
  }

  update(state, catalog, rect, dtMs, paused) {
    this.scanTimer -= dtMs;
    if (this.scanTimer <= 0) {
      this.#scan(state, catalog);
      this.scanTimer = 800;
    }
    if (!paused) this.time += Math.min(100, dtMs) / 1000;
    const grid = state.grid;
    for (const [id, it] of this.items) {
      const b = state.buildings.get(id);
      it.g.clear();
      if (!b || b.abandoned) continue;
      if (it.kind === 'airport') this.#plane(grid, b, it, rect);
      else this.#ship(grid, b, it, rect);
    }
  }

  #visible(p, rect, m = 150) {
    return p.x > rect.x0 - m && p.x < rect.x1 + m && p.y > rect.y0 - m && p.y < rect.y1 + m;
  }

  #plane(grid, b, it, rect) {
    const PERIOD = 34;
    const cycle = Math.floor((this.time + b.id * 3.7) / PERIOD);
    const t = ((this.time + b.id * 3.7) % PERIOD) / 10; // 10 s de manœuvre au début de chaque période
    if (t > 1) return;
    const landing = cycle % 2 === 1;
    const k = landing ? 1 - t : t;
    const alt = grid.altitude[grid.idx(b.x, b.y)];
    // Piste le long de l'axe x de l'emprise, puis envol au-delà
    const u = -0.2 + k * 3.2; // en longueurs d'emprise
    const ground = gridToWorld(b.x + u * b.w, b.y + b.h * 0.55, alt);
    const climb = Math.max(0, u - 0.9) * 90;
    const p = { x: ground.x, y: ground.y - 4 - climb };
    const g = it.g;
    g.zIndex = (footDepth(b.x, b.y, b.w, b.h) + 1) * 10 + 9;
    if (!this.#visible(p, rect)) return;
    if (cycle !== it.lastCycle) {
      it.lastCycle = cycle;
      this.onSound?.('jet');
    }
    const fade = Math.max(0, Math.min(1, 1.6 - climb / 160));
    // Ombre au sol
    g.ellipse(ground.x + climb * 0.25, ground.y, 9, 3).fill({ color: 0x000000, alpha: 0.18 * fade });
    // Silhouette : fuselage dans l'axe de la piste (vers l'est, en bas à droite à l'écran), ailes en travers
    const dir = { x: 0.89, y: 0.45 };
    const n = { x: -dir.y, y: dir.x };
    const L = 11;
    const W = 9;
    const nose = { x: p.x + dir.x * L, y: p.y + dir.y * L };
    const tail = { x: p.x - dir.x * L, y: p.y - dir.y * L };
    g.moveTo(tail.x, tail.y).lineTo(nose.x, nose.y).stroke({ width: 3.2, color: 0xf4f6f8, alpha: fade, cap: 'round' });
    g.poly([p.x + n.x * W, p.y + n.y * W, p.x + dir.x * 3, p.y + dir.y * 3, p.x - n.x * W, p.y - n.y * W, p.x - dir.x * 2, p.y - dir.y * 2]).fill({ color: 0xdfe5ea, alpha: fade });
    g.poly([tail.x + n.x * 4, tail.y + n.y * 4, tail.x + dir.x * 2, tail.y + dir.y * 2, tail.x - n.x * 4, tail.y - n.y * 4]).fill({ color: 0xc84b3c, alpha: fade });
    if (landing && k < 0.4) g.circle(nose.x, nose.y, 1.4).fill({ color: 0xfff3b0, alpha: fade });
  }

  #ship(grid, b, it, rect) {
    const rev = `${grid.width}x${grid.height}`;
    if (it.rev !== rev) {
      it.rev = rev;
      it.path = waterPathToEdge(grid, b);
      it.pts = it.path.map((i) => {
        const w = gridToWorld(grid.xOf(i) + 0.5, grid.yOf(i) + 0.5, 0);
        return { x: w.x, y: w.y, i };
      });
    }
    const n = it.pts?.length ?? 0;
    if (n < 2) return;
    const travel = Math.max(10, n * 1.1);
    const period = travel * 2 + 10 + 20;
    const tt = (this.time + b.id * 5.3) % period;
    const cycle = Math.floor((this.time + b.id * 5.3) / period);
    let d;
    if (tt < travel) d = (tt / travel) * (n - 1);
    else if (tt < travel + 10) d = n - 1;
    else if (tt < travel * 2 + 10) d = (1 - (tt - travel - 10) / travel) * (n - 1);
    else return;
    const a = Math.floor(d);
    const z = Math.min(n - 1, a + 1);
    const f = d - a;
    const P = { x: it.pts[a].x + (it.pts[z].x - it.pts[a].x) * f, y: it.pts[a].y + (it.pts[z].y - it.pts[a].y) * f };
    const head = it.pts[z];
    const g = it.g;
    g.zIndex = depthOf(grid.xOf(head.i), grid.yOf(head.i)) * 10 + 4;
    if (!this.#visible(P, rect)) return;
    // Corne de brume au départ de l'escale
    if (tt >= travel + 10 && it.lastCycle !== cycle) {
      it.lastCycle = cycle;
      this.onSound?.('horn');
    }
    // Cap : vers la case suivante (ou la précédente au retour)
    const back = tt >= travel + 10;
    const A = it.pts[back ? z : a];
    const B = it.pts[back ? a : z];
    let dx = B.x - A.x;
    let dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = -dy;
    const ny = dx;
    const L = 14;
    const W = 4.5;
    const bow = { x: P.x + dx * L, y: P.y + dy * L };
    const stern = { x: P.x - dx * L, y: P.y - dy * L };
    g.poly([stern.x + nx * W, stern.y + ny * W, bow.x - dx * 3 + nx * W, bow.y - dy * 3 + ny * W, bow.x, bow.y, bow.x - dx * 3 - nx * W, bow.y - dy * 3 - ny * W, stern.x - nx * W, stern.y - ny * W])
      .fill(0x34495e);
    const colors = [0xd9473a, 0xf2c230, 0x3c7ea8, 0x58b368];
    for (let k = 0; k < 4; k++) {
      const c = { x: P.x - dx * (8 - k * 4.5), y: P.y - dy * (8 - k * 4.5) - 3 };
      g.rect(c.x - 2.4, c.y - 2.4, 4.8, 3.6).fill(colors[(k + b.id) % 4]);
    }
    // Sillage
    g.moveTo(stern.x, stern.y).lineTo(stern.x - dx * 12, stern.y - dy * 12).stroke({ width: 2, color: 0xe6f4fb, alpha: 0.55 });
  }

  destroy() {
    this.reset();
  }
}

/** Chemin sur l'eau entre le quai (eau voisine du port) et le bord de la carte, du bord vers le port. */
export function waterPathToEdge(grid, b) {
  const start = [];
  for (let dy = -1; dy <= b.h; dy++) {
    for (let dx = -1; dx <= b.w; dx++) {
      if (dx >= 0 && dy >= 0 && dx < b.w && dy < b.h) continue;
      const x = b.x + dx;
      const y = b.y + dy;
      if (grid.inBounds(x, y) && grid.terrain[grid.idx(x, y)] === TERRAIN.WATER) start.push(grid.idx(x, y));
    }
  }
  const prev = new Int32Array(grid.size).fill(-2);
  for (const i of start) prev[i] = -1;
  const queue = [...start];
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
      if (grid.terrain[j] === TERRAIN.WATER && prev[j] === -2) {
        prev[j] = i;
        queue.push(j);
      }
    }
  }
  if (end < 0) return [];
  const path = [];
  for (let i = end; i !== -1; i = prev[i]) path.push(i);
  return path;
}
