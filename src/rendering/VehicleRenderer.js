import { tileCenter, TILE_W, TILE_H } from './IsometricProjection.js';

const COLORS = [0xe8e8e8, 0xd94c3d, 0x3d6fd9, 0x2c2c2c, 0xf2c53d, 0x5aa66a, 0x9aa5b1];
const AV_COLOR = 0x59d0e8;

/**
 * Animation décorative des véhicules et des drones.
 * Le nombre de véhicules affichés est proportionnel aux flux calculés par la simulation (couche « traffic »),
 * mais leurs mouvements sont purement visuels : ils ne modifient jamais l'état du jeu.
 */
export class VehicleRenderer {
  constructor(g) {
    this.g = g;
    this.cars = [];
    this.drones = [];
    this.weights = null;
    this.roadTiles = [];
    this.total = 0;
    this.seed = 1;
    this.enabled = true;
  }

  #rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Recalcule la distribution des apparitions à partir des flux de trafic publiés. */
  refresh(state) {
    const g = state.grid;
    const tiles = [];
    const cum = [];
    let total = 0;
    for (let i = 0; i < g.size; i++) {
      if (!g.road[i] || g.traffic[i] <= 1) continue;
      total += g.traffic[i];
      tiles.push(i);
      cum.push(total);
    }
    this.roadTiles = tiles;
    this.weights = cum;
    this.total = total;
    this.target = Math.min(450, Math.round(total / 18));
    this.avShare = state.tech.researched.autonomous_vehicles ? 0.35 : 0;
    // Bus : une part des véhicules affichés, proportionnelle aux voyageurs (environ 40 par bus)
    // Lignes tracées (v0.8) : les bus des lignes suivent leur parcours (LineRenderer) ; seuls les bus du réseau de
    // base circulent au hasard
    const ts = state.transit?.stats ?? {};
    const busTrips = ((ts.busNetwork && ts.busNetwork !== 'auto' ? ts.basePassengers : ts.passengers?.bus) ?? 0) / 40;
    const carTrips = state.traffic?.stats?.vehicleTrips ?? 0;
    this.busShare = carTrips + busTrips > 0 ? Math.min(0.3, busTrips / (carTrips + busTrips)) : 0;
    this.era = state.progression?.era ?? 1;
    this.hubs = [...state.buildings.values()].filter((b) => b.defId === 'drone_hub' && (b.utilization ?? 0) > 0.02);
  }

  #spawnTile() {
    const r = this.#rand() * this.total;
    let lo = 0;
    let hi = this.weights.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.weights[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return this.roadTiles[lo];
  }

