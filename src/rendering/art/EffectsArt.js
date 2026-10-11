import { gridToWorld } from '../IsometricProjection.js';
import { footprintCorners } from './BuildingArt.js';
import { hash2 } from '../../util/rng.js';
import { shade } from './color.js';

/**
 * Dessins des effets : chantiers (échafaudages, grues), fenêtres éclairées la nuit, éclairage public,
 * points d'émission des fumées. Tout est procédural et original.
 */

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const up = (p, h) => ({ x: p.x, y: p.y - h });
const flat = (...pts) => pts.flatMap((p) => [p.x, p.y]);

const GLASSY = new Set(['glass', 'aiTower', 'hologram', 'solarGlass', 'cleanroom']);

/** Durée d'un chantier (jours de jeu) : purement visuelle, le bâtiment fonctionne déjà. */
export function constructionDays(def) {
  if (def.kind === 'growable') return 10 + Math.min(8, Math.round(def.visual.height / 8));
  if (def.visual.roof === 'park' || def.visual.detail === 'pylon' || def.visual.roof === 'none') return 0;
  return 5 + Math.min(6, Math.round((def.footprint.w * def.footprint.h) / 2));
}

/**
 * Chantier : dalle, structure qui monte avec l'avancement, échafaudages et bâches.
 * @param {number} progress 0..1
 */
export function drawConstructionSite(g, def, b, alt, progress) {
  const ground = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.03);
  g.poly(flat(ground.T, ground.R, ground.B, ground.L)).fill(0xb9a98a);
  // Palissade de chantier
  const fence = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.05);
  for (const [a, c] of [[fence.L, fence.B], [fence.B, fence.R]]) {
    g.poly(flat(a, c, up(c, 3), up(a, 3))).fill(0xe8e2d4);
    g.poly(flat(lerp(a, c, 0.2), lerp(a, c, 0.4), up(lerp(a, c, 0.4), 3), up(lerp(a, c, 0.2), 3))).fill(0xd9473a);
    g.poly(flat(lerp(a, c, 0.6), lerp(a, c, 0.8), up(lerp(a, c, 0.8), 3), up(lerp(a, c, 0.6), 3))).fill(0xd9473a);
  }
  const H = Math.max(4, def.visual.height * (0.25 + 0.75 * progress));
  const { T, R, B, L } = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.2);
  // Structure en cours (béton brut)
  const concrete = 0xbfc2c0;
  g.poly(flat(L, B, up(B, H), up(L, H))).fill(shade(concrete, 0.86));
  g.poly(flat(B, R, up(R, H), up(B, H))).fill(shade(concrete, 0.7));
  g.poly(flat(up(T, H), up(R, H), up(B, H), up(L, H))).fill(shade(concrete, 1.04));
  // Planchers visibles
  for (let h = 6; h < H - 1; h += 7) {
    g.moveTo(L.x, L.y - h).lineTo(B.x, B.y - h).lineTo(R.x, R.y - h).stroke({ width: 1, color: 0x8b8f8d, alpha: 0.9 });
  }
  // Échafaudage (tubes) et bâche sur la face avant
  const sc = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.12);
  const sh = H + 3;
  g.poly(flat(sc.L, sc.B, up(sc.B, sh * 0.55), up(sc.L, sh * 0.55))).fill({ color: 0x2f7fc1, alpha: 0.35 });
  for (const [a, c] of [[sc.L, sc.B], [sc.B, sc.R]]) {
    const n = Math.max(2, Math.round(Math.hypot(c.x - a.x, c.y - a.y) / 10));
    for (let k = 0; k <= n; k++) {
      const p = lerp(a, c, k / n);
      g.moveTo(p.x, p.y).lineTo(p.x, p.y - sh).stroke({ width: 1, color: 0xd8a33a });
    }
    for (let h = 5; h <= sh; h += 6) g.moveTo(a.x, a.y - h).lineTo(c.x, c.y - h).stroke({ width: 0.8, color: 0xd8a33a, alpha: 0.9 });
  }
}

/** Mât de grue (statique) ; la flèche est dessinée à part pour pouvoir pivoter. */
export function craneGeometry(def, b, alt) {
  const p = gridToWorld(b.x + 0.15, b.y + b.h - 0.15, alt);
  const height = Math.max(46, def.visual.height + 24);
  return { base: p, top: { x: p.x, y: p.y - height }, height, reach: 26 + 8 * Math.max(b.w, b.h) };
}

export function drawCraneMast(g, geo) {
  const { base, top } = geo;
  g.rect(base.x - 4, base.y - 3, 8, 4).fill(0x6d6d6d);
  g.rect(base.x - 1.6, top.y, 3.2, base.y - top.y).fill(0xf0b429);
  for (let y = top.y + 4; y < base.y - 2; y += 6) {
    g.moveTo(base.x - 1.6, y).lineTo(base.x + 1.6, y + 5).stroke({ width: 0.6, color: 0x9a6f12 });
  }
  g.rect(base.x - 3, top.y - 3, 6, 5).fill(0x3d4a55);
}

