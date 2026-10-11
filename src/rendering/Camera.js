import { gridToWorld, TILE_H } from './IsometricProjection.js';

/**
 * Caméra 2D : position du centre de la vue (coordonnées monde) et zoom.
 * Indépendante de PixiJS : le Renderer applique la transformation à la scène.
 */
export class Camera {
  constructor({ minZoom = 0.2, maxZoom = 2.5 } = {}) {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.bounds = null;
    this.version = 0;
  }

  /** Limites de déplacement : l'emprise de la carte avec une marge. */
  setWorldSize(width, height) {
    const top = gridToWorld(0, 0);
    const right = gridToWorld(width, 0);
    const bottom = gridToWorld(width, height);
    const left = gridToWorld(0, height);
    this.bounds = {
      minX: left.x,
      maxX: right.x,
      minY: top.y - 120,
      maxY: bottom.y + TILE_H
    };
  }

  centerOnTile(x, y) {
    const p = gridToWorld(x + 0.5, y + 0.5);
    this.x = p.x;
    this.y = p.y;
    this.#clamp();
  }

  pan(dxScreen, dyScreen) {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.#clamp();
  }

  /** Zoom en conservant le point de l'écran (sx, sy) sous le curseur. */
  zoomAt(factor, sx, sy, view) {
    const before = { x: (sx - view.width / 2) / this.zoom + this.x, y: (sy - view.height / 2) / this.zoom + this.y };
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.x = before.x - (sx - view.width / 2) / this.zoom;
    this.y = before.y - (sy - view.height / 2) / this.zoom;
    this.#clamp();
  }

  #clamp() {
    if (this.bounds) {
      this.x = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, this.x));
      this.y = Math.min(this.bounds.maxY, Math.max(this.bounds.minY, this.y));
    }
    this.version++;
  }

  /** Rectangle monde visible. */
  viewRect(view, margin = 64) {
    const hw = view.width / 2 / this.zoom + margin;
    const hh = view.height / 2 / this.zoom + margin;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }
}
