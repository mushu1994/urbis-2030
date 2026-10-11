import { gridToWorld } from '../IsometricProjection.js';
import { hex, shade, desaturate } from './color.js';
import { hash2 } from '../../util/rng.js';
import { FLAT_SITE_ROOFS, drawFlatSite, drawArcology, drawVerticalGarden, drawReactor, drawFusion, drawFutureDetail, drawHoloSculptures } from './FutureArt.js';

/** Détails dont les façades sont entièrement vitrées. */
const GLASSY = new Set(['glass', 'aiTower', 'hologram', 'solarGlass', 'cleanroom']);

/**
 * Dessin procédural et original des bâtiments en perspective isométrique.
 * Aucune ressource graphique externe : formes, couleurs et détails proviennent du catalogue (visual).
 */

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const up = (p, h) => ({ x: p.x, y: p.y - h });
const flat = (...pts) => pts.flatMap((p) => [p.x, p.y]);

/** Quatre coins au sol de l'emprise (avec retrait) : nord, est, sud, ouest. */
export function footprintCorners(x, y, w, h, alt, inset) {
  return {
    T: gridToWorld(x + inset, y + inset, alt),
    R: gridToWorld(x + w - inset, y + inset, alt),
    B: gridToWorld(x + w - inset, y + h - inset, alt),
    L: gridToWorld(x + inset, y + h - inset, alt)
  };
}

export function drawTree(g, cx, cy, s = 1, tint = 0x3f8f3a) {
  g.rect(cx - 1 * s, cy - 6 * s, 2 * s, 6 * s).fill(0x6b4a2b);
  g.circle(cx, cy - 9 * s, 5.5 * s).fill(shade(tint, 0.8));
  g.circle(cx - 1.5 * s, cy - 11 * s, 4 * s).fill(tint);
  g.circle(cx + 1.2 * s, cy - 12.2 * s, 2.2 * s).fill(shade(tint, 1.25));
}

/** Parallélogramme sur une face verticale : de s1 à s2 le long de l'arête (a→b), de h1 à h2 en hauteur. */
function facePatch(g, a, b, s1, s2, h1, h2, color, alpha = 1) {
  const p1 = lerp(a, b, s1);
  const p2 = lerp(a, b, s2);
  g.poly(flat(up(p1, h1), up(p2, h1), up(p2, h2), up(p1, h2))).fill({ color, alpha });
}

function windows(g, a, b, H, color, { glass = false, lit = 0, seed = 0 } = {}) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const cols = Math.max(1, Math.floor(len / 9));
  const rows = Math.max(1, Math.floor((H - 6) / 9));
  if (glass) {
    for (let c = 0; c < cols; c++) {
      const s1 = (c + 0.15) / cols;
      const s2 = (c + 0.85) / cols;
      facePatch(g, a, b, s1, s2, 3, H - 3, color, 0.55);
    }
    return;
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = lit > 0 && hash2(c + seed, r, 77) < lit;
      facePatch(g, a, b, (c + 0.25) / cols, (c + 0.75) / cols, 4 + r * 9, 9 + r * 9, on ? 0xffe28a : color, on ? 1 : 0.85);
    }
  }
}

/**
 * @param {import('pixi.js').Graphics} g
 * @param {any} def définition du catalogue
 * @param {{x:number,y:number,w:number,h:number,abandoned?:boolean,id:number,residents?:number}} b
 * @param {number} alt altitude du sol
 */
export function drawBuilding(g, def, b, alt) {
  drawBuildingBody(g, def, b, alt);
  if (b.upgrades?.length && !b.abandoned) drawUpgradeBadge(g, b, alt);
}

/** Pastilles d'améliorations installées, au pied de l'angle avant du bâtiment (une par amélioration). */
export function drawUpgradeBadge(g, b, alt) {
  const { B } = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.06);
  const n = Math.min(4, b.upgrades.length);
  for (let k = 0; k < n; k++) {
    const x = B.x - (n - 1) * 3.5 + k * 7;
    const y = B.y - 5;
    g.circle(x, y, 3).fill(0x1d2730);
    g.circle(x, y, 2.2).fill(0xf2c230);
    g.poly([x, y - 1.4, x + 1.3, y + 0.9, x - 1.3, y + 0.9]).fill(0x1d2730);
  }
}