/** Flèche : longueur signée (−1..1 × portée) pour simuler la rotation en perspective. */
export function drawCraneJib(g, geo, swing, hookDepth) {
  const { top, reach } = geo;
  const dx = reach * swing;
  const dy = reach * 0.5 * Math.sin(Math.acos(Math.max(-1, Math.min(1, swing))) ) * 0.35;
  g.moveTo(top.x - dx * 0.3, top.y - dy * 0.3).lineTo(top.x + dx, top.y + dy).stroke({ width: 2.2, color: 0xf0b429 });
  g.rect(top.x - dx * 0.3 - 2.5, top.y - dy * 0.3 - 1.5, 5, 4).fill(0x6d6d6d);
  const hx = top.x + dx * 0.8;
  const hy = top.y + dy * 0.8;
  g.moveTo(hx, hy).lineTo(hx, hy + hookDepth).stroke({ width: 0.6, color: 0x333333 });
  g.rect(hx - 2.5, hy + hookDepth, 5, 3.5).fill(0x8a5a2b);
}

/**
 * Fenêtres éclairées la nuit (calque additif). L'intensité du calque suit la nuit : aucun redessin par image.
 */
export function drawBuildingLights(g, def, b, alt, { burning = false } = {}) {
  const v = def.visual;
  if (b.abandoned || burning || v.roof === 'park' || v.roof === 'panels' || v.roof === 'basins' || v.roof === 'none' || v.roof === 'tank') return;
  const occupied = (b.residents ?? 0) > 0 || (b.jobsFilled ?? 0) > 0 || def.kind === 'plop';
  if (!occupied) return;
  const H = v.height;
  if (H < 8) return;
  const isPlop = def.kind === 'plop';
  const { R, B, L } = footprintCorners(b.x, b.y, b.w, b.h, alt, isPlop ? 0.06 : 0.14);
  const glass = GLASSY.has(v.detail);
  const warm = def.capacity?.residents ? 0xffd27a : 0xfff1c9;
  const share = def.capacity?.residents ? 0.55 : 0.4;
  for (const [a, c, side] of [[L, B, 0], [B, R, 1]]) {
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    const cols = Math.max(1, Math.floor(len / 9));
    const rows = Math.max(1, Math.floor((H - 6) / 9));
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        if (hash2(b.id * 3 + side, r * 31 + k, 4242) > share) continue;
        const p1 = lerp(a, c, (k + 0.25) / cols);
        const p2 = lerp(a, c, (k + 0.75) / cols);
        const h1 = 4 + r * 9;
        const h2 = h1 + 5;
        const color = glass ? 0xd9ecff : warm;
        g.poly(flat(up(p1, h1), up(p2, h1), up(p2, h2), up(p1, h2))).fill({ color, alpha: glass ? 0.75 : 0.95 });
      }
    }
  }
  // Balise rouge des tours (signalisation aérienne)
  if (H >= 60) {
    const top = gridToWorld(b.x + b.w / 2, b.y + b.h / 2, alt);
    g.circle(top.x, top.y - H - 4, 2.2).fill({ color: 0xff4040, alpha: 0.9 });
  }
}

/** Lampadaires : un point lumineux sur une case de route sur deux (motif déterministe). */
export function drawStreetLight(g, x, y, alt, era) {
  if (hash2(x, y, 909) > 0.45) return;
  const p = gridToWorld(x + 0.5, y + 0.5, alt);
  const color = era >= 2 ? 0x8fe8ff : 0xffcf73;
  g.circle(p.x, p.y, 7).fill({ color, alpha: 0.12 });
  g.circle(p.x, p.y, 3.2).fill({ color, alpha: 0.28 });
  g.circle(p.x, p.y - 7, 1.4).fill({ color: 0xffffff, alpha: 0.9 });
}

/**
 * Points d'émission de fumée d'un bâtiment (monde) : cheminées dessinées, sinon le toit.
 * @returns {{x:number, y:number, rate:number, dark:boolean}[]}
 */
export function smokeEmitters(def, b, alt) {
  const v = def.visual;
  const pollution = def.environment?.pollution ?? 0;
  const out = [];
  const isPlop = def.kind === 'plop';
  const { T, R, B, L } = footprintCorners(b.x, b.y, b.w, b.h, alt, isPlop ? 0.06 : 0.14);
  const H = v.height;
  const Tt = up(T, H);
  const Rt = up(R, H);
  const Bt = up(B, H);
  const Lt = up(L, H);
  if (v.detail === 'chimney' || v.detail === 'stacks') {
    const n = v.detail === 'stacks' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const p = lerp(lerp(Tt, Rt, 0.35 + k * 0.3), lerp(Lt, Bt, 0.35 + k * 0.3), 0.4);
      const ch = v.detail === 'stacks' ? 34 : 12;
      out.push({ x: p.x, y: p.y - ch, rate: 0.6 + pollution / 25, dark: false });
    }
  } else if (pollution >= 10 && v.roof !== 'landfill') {
    const c = lerp(Tt, Bt, 0.5);
    out.push({ x: c.x, y: c.y - 4, rate: 0.3 + pollution / 40, dark: false });
  } else if (v.detail === 'cooling') {
    const c = lerp(Tt, Bt, 0.5);
    out.push({ x: c.x, y: c.y - 2, rate: 0.5, dark: false, steam: true });
  }
  return out;
}

/** Point le plus haut du bâtiment (flammes d'un incendie). */
export function roofCenter(def, b, alt) {
  const { T, B } = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.14);
  const c = lerp(T, B, 0.5);
  return { x: c.x, y: c.y - def.visual.height, w: Math.abs(B.x - T.x) + 10 * Math.max(b.w, b.h) };
}
