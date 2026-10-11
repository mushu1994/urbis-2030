import { gridToWorld } from './IsometricProjection.js';
import { drawBuilding } from './art/BuildingArt.js';
import { hex } from './art/color.js';

const OK = 0x42d77d;
const BAD = 0xff5050;

/**
 * Dessin du survol, de la sélection et des prévisualisations de placement.
 * Ne lit que des données fournies (état + spécification) et ne modifie rien.
 */
export class SelectionRenderer {
  /**
   * @param {import('pixi.js').Graphics} g calque de sélection (contours)
   * @param {import('pixi.js').Graphics} ghost calque translucide (bâtiment fantôme)
   */
  constructor(g, ghost) {
    this.g = g;
    this.ghost = ghost;
  }

  #diamond(state, x, y, color, alpha = 0.35, stroke = true) {
    const alt = state.grid.surfaceAlt(state.grid.idx(x, y));
    const T = gridToWorld(x, y, alt);
    const R = gridToWorld(x + 1, y, alt);
    const B = gridToWorld(x + 1, y + 1, alt);
    const L = gridToWorld(x, y + 1, alt);
    const pts = [T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y];
    this.g.poly(pts).fill({ color, alpha });
    if (stroke) this.g.poly(pts).stroke({ width: 1.2, color, alpha: 0.95 });
  }

  #outline(state, x, y, w, h, color, width = 2) {
    const alt = state.grid.altitude[state.grid.idx(x, y)];
    const T = gridToWorld(x, y, alt);
    const R = gridToWorld(x + w, y, alt);
    const B = gridToWorld(x + w, y + h, alt);
    const L = gridToWorld(x, y + h, alt);
    this.g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).stroke({ width, color, alpha: 1 });
  }

  /** Cercle de rayon r cases (projeté en ellipse isométrique). */
  #ring(state, cx, cy, r, color) {
    const alt = state.grid.altitude[state.grid.idx(Math.floor(cx), Math.floor(cy))] ?? 0;
    const pts = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const p = gridToWorld(cx + Math.cos(a) * r, cy + Math.sin(a) * r, alt);
      pts.push(p.x, p.y);
    }
    this.g.poly(pts).fill({ color, alpha: 0.07 });
    this.g.poly(pts).stroke({ width: 1.5, color, alpha: 0.6 });
  }

  /**
   * @param {any} state
   * @param {{hover?:{x:number,y:number}, preview?:any, selected?:any, catalog:any}} spec
   */
  draw(state, spec) {
    const g = this.g;
    g.clear();
    this.ghost.clear();
    const { hover, preview, selected, catalog } = spec;
    const grid = state.grid;

    if (selected) {
      const def = catalog.building(selected.defId);
      this.#outline(state, selected.x, selected.y, selected.w, selected.h, 0xffd34d, 2.5);
      const svc = def.capacity.service ?? def.capacity.logistics;
      if (svc?.radius) this.#ring(state, selected.x + selected.w / 2, selected.y + selected.h / 2, svc.radius, 0xffd34d);
    }

    if (preview) {
      const color = preview.ok ? OK : BAD;
      if (preview.kind === 'road') {
        for (const t of preview.tiles) {
          const c = t.status === 'invalid' ? BAD : t.status === 'same' ? 0x9aa5b1 : preview.ok ? OK : 0xffb347;
          this.#diamond(state, t.x, t.y, c, 0.45);
        }
      } else if (preview.kind === 'rect') {
        const { x0, y0, x1, y1 } = preview.rect;
        const eligible = preview.eligible ? new Set(preview.eligible) : null;
        const zc = preview.color ? hex(preview.color) : color;
        for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(grid.height - 1, Math.max(y0, y1)); y++) {
          for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(grid.width - 1, Math.max(x0, x1)); x++) {
            const i = grid.idx(x, y);
            const ok = eligible ? eligible.has(i) : true;
            this.#diamond(state, x, y, ok ? (preview.ok ? zc : BAD) : 0x555555, ok ? 0.42 : 0.12, ok);
          }
        }
      } else if (preview.kind === 'building') {
        const def = preview.def;
        for (let dy = 0; dy < preview.h; dy++) {
          for (let dx = 0; dx < preview.w; dx++) {
            if (grid.inBounds(preview.x + dx, preview.y + dy)) this.#diamond(state, preview.x + dx, preview.y + dy, color, 0.3, false);
          }
        }
        if (grid.inBounds(preview.x, preview.y)) {
          const alt = grid.altitude[grid.idx(preview.x, preview.y)];
          drawBuilding(this.ghost, def, { id: 0, x: preview.x, y: preview.y, w: preview.w, h: preview.h }, alt);
          this.#outline(state, preview.x, preview.y, preview.w, preview.h, color, 2);
          const svc = def.capacity.service ?? def.capacity.logistics;
          if (svc?.radius) this.#ring(state, preview.x + preview.w / 2, preview.y + preview.h / 2, svc.radius, 0x6ec6ff);
        }
      }
    }

    if (hover && grid.inBounds(hover.x, hover.y) && !preview) {
      this.#diamond(state, hover.x, hover.y, 0xffffff, 0.18);
    }
  }
}