function drawBuildingBody(g, def, b, alt) {
  const v = def.visual;
  const isPlop = def.kind === 'plop';
  const inset = isPlop ? 0.06 : 0.14;
  let base = hex(v.color);
  let roof = hex(v.roofColor ?? v.color);
  if (b.abandoned) {
    base = shade(desaturate(base, 0.85), 0.72);
    roof = shade(desaturate(roof, 0.85), 0.65);
  }
  if (b.burning) {
    // Incendie en cours : façades noircies
    base = shade(desaturate(base, 0.7), 0.45);
    roof = shade(desaturate(roof, 0.7), 0.35);
  }
  const { T, R, B, L } = footprintCorners(b.x, b.y, b.w, b.h, alt, inset);
  const H = v.height;
  const seed = b.id * 13;

  // Sol de la parcelle
  if (!isPlop || v.roof === 'park' || v.roof === 'panels' || v.roof === 'basins' || FLAT_SITE_ROOFS.has(v.roof)) {
    const ground = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.02);
    const gc = v.roof === 'park' ? hex(v.color) : v.roof === 'panels' ? 0x8f9a7a : v.roof === 'basins' ? 0xb9c4b0 : 0x9fbf7f;
    g.poly(flat(ground.T, ground.R, ground.B, ground.L)).fill(b.abandoned ? desaturate(gc, 0.6) : gc);
  }

  switch (v.roof) {
    case 'park':
      drawPark(g, def, b, alt, T, R, B, L);
      if (v.detail === 'holoPark') drawHoloSculptures(g, b, T, R, L, b.abandoned);
      return;
    case 'panels':
      return drawPanels(g, b, alt, T, R, B, L);
    case 'basins':
      return drawBasins(g, b, alt, T, R, B, L);
    case 'none':
      if (v.detail === 'turbine') return drawTurbine(g, T, R, B, L, H, b.abandoned);
      if (v.detail === 'pylon') return drawPylon(g, T, R, B, L, H);
      break;
    case 'tank':
      return drawTank(g, T, R, B, L, H, base, roof);
    default:
      if (FLAT_SITE_ROOFS.has(v.roof)) return drawFlatSite(g, def, b, alt, T, R, B, L);
      break;
  }

  // Volumes particuliers
  if (v.detail === 'arcology') return drawArcology(g, b, alt, T, R, L, base, b.abandoned);
  if (v.detail === 'verticalGarden') return drawVerticalGarden(g, b, T, R, L, H, b.abandoned);
  if (v.detail === 'reactor') return drawReactor(g, b, T, R, L, b.abandoned, b.disabledUntil > 0);
  if (v.detail === 'fusion') return drawFusion(g, b, T, R, L, b.abandoned);

  // Ombre portée légère
  g.poly(flat(B, R, { x: R.x + 6, y: R.y + 3 }, { x: B.x + 6, y: B.y + 3 })).fill({ color: 0x000000, alpha: 0.12 });

  // Volume principal
  const left = shade(base, 0.86);
  const right = shade(base, 0.68);
  g.poly(flat(L, B, up(B, H), up(L, H))).fill(left);
  g.poly(flat(B, R, up(R, H), up(B, H))).fill(right);

  const d = v.detail;
  const winColor = b.abandoned ? 0x3b3b3b : GLASSY.has(d) ? 0xcfe8ff : 0x5a7088;
  const lit = b.abandoned ? 0 : (b.residents ?? 0) > 0 ? 0.15 : 0;
  if (GLASSY.has(d)) {
    windows(g, L, B, H, winColor, { glass: true });
    windows(g, B, R, H, shade(winColor, 0.85), { glass: true });
  } else if (H >= 14 && d !== 'battery' && d !== 'cooling') {
    windows(g, L, B, H, winColor, { lit, seed });
    windows(g, B, R, H, shade(winColor, 0.85), { lit, seed: seed + 5 });
  } else if (H >= 8) {
    facePatch(g, L, B, 0.35, 0.6, 1, Math.min(7, H - 2), shade(base, 0.45));
  }
  if (d === 'awning' && !b.abandoned) {
    facePatch(g, L, B, 0.05, 0.95, 5, 8, hex(v.roofColor), 1);
    facePatch(g, B, R, 0.05, 0.95, 5, 8, shade(hex(v.roofColor), 0.8), 1);
  }
  if (d === 'docks') {
    for (let k = 0; k < 3; k++) facePatch(g, L, B, 0.12 + k * 0.28, 0.32 + k * 0.28, 0, 8, 0x55595e);
  }
  if (d === 'cooling') {
    for (let k = 0; k < 4; k++) facePatch(g, B, R, 0.08 + k * 0.23, 0.26 + k * 0.23, 3, H - 3, 0x9aa7b1);
  }
  if (d === 'battery') {
    for (let k = 0; k < 3; k++) facePatch(g, L, B, 0.1 + k * 0.3, 0.32 + k * 0.3, 2, H - 2, 0xc9d1d6);
  }

  // Toiture
  const Tt = up(T, H);
  const Rt = up(R, H);
  const Bt = up(B, H);
  const Lt = up(L, H);
  if (v.roof === 'gable') {
    const rh = Math.max(6, H * 0.55);
    const A = up(lerp(Tt, Lt, 0.5), rh);
    const C = up(lerp(Rt, Bt, 0.5), rh);
    g.poly(flat(Tt, Rt, C, A)).fill(shade(roof, 1.1));
    g.poly(flat(Rt, Bt, C)).fill(right);
    g.poly(flat(Lt, Bt, C, A)).fill(shade(roof, 0.85));
  } else if (v.roof === 'saw') {
    g.poly(flat(Tt, Rt, Bt, Lt)).fill(shade(roof, 0.9));
    for (let k = 0; k < 3; k++) {
      const a1 = lerp(Tt, Lt, k / 3);
      const a2 = lerp(Tt, Lt, (k + 1) / 3);
      const c1 = lerp(Rt, Bt, k / 3);
      const c2 = lerp(Rt, Bt, (k + 1) / 3);
      g.poly(flat(a1, c1, up(c2, 6), up(a2, 6))).fill(shade(roof, 1.15));
      g.poly(flat(a2, c2, up(c2, 6), up(a2, 6))).fill(0x9fc3d9);
    }
  } else {
    g.poly(flat(Tt, Rt, Bt, Lt)).fill(roof);
    const e = footprintCorners(b.x, b.y, b.w, b.h, alt, inset + 0.05);
    g.poly(flat(up(e.T, H), up(e.R, H), up(e.B, H), up(e.L, H))).fill(shade(roof, 0.92));
    if (v.roof === 'dome') {
      const c = lerp(Tt, Bt, 0.5);
      const rx = Math.abs(Rt.x - Lt.x) * 0.22;
      g.ellipse(c.x, c.y - rx * 0.3, rx, rx * 0.75).fill(roof);
      g.ellipse(c.x - rx * 0.3, c.y - rx * 0.55, rx * 0.35, rx * 0.25).fill({ color: 0xffffff, alpha: 0.35 });
    }
    if (v.roof === 'pad') {
      const c = lerp(Tt, Bt, 0.5);
      g.ellipse(c.x, c.y, 10, 5).fill(roof);
      g.ellipse(c.x, c.y, 6, 3).fill(0x333333);
    }
  }

  // Détails de toiture
  const center = lerp(Tt, Bt, 0.5);
  if (d === 'chimney' || d === 'stacks') {
    const n = d === 'stacks' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const p = lerp(lerp(Tt, Rt, 0.35 + k * 0.3), lerp(Lt, Bt, 0.35 + k * 0.3), 0.4);
      const ch = d === 'stacks' ? 34 : 12;
      const cw = d === 'stacks' ? 4 : 3;
      g.rect(p.x - cw, p.y - ch, cw * 2, ch).fill(b.abandoned ? 0x6b6b6b : 0x8c8c8c);
      if (d === 'stacks') g.rect(p.x - cw, p.y - ch, cw * 2, 5).fill(0xc84b3c);
      // Fumée : particules animées (EffectsRenderer)
    }
  }
  if (d === 'solar') {
    const a = lerp(Tt, Lt, 0.25);
    const c = lerp(Rt, Bt, 0.25);
    g.poly(flat(lerp(a, c, 0.15), lerp(a, c, 0.85), lerp(lerp(Tt, Lt, 0.75), lerp(Rt, Bt, 0.75), 0.85), lerp(lerp(Tt, Lt, 0.75), lerp(Rt, Bt, 0.75), 0.15))).fill(0x2f4f8a);
  }
  if (d === 'garden' || d === 'pool') {
    const p = gridToWorld(b.x + 0.85, b.y + 0.85, alt);
    if (d === 'garden') drawTree(g, p.x + 2, p.y - 2, 0.7);
    else g.poly(flat({ x: p.x, y: p.y - 6 }, { x: p.x + 8, y: p.y - 2 }, { x: p.x, y: p.y + 2 }, { x: p.x - 8, y: p.y - 2 })).fill(0x5cc4e8);
  }
  if (d === 'cross') {
    g.rect(center.x - 5, center.y - 1.5, 10, 3).fill(0xd64a4a);
    g.rect(center.x - 1.5, center.y - 5, 3, 10).fill(0xd64a4a);
  }
  if (d === 'helipad') {
    g.ellipse(center.x, center.y, 12, 6).fill(0x3d4a55);
    g.rect(center.x - 3, center.y - 2, 6, 1.5).fill(0xffffff);
  }
  if (d === 'beacon' || d === 'tower') {
    const p = lerp(Tt, Rt, 0.5);
    g.rect(p.x - 2, p.y - 10, 4, 10).fill(d === 'tower' ? 0xb8392f : 0x2f4f8a);
    g.circle(p.x, p.y - 12, 2.5).fill(d === 'tower' ? 0xffd166 : 0x6ec6ff);
  }
  if (d === 'flag') {
    g.rect(center.x - 0.7, center.y - 34, 1.4, 22).fill(0x555555);
    g.poly([center.x + 0.7, center.y - 34, center.x + 11, center.y - 31, center.x + 0.7, center.y - 28]).fill(0x3a6fb7);
  }
  if (d === 'antenna' || d === 'glass') {
    if (H > 60) g.rect(center.x - 0.8, center.y - 14, 1.6, 14).fill(0x777777);
  }
  if (d === 'robotarm' || d === 'robots') {
    g.rect(center.x - 2, center.y - 9, 4, 9).fill(0xf0a030);
    g.rect(center.x - 2, center.y - 11, 10, 3).fill(0xf0a030);
  }
  if (d === 'boxes') {
    for (let k = 0; k < 3; k++) g.rect(center.x - 8 + k * 6, center.y - 5 - (k % 2) * 3, 5, 5).fill(k % 2 ? 0xc98a3a : 0xe0a656);
  }
  if (d === 'dronepad' && !b.abandoned) {
    g.circle(center.x + 6, center.y - 12, 2).fill(0x333333);
    g.circle(center.x - 7, center.y - 18, 2).fill(0x333333);
  }
  if (d === 'pipe') {
    g.rect(R.x - 4, R.y - 4, 10, 3).fill(0x4f8fc0);
  }
  drawFutureDetail(g, d, { T, R, B, L, Tt, Rt, Bt, Lt, H, base, roof, abandoned: !!b.abandoned, id: b.id });
}

