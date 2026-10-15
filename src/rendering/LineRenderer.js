import { gridToWorld } from './IsometricProjection.js';

const hex = (c) => (typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : c);

/**
 * Lignes de bus et de tramway (v0.8) : tracés colorés (pendant le tracé d'une ligne, dans le panneau des lignes ou
 * avec la couche des transports) et véhicules qui parcourent la boucle. Purement visuel : le nombre de véhicules
 * suit la flotte en service calculée par la simulation ; une ligne interrompue ou sans dépôt ne roule pas.
 */
export class LineRenderer {
  /**
   * @param {import('pixi.js').Graphics} vehiclesG calque des véhicules (sous les bâtiments)
   * @param {import('pixi.js').Graphics} routesG calque des tracés (au-dessus de la ville)
   */
  constructor(vehiclesG, routesG) {
    this.vg = vehiclesG;
    this.rg = routesG;
    this.time = 0;
    this.geom = new Map();
    this.showRoutes = false;
    this.routeSig = '';
    this.highlight = 0;
  }

  reset() {
    this.geom = new Map();
    this.routeSig = '';
    this.vg.clear();
    this.rg.clear();
  }

  /** Points (monde) du tracé d'une ligne, mis en cache tant que le tracé ne change pas. */
  #geometry(state, line) {
    const g = state.grid;
    const sig = `${g.width}:${line.path.length}:${line.path[0]}:${line.path[line.path.length - 1]}:${line.path[line.path.length >> 1]}`;
    let c = this.geom.get(line.id);
    if (c?.sig === sig) return c;
    const pts = line.path.map((i) => {
      const w = gridToWorld(g.xOf(i) + 0.5, g.yOf(i) + 0.5, g.surfaceAlt(i));
      return { x: w.x, y: w.y, i };
    });
    c = { sig, pts };
    this.geom.set(line.id, c);
    return c;
  }

  /**
   * @param {any} state
   * @param {{x0:number,x1:number,y0:number,y1:number}} rect zone visible (coordonnées monde)
   */
  update(state, rect, dtMs, paused) {
    if (!paused) this.time += Math.min(100, dtMs) / 1000;
    const lines = state.lines?.list ?? [];
    const alive = new Set(lines.map((l) => l.id));
    for (const id of this.geom.keys()) if (!alive.has(id)) this.geom.delete(id);
    this.#routes(state, lines);
    const vg = this.vg;
    vg.clear();
    for (const line of lines) {
      if (line.status !== 'ok' || !line.path?.length || !(line.stats?.effVehicles > 0)) continue;
      const { pts } = this.#geometry(state, line);
      const n = pts.length;
      if (n < 2) continue;
      const tram = line.mode === 'tram';
      const count = Math.min(16, Math.max(1, Math.round(line.stats.effVehicles)));
      const speed = tram ? 1.5 : 1.25; // cases par seconde à l'écran
      const color = hex(line.color);
      for (let k = 0; k < count; k++) {
        const s = (this.time * speed + (k * n) / count + (line.id % 5) * 1.7) % n;
        const head = at(pts, s);
        if (head.x < rect.x0 - 40 || head.x > rect.x1 + 40 || head.y < rect.y0 - 40 || head.y > rect.y1 + 40) continue;
        if (tram) {
          // Rame de deux voitures, blanche avec un bandeau à la couleur de la ligne
          for (let c = 0; c < 2; c++) {
            const a = at(pts, s - c * 0.42 - 0.38, 3.5);
            const b = at(pts, s - c * 0.42, 3.5);
            vg.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 5.5, color: 0xf3f5f7, cap: 'round' });
            vg.moveTo(a.x, a.y + 1).lineTo(b.x, b.y + 1).stroke({ width: 1.8, color });
          }
        } else {
          const a = at(pts, s - 0.32, 3);
          vg.moveTo(a.x, a.y).lineTo(head.x, head.y - 3).stroke({ width: 5, color: 0xf2c230, cap: 'round' });
          vg.moveTo(a.x, a.y - 1.2).lineTo(head.x, head.y - 4.2).stroke({ width: 1.6, color });
        }
      }
    }
  }

  /** Tracés des lignes : une polyligne par ligne (légèrement décalée pour les tronçons communs) et ses arrêts. */
  #routes(state, lines) {
    const sig = this.showRoutes ? `${state.lines?.rev ?? 0}:${lines.length}:${this.highlight}:${lines.map((l) => `${l.id}${l.status}${l.color}${l.path?.length}`).join(',')}` : '';
    if (sig === this.routeSig) return;
    this.routeSig = sig;
    const rg = this.rg;
    rg.clear();
    if (!this.showRoutes) return;
    lines.forEach((line, k) => {
      if (!line.path?.length) return;
      const { pts } = this.#geometry(state, line);
      if (pts.length < 2) return;
      const off = (k % 5) * 1.6 - 3.2;
      const color = hex(line.color);
      const strong = this.highlight === line.id;
      const broken = line.status !== 'ok';
      rg.moveTo(pts[0].x + off, pts[0].y + off * 0.5 - 2);
      for (let i = 1; i <= pts.length; i++) {
        const p = pts[i % pts.length];
        rg.lineTo(p.x + off, p.y + off * 0.5 - 2);
      }
      rg.stroke({ width: strong ? 5 : 3, color: broken ? 0x9aa5b1 : color, alpha: broken ? 0.6 : 0.9, join: 'round' });
      for (const idx of line.stopAt ?? []) {
        const p = pts[idx];
        if (!p) continue;
        rg.circle(p.x + off, p.y + off * 0.5 - 2, strong ? 5 : 4).fill(0xffffff).stroke({ width: 2, color });
      }
    });
  }
}

/** Position interpolée le long de la boucle (abscisse en cases), légèrement surélevée. */
function at(pts, s, lift = 0) {
  const n = pts.length;
  const k = ((s % n) + n) % n;
  const a = Math.floor(k);
  const b = (a + 1) % n;
  const f = k - a;
  return { x: pts[a].x + (pts[b].x - pts[a].x) * f, y: pts[a].y + (pts[b].y - pts[a].y) * f - lift };
}