  #nextTile(state, i, from) {
    const g = state.grid;
    const w = g.width;
    const cand = [];
    let sum = 0;
    for (const n of [i - w, i + 1, i + w, i - 1]) {
      if (n < 0 || n >= g.size || !g.road[n] || n === from) continue;
      if (Math.abs((n % w) - (i % w)) > 1) continue;
      if (Math.abs(g.surfaceAlt(n) - g.surfaceAlt(i)) > 1) continue;
      const wt = 1 + g.traffic[n];
      cand.push([n, wt]);
      sum += wt;
    }
    if (!cand.length) return from >= 0 ? from : -1;
    let r = this.#rand() * sum;
    for (const [n, wt] of cand) {
      r -= wt;
      if (r <= 0) return n;
    }
    return cand[cand.length - 1][0];
  }

  update(state, dtMs, viewRect, paused = false) {
    const g = this.g;
    g.clear();
    const lights = this.lightsG;
    lights?.clear();
    const night = this.night ?? 0;
    if (!this.enabled || !this.weights) return;
    const grid = state.grid;
    while (this.cars.length < this.target && this.weights.length) {
      const i = this.#spawnTile();
      const bus = this.#rand() < this.busShare;
      const color = bus ? 0xe2b13c : this.#rand() < this.avShare ? AV_COLOR : COLORS[Math.floor(this.#rand() * COLORS.length)];
      this.cars.push({ i, from: -1, to: this.#nextTile(state, i, -1), t: this.#rand(), life: 8 + this.#rand() * 20, color, bus });
    }
    if (this.cars.length > this.target) this.cars.length = this.target;
    const dt = Math.min(0.1, dtMs / 1000);
    for (let k = this.cars.length - 1; k >= 0; k--) {
      const c = this.cars[k];
      if (c.to < 0 || !grid.road[c.i] || !grid.road[c.to]) {
        this.cars.splice(k, 1);
        continue;
      }
      const vc = grid.congestion[c.i];
      const speed = paused ? 0 : 1.6 / (1 + vc * vc * 2);
      c.t += dt * speed;
      c.life -= dt;
      if (c.t >= 1) {
        c.t -= 1;
        const nxt = this.#nextTile(state, c.to, c.i);
        c.from = c.i;
        c.i = c.to;
        c.to = nxt;
        if (c.life <= 0) {
          this.cars.splice(k, 1);
          continue;
        }
      }
      const a = tileCenter(grid.xOf(c.i), grid.yOf(c.i), grid.surfaceAlt(c.i));
      const b = tileCenter(grid.xOf(c.to), grid.yOf(c.to), grid.surfaceAlt(c.to));
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      // Décalage à droite de la chaussée
      const ox = (-dy / len) * 5;
      const oy = (dx / len) * 2.5;
      const x = a.x + dx * c.t + ox;
      const y = a.y + dy * c.t + oy;
      if (x < viewRect.x0 || x > viewRect.x1 || y < viewRect.y0 || y > viewRect.y1) continue;
      const scale = c.bus ? 1.9 : 1;
      const hx = (dx / len) * 4 * scale;
      const hy = (dy / len) * 2 * scale;
      g.poly([x - hx - 1.5, y - hy - 1.5, x + hx - 1.5, y + hy - 1.5, x + hx + 1.5, y + hy + 0.5, x - hx + 1.5, y - hy + 0.5]).fill(c.color);
      // Phares la nuit (calque lumineux)
      if (lights && night > 0.25) {
        lights.circle(x + hx * 1.25, y + hy * 1.25, 1.8).fill({ color: 0xfff1b8, alpha: 0.75 });
        lights.circle(x + hx * 2.2, y + hy * 2.2, 4).fill({ color: 0xfff1b8, alpha: 0.1 });
        lights.circle(x - hx * 1.1, y - hy * 1.1, 1.2).fill({ color: 0xff3b2f, alpha: 0.8 });
      }
    }

    // Ère symbiotique : drones de service au-dessus de la ville
    if (this.era >= 3 && this.roadTiles.length) {
      const now = performance.now() / 1000;
      const n = Math.min(14, Math.ceil(this.roadTiles.length / 40));
      for (let k = 0; k < n; k++) {
        const i = this.roadTiles[(k * 977) % this.roadTiles.length];
        const c = tileCenter(grid.xOf(i), grid.yOf(i), grid.surfaceAlt(i));
        const ph = now * (0.18 + (k % 5) * 0.03) + k * 2.1;
        const x = c.x + Math.cos(ph) * TILE_W * 2.5;
        const y = c.y + Math.sin(ph) * TILE_H * 2.5 - 60;
        if (x < viewRect.x0 || x > viewRect.x1 || y < viewRect.y0 || y > viewRect.y1) continue;
        g.circle(x, y + 60, 2).fill({ color: 0x000000, alpha: 0.12 });
        g.rect(x - 3.5, y - 0.8, 7, 1.6).fill(0x2a2f36);
        g.circle(x, y, 1.5).fill(0x5be3f2);
      }
    }

    // Drones autour des hubs actifs
    if (this.hubs?.length) {
      const now = performance.now() / 1000;
      for (const h of this.hubs) {
        const n = Math.max(1, Math.round((h.utilization ?? 0) * 6));
        const c = tileCenter(h.x, h.y, grid.altitude[grid.idx(h.x, h.y)]);
        for (let k = 0; k < n; k++) {
          const ph = now * (0.25 + k * 0.05) + k * 1.7 + h.id;
          const r = 1.5 + ((k * 37) % 7);
          const x = c.x + Math.cos(ph) * r * TILE_W * 0.5;
          const y = c.y + Math.sin(ph) * r * TILE_H * 0.5 - 30 - (k % 3) * 6;
          g.circle(x, y + 30, 2.5).fill({ color: 0x000000, alpha: 0.15 });
          g.rect(x - 3, y - 0.8, 6, 1.6).fill(0x222222);
          g.circle(x, y, 1.4).fill(0xf0b429);
        }
      }
    }
  }
}