function drawPark(g, def, b, alt, T, R, B, L) {
  const d = def.visual.detail;
  const n = Math.max(2, Math.round(b.w * b.h * (d === 'forest' ? 4 : 2.2)));
  if (d === 'pond') {
    const c = lerp(T, B, 0.5);
    g.ellipse(c.x - 6, c.y + 2, 16, 7).fill(0x5cb7e0);
  }
  // Allée
  if (d !== 'forest') g.poly(flat(lerp(T, L, 0.45), lerp(T, L, 0.55), lerp(R, B, 0.55), lerp(R, B, 0.45))).fill(0xe3d3a8);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const u = 0.12 + hash2(b.id, k, 3) * 0.76;
    const w = 0.12 + hash2(b.id, k, 9) * 0.76;
    pts.push(lerp(lerp(T, R, u), lerp(L, B, u), w));
  }
  pts.sort((a, z) => a.y - z.y);
  for (const p of pts) drawTree(g, p.x, p.y, d === 'forest' ? 1.05 : 0.85, d === 'forest' ? 0x2e7a33 : 0x4c9b44);
}

function drawPanels(g, b, alt, T, R, B, L) {
  const rows = 3 * b.h;
  for (let r = 0; r < rows; r++) {
    const a1 = lerp(T, L, (r + 0.15) / rows);
    const a2 = lerp(T, L, (r + 0.75) / rows);
    const c1 = lerp(R, B, (r + 0.15) / rows);
    const c2 = lerp(R, B, (r + 0.75) / rows);
    g.poly(flat(lerp(a1, c1, 0.06), lerp(a1, c1, 0.94), up(lerp(a2, c2, 0.94), 3), up(lerp(a2, c2, 0.06), 3))).fill(0x2c4a80);
    g.poly(flat(lerp(a1, c1, 0.06), lerp(a1, c1, 0.94), up(lerp(a2, c2, 0.94), 3), up(lerp(a2, c2, 0.06), 3))).stroke({ width: 0.6, color: 0x7fa6e0, alpha: 0.6 });
  }
}

