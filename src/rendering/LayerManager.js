import { Container, Graphics } from 'pixi.js';
import { gridToWorld, HEIGHT_STEP } from './IsometricProjection.js';

export const CHUNK = 16;

/**
 * Pile des calques de la scène, du sol vers le ciel :
 * terrain → sol (routes, zones) → couche de données → véhicules → objets (bâtiments, arbres, triés en profondeur)
 * → alertes → sélection et prévisualisation.
 */
export class LayerManager {
  constructor() {
    this.world = new Container();
    this.terrain = new Container();
    this.ground = new Container();
    this.overlay = new Graphics();
    this.vehicles = new Graphics();
    this.objects = new Container();
    this.objects.sortableChildren = true;
    this.alerts = new Graphics();
    this.selection = new Graphics();
    this.ghost = new Graphics();
    this.ghost.alpha = 0.62;
    this.world.addChild(this.terrain, this.ground, this.overlay, this.vehicles, this.objects, this.alerts, this.ghost, this.selection);
  }

  clear() {
    for (const c of [this.terrain, this.ground, this.objects]) {
      for (const child of c.removeChildren()) child.destroy();
    }
    for (const g of [this.overlay, this.vehicles, this.alerts, this.selection, this.ghost]) g.clear();
  }
}

/**
 * Calque découpé en tronçons de CHUNK×CHUNK cases : seuls les tronçons modifiés sont redessinés,
 * et les tronçons hors écran sont masqués.
 */
export class ChunkedLayer {
  /**
   * @param {Container} parent
   * @param {number} width largeur de la grille
   * @param {number} height
   * @param {(g: Graphics, x0:number, y0:number, x1:number, y1:number) => void} drawFn
   */
  constructor(parent, width, height, drawFn) {
    this.parent = parent;
    this.cw = Math.ceil(width / CHUNK);
    this.ch = Math.ceil(height / CHUNK);
    this.width = width;
    this.height = height;
    this.drawFn = drawFn;
    this.chunks = [];
    this.dirty = new Set();
    // Ordre de dessin : diagonales croissantes (ordre du peintre)
    const order = [];
    for (let cy = 0; cy < this.ch; cy++) for (let cx = 0; cx < this.cw; cx++) order.push([cx, cy]);
    order.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
    for (const [cx, cy] of order) {
      const g = new Graphics();
      g.label = `chunk-${cx}-${cy}`;
      const x0 = cx * CHUNK;
      const y0 = cy * CHUNK;
      const x1 = Math.min(width, x0 + CHUNK);
      const y1 = Math.min(height, y0 + CHUNK);
      const top = gridToWorld(x0, y0, 4);
      const right = gridToWorld(x1, y0, 0);
      const bottom = gridToWorld(x1, y1, 0);
      const left = gridToWorld(x0, y1, 0);
      g.__bounds = { x0: left.x, x1: right.x, y0: top.y - 20, y1: bottom.y + 4 * HEIGHT_STEP + 8 };
      g.__range = { x0, y0, x1, y1 };
      this.chunks[cy * this.cw + cx] = g;
      parent.addChild(g);
      this.dirty.add(cy * this.cw + cx);
    }
  }

  markTile(x, y) {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    if (cx >= 0 && cy >= 0 && cx < this.cw && cy < this.ch) this.dirty.add(cy * this.cw + cx);
    // Les falaises débordent sur le tronçon voisin : on le redessine aussi en bordure.
    if (x % CHUNK === 0 && cx > 0) this.dirty.add(cy * this.cw + cx - 1);
    if (y % CHUNK === 0 && cy > 0) this.dirty.add((cy - 1) * this.cw + cx);
  }

  markAll() {
    for (let k = 0; k < this.chunks.length; k++) this.dirty.add(k);
  }

  /** Redessine au plus `max` tronçons modifiés. */
  flush(max = Infinity) {
    let n = 0;
    for (const k of [...this.dirty]) {
      if (n >= max) break;
      const g = this.chunks[k];
      g.clear();
      const r = g.__range;
      this.drawFn(g, r.x0, r.y0, r.x1, r.y1);
      this.dirty.delete(k);
      n++;
    }
    return n;
  }

  cull(rect) {
    for (const g of this.chunks) {
      const b = g.__bounds;
      g.visible = !(b.x1 < rect.x0 || b.x0 > rect.x1 || b.y1 < rect.y0 || b.y0 > rect.y1);
    }
  }
}