function drawBasins(g, b, alt, T, R, B, L) {
  for (const [u, w] of [[0.3, 0.3], [0.7, 0.35], [0.45, 0.72]]) {
    const c = lerp(lerp(T, R, u), lerp(L, B, u), w);
    g.ellipse(c.x, c.y, 13, 6.5).fill(0xa9b3a6);
    g.ellipse(c.x, c.y, 10.5, 5).fill(0x6d9db3);
  }
}

function drawTank(g, T, R, B, L, H, base, roof) {
  const c = lerp(T, B, 0.5);
  g.rect(c.x - 2, c.y - H + 8, 4, H - 8).fill(0x8a8f96);
  g.ellipse(c.x, c.y - H + 10, 9, 4).fill(shade(base, 0.8));
  g.rect(c.x - 9, c.y - H, 18, 10).fill(base);
  g.ellipse(c.x, c.y - H, 9, 4).fill(roof);
}

function drawTurbine(g, T, R, B, L, H, abandoned) {
  const c = lerp(T, B, 0.5);
  g.ellipse(c.x, c.y, 6, 3).fill(0xb7bcc2);
  g.poly([c.x - 1.6, c.y, c.x + 1.6, c.y, c.x + 0.8, c.y - H, c.x - 0.8, c.y - H]).fill(0xf2f4f6);
  const hub = { x: c.x, y: c.y - H };
  const blade = 18;
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 - Math.PI / 2 + 0.3;
    const tip = { x: hub.x + Math.cos(a) * blade, y: hub.y + Math.sin(a) * blade * 0.9 };
    const nx = -Math.sin(a) * 1.6;
    const ny = Math.cos(a) * 1.6;
    g.poly([hub.x + nx, hub.y + ny, tip.x, tip.y, hub.x - nx, hub.y - ny]).fill(abandoned ? 0x9a9a9a : 0xffffff);
  }
  g.circle(hub.x, hub.y, 2.4).fill(0xd8dde2);
}

function drawPylon(g, T, R, B, L, H) {
  const c = lerp(T, B, 0.5);
  const s = 0.9;
  g.moveTo(c.x - 6 * s, c.y).lineTo(c.x - 1, c.y - H).lineTo(c.x + 1, c.y - H).lineTo(c.x + 6 * s, c.y).stroke({ width: 1.4, color: 0x6b6f75 });
  g.moveTo(c.x - 9, c.y - H + 4).lineTo(c.x + 9, c.y - H + 4).stroke({ width: 1.4, color: 0x6b6f75 });
  g.moveTo(c.x - 4, c.y - H * 0.5).lineTo(c.x + 4, c.y - H * 0.5).stroke({ width: 1.1, color: 0x6b6f75 });
}

