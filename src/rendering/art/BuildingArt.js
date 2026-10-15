import { gridToWorld, screenCorners, VIEW } from '../IsometricProjection.js';
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

/**
 * Quatre coins au sol de l'emprise (avec retrait), rangés par position à l'écran : haut, droite, bas, gauche.
 * Quelle que soit l'orientation de la carte (v0.9), les deux faces visibles sont L→B et B→R.
 */
export function footprintCorners(x, y, w, h, alt, inset) {
  return screenCorners(x + inset, y + inset, w - 2 * inset, h - 2 * inset, alt);
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
  if (VIEW.top) return drawPlanBuilding(g, def, b, {});
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
    case 'farm':
      return drawFarm(g, b, alt, v, base, roof);
    case 'greenhouse':
      return drawGreenhouse(g, b, alt, T, R, B, L, H, base, roof);
    case 'derrick':
      return drawDerrick(g, b, alt, v, base, roof);
    case 'quarry':
      return drawQuarry(g, b, alt, base, roof);
    case 'sawmill':
      return drawSawmill(g, b, alt, v, base, roof);
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


// ───────────────────── Industries spécialisées (v0.4) ─────────────────────

/** Petit volume parallélépipédique (grange, local technique…). */
function box(g, x, y, w, h, alt, H, base, roof, gable = false) {
  const c = footprintCorners(x, y, w, h, alt, 0);
  g.poly(flat(c.L, c.B, up(c.B, H), up(c.L, H))).fill(shade(base, 0.86));
  g.poly(flat(c.B, c.R, up(c.R, H), up(c.B, H))).fill(shade(base, 0.68));
  const Tt = up(c.T, H);
  const Rt = up(c.R, H);
  const Bt = up(c.B, H);
  const Lt = up(c.L, H);
  if (!gable) {
    g.poly(flat(Tt, Rt, Bt, Lt)).fill(roof);
    return;
  }
  const rh = Math.max(4, H * 0.6);
  const A = up(lerp(Tt, Lt, 0.5), rh);
  const C = up(lerp(Rt, Bt, 0.5), rh);
  g.poly(flat(Tt, Rt, C, A)).fill(shade(roof, 1.1));
  g.poly(flat(Rt, Bt, C)).fill(shade(base, 0.68));
  g.poly(flat(Lt, Bt, C, A)).fill(shade(roof, 0.85));
}

/** Ferme : sillons cultivés, grange rouge et (niveau 2) silo. */
function drawFarm(g, b, alt, v, base, roof) {
  const ab = !!b.abandoned;
  if (v.detail === 'pasture') return drawPasture(g, b, alt, v, base, roof, ab);
  const soil = ab ? 0x8a7d6a : 0x8b6b42;
  const crop = ab ? 0x9a9a7a : [0x7fb24a, 0xc9b94a, 0x5f9d3f][b.id % 3];
  const field = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.04);
  g.poly(flat(field.T, field.R, field.B, field.L)).fill(soil);
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const a1 = lerp(field.T, field.L, (r + 0.2) / rows);
    const a2 = lerp(field.T, field.L, (r + 0.7) / rows);
    const c1 = lerp(field.R, field.B, (r + 0.2) / rows);
    const c2 = lerp(field.R, field.B, (r + 0.7) / rows);
    // Les rangs s'arrêtent avant la cour de ferme (coin arrière)
    g.poly(flat(lerp(a1, c1, 0.42), lerp(a1, c1, 0.97), lerp(a2, c2, 0.97), lerp(a2, c2, 0.42))).fill(crop);
  }
  box(g, b.x + 0.1, b.y + 0.1, 0.36, 0.42, alt, v.height, base, roof, true);
  if (v.detail === 'silo') {
    const p = gridToWorld(b.x + 0.32, b.y + 0.72, alt);
    g.rect(p.x - 3.5, p.y - 20, 7, 20).fill(ab ? 0x8f8f8f : 0xc9ccd1);
    g.rect(p.x, p.y - 20, 3.5, 20).fill(ab ? 0x777777 : 0xa9adb3);
    g.ellipse(p.x, p.y - 20, 3.5, 1.8).fill(ab ? 0x6b6b6b : 0x8d949c);
  }
}

/** Ferme d'élevage (v0.7) : prairie clôturée, troupeau, étable et abreuvoir. */
function drawPasture(g, b, alt, v, base, roof, ab) {
  const field = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.04);
  g.poly(flat(field.T, field.R, field.B, field.L)).fill(ab ? 0x8f9a7a : 0x7fae4e);
  // Clôture
  const fence = ab ? 0x8a8378 : 0xe9e1cf;
  for (const [a, c] of [[field.L, field.B], [field.B, field.R]]) {
    g.moveTo(a.x, a.y - 2).lineTo(c.x, c.y - 2).stroke({ width: 0.8, color: fence });
    for (let k = 0; k <= 6; k++) {
      const q = lerp(a, c, k / 6);
      g.moveTo(q.x, q.y).lineTo(q.x, q.y - 3).stroke({ width: 0.8, color: fence });
    }
  }
  // Étable au fond de la parcelle
  box(g, b.x + 0.08, b.y + 0.08, 0.4, 0.34, alt, v.height, base, roof, true);
  // Troupeau (vaches pie) — positions stables par bâtiment
  if (!ab) {
    for (let k = 0; k < 5; k++) {
      const u = 0.45 + 0.5 * ((b.id * 37 + k * 53) % 100) / 100;
      const w = 0.15 + 0.75 * ((b.id * 61 + k * 29) % 100) / 100;
      const p = gridToWorld(b.x + u, b.y + w, alt);
      g.ellipse(p.x, p.y - 1.6, 2.4, 1.3).fill(k % 2 ? 0xf4f1ea : 0x3b3530);
      g.circle(p.x + 2.2, p.y - 2.2, 0.9).fill(k % 2 ? 0x3b3530 : 0xf4f1ea);
    }
  }
  // Abreuvoir
  const t = gridToWorld(b.x + 0.8, b.y + 0.3, alt);
  g.rect(t.x - 3, t.y - 1.5, 6, 1.5).fill(ab ? 0x777777 : 0x6aa7c9);
}

/** Ferme verticale : serres vitrées étagées. */
function drawGreenhouse(g, b, alt, T, R, B, L, H, base, roof) {
  const ab = !!b.abandoned;
  g.poly(flat(B, R, { x: R.x + 6, y: R.y + 3 }, { x: B.x + 6, y: B.y + 3 })).fill({ color: 0x000000, alpha: 0.12 });
  const glass = ab ? 0x9aa3a6 : 0xbfe6ea;
  const plants = ab ? 0x7a7f74 : roof;
  const floors = 3;
  for (let f = 0; f < floors; f++) {
    const h0 = (H / floors) * f;
    const h1 = (H / floors) * (f + 1) - 1;
    g.poly(flat(up(L, h0), up(B, h0), up(B, h1), up(L, h1))).fill(shade(glass, 0.9));
    g.poly(flat(up(B, h0), up(R, h0), up(R, h1), up(B, h1))).fill(shade(glass, 0.75));
    facePatch(g, L, B, 0.08, 0.92, h0 + 1, h0 + 4, plants, 0.9);
    facePatch(g, B, R, 0.08, 0.92, h0 + 1, h0 + 4, shade(plants, 0.85), 0.9);
    g.poly(flat(up(L, h1), up(B, h1), up(B, h1 + 1), up(L, h1 + 1))).fill(base);
    g.poly(flat(up(B, h1), up(R, h1), up(R, h1 + 1), up(B, h1 + 1))).fill(shade(base, 0.8));
  }
  const Tt = up(T, H);
  const Rt = up(R, H);
  const Bt = up(B, H);
  const Lt = up(L, H);
  g.poly(flat(Tt, Rt, Bt, Lt)).fill(shade(glass, 1.05));
  for (let k = 1; k < 4; k++) g.moveTo(lerp(Tt, Lt, k / 4).x, lerp(Tt, Lt, k / 4).y).lineTo(lerp(Rt, Bt, k / 4).x, lerp(Rt, Bt, k / 4).y).stroke({ width: 0.8, color: base, alpha: 0.9 });
}

/** Puits de forage : terre battue, cuve et chevalet de pompage (ou derrick automatisé). */
function drawDerrick(g, b, alt, v, base, roof) {
  const ab = !!b.abandoned;
  const pad = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.06);
  g.poly(flat(pad.T, pad.R, pad.B, pad.L)).fill(ab ? 0x8c867c : 0x9c8a6e);
  const tank = gridToWorld(b.x + 0.75, b.y + 0.3, alt);
  g.rect(tank.x - 5, tank.y - 8, 10, 8).fill(ab ? 0x8a8a8a : 0xd8d2c4);
  g.rect(tank.x, tank.y - 8, 5, 8).fill(ab ? 0x777777 : 0xb9b2a3);
  g.ellipse(tank.x, tank.y - 8, 5, 2.4).fill(ab ? 0x6c6c6c : 0xeee8da);
  const c = gridToWorld(b.x + 0.45, b.y + 0.6, alt);
  const steel = ab ? 0x6b6b6b : base;
  const accent = ab ? 0x8f8f8f : hex(v.roofColor);
  if (v.detail === 'gaswell') {
    // Puits de gaz (v0.7) : tête de puits, sphère de stockage et torchère
    const sph = gridToWorld(b.x + 0.3, b.y + 0.35, alt);
    g.circle(sph.x, sph.y - 7, 6).fill(ab ? 0x8a8a8a : 0xe6e8ea);
    g.circle(sph.x + 1.8, sph.y - 6, 4).fill({ color: 0x000000, alpha: 0.08 });
    g.rect(sph.x - 4, sph.y - 2, 1.2, 2).fill(steel);
    g.rect(sph.x + 3, sph.y - 2, 1.2, 2).fill(steel);
    g.rect(c.x - 2, c.y - 6, 4, 6).fill(steel);
    g.rect(c.x - 4, c.y - 7, 8, 1.6).fill(accent);
    const f = gridToWorld(b.x + 0.8, b.y + 0.75, alt);
    g.rect(f.x - 0.8, f.y - v.height, 1.6, v.height).fill(steel);
    if (!ab) {
      g.ellipse(f.x, f.y - v.height - 3, 2.2, 3.4).fill(0xf08a24);
      g.ellipse(f.x, f.y - v.height - 2.4, 1.1, 1.8).fill(0xffe08a);
    }
    return;
  }
  if (v.detail === 'rig') {
    // Tour de forage automatisée : treillis et balise
    const H = v.height;
    g.moveTo(c.x - 7, c.y).lineTo(c.x - 1.2, c.y - H).lineTo(c.x + 1.2, c.y - H).lineTo(c.x + 7, c.y).stroke({ width: 1.6, color: steel });
    for (let k = 1; k < 4; k++) {
      const yk = c.y - (H * k) / 4;
      const half = 7 - (5.8 * k) / 4;
      g.moveTo(c.x - half, yk).lineTo(c.x + half, yk).stroke({ width: 1, color: steel });
    }
    g.rect(c.x - 6, c.y - 5, 12, 5).fill(shade(base, 1.2));
    if (!ab) g.circle(c.x, c.y - H - 2, 2.2).fill(accent);
    return;
  }
  // Chevalet de pompage
  g.poly([c.x - 6, c.y, c.x - 1.5, c.y - 11, c.x + 1.5, c.y - 11, c.x + 6, c.y]).fill(steel);
  g.poly([c.x - 11, c.y - 9, c.x + 10, c.y - 14, c.x + 10, c.y - 11.5, c.x - 11, c.y - 6.5]).fill(accent);
  g.poly([c.x + 9, c.y - 15, c.x + 14, c.y - 12, c.x + 13, c.y - 7, c.x + 9, c.y - 10]).fill(steel);
  g.rect(c.x - 11.5, c.y - 8, 1.6, 8).fill(steel);
}

/** Carrière : fosse en gradins, concasseur et convoyeur. */
function drawQuarry(g, b, alt, base, roof) {
  const ab = !!b.abandoned;
  const rim = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.04);
  g.poly(flat(rim.T, rim.R, rim.B, rim.L)).fill(ab ? 0x8f8a82 : 0xb9a888);
  for (let k = 1; k <= 3; k++) {
    const e = footprintCorners(b.x + 0.05, b.y + 0.05, 0.62, 0.62, alt, 0.06 * k);
    const d = k * 2.2;
    const col = shade(ab ? 0x8a857c : 0xa08f73, 1 - k * 0.1);
    g.poly(flat({ x: e.T.x, y: e.T.y + d }, { x: e.R.x, y: e.R.y + d }, { x: e.B.x, y: e.B.y + d }, { x: e.L.x, y: e.L.y + d })).fill(col);
  }
  box(g, b.x + 0.62, b.y + 0.55, 0.3, 0.32, alt, 14, base, roof);
  const a = gridToWorld(b.x + 0.4, b.y + 0.42, alt);
  const z = gridToWorld(b.x + 0.7, b.y + 0.62, alt);
  g.moveTo(a.x, a.y - 2).lineTo(z.x, z.y - 13).stroke({ width: 2.2, color: ab ? 0x777777 : 0x4a4a4a });
  if (!ab) g.circle(z.x, z.y - 14, 1.6).fill(roof);
}

/** Scierie : cour en terre battue, hangar et piles de grumes (plus hautes au niveau 2). */
function drawSawmill(g, b, alt, v, base, roof) {
  const ab = !!b.abandoned;
  const yard = footprintCorners(b.x, b.y, b.w, b.h, alt, 0.04);
  g.poly(flat(yard.T, yard.R, yard.B, yard.L)).fill(ab ? 0x8c867c : 0xa68b63);
  box(g, b.x + 0.08, b.y + 0.08, 0.5, 0.42, alt, v.height, ab ? desaturate(base, 0.8) : base, ab ? 0x6b6b6b : roof, true);
  const stacks = v.detail === 'logs2' ? 3 : 2;
  for (let k = 0; k < stacks; k++) {
    const p = gridToWorld(b.x + 0.62 + (k % 2) * 0.18, b.y + 0.5 + Math.floor(k / 2) * 0.3 + (k % 2) * 0.12, alt);
    for (let r = 0; r < 3; r++) {
      const yy = p.y - 2 - r * 3;
      const n = 3 - r;
      for (let c = 0; c < n; c++) {
        const xx = p.x - (n - 1) * 2.2 + c * 4.4;
        g.rect(xx - 1.6, yy - 1.6, 9, 3.2).fill(ab ? 0x7a7166 : 0x8a5a33);
        g.circle(xx - 1.6, yy, 1.7).fill(ab ? 0x9a9186 : 0xd9b27a);
      }
    }
  }
}

/** Teintes de toit en vue de dessus pour les toits « techniques ». */
const PLAN_GROUND = { park: null, panels: 0x2f4f8a, basins: 0x5aa0c8, field: 0xc9b46a, farm: 0xb7a35a, landfill: 0x8a7f6a, runway: 0x6d737a, quarry: 0xa59c88 };

/**
 * Vue de dessus (v0.9) : plan du bâtiment — ombre portée proportionnelle à la hauteur, toit à la couleur du
 * catalogue, arête de toit, contour. Chantiers en pointillés, ruines grisées.
 * @param {{construction?:number, ruins?:boolean}} state
 */
export function drawPlanBuilding(g, def, b, { construction = -1, ruins = false } = {}) {
  const v = def.visual;
  const isPlop = def.kind === 'plop';
  const inset = isPlop ? 0.05 : 0.12;
  const c = screenCorners(b.x + inset, b.y + inset, b.w - 2 * inset, b.h - 2 * inset, 0);
  const x0 = c.T.x;
  const y0 = c.T.y;
  const w = c.R.x - c.T.x;
  const h = c.B.y - c.T.y;
  let roof = hex(v.roofColor ?? v.color);
  let base = hex(v.color);
  if (b.abandoned) {
    roof = shade(desaturate(roof, 0.85), 0.65);
    base = shade(desaturate(base, 0.85), 0.72);
  }
  if (ruins) {
    g.rect(x0, y0, w, h).fill(0x6e6a64);
    for (let k = 0; k < 6; k++) {
      const px = x0 + hash2(b.id, k, 3) * w;
      const py = y0 + hash2(k, b.id, 5) * h;
      g.circle(px, py, 2 + hash2(b.id + k, 7, 9) * 3).fill(0x8c867d);
    }
    g.rect(x0, y0, w, h).stroke({ width: 1, color: 0xe0553a, alpha: 0.8 });
    return;
  }
  if (construction >= 0) {
    g.rect(x0, y0, w, h).fill({ color: 0xc9b48a, alpha: 0.9 });
    const fw = w * Math.max(0.15, construction);
    g.rect(x0, y0, fw, h).fill({ color: base, alpha: 0.75 });
    for (let k = 0; k <= 4; k++) g.moveTo(x0 + (w * k) / 4, y0).lineTo(x0 + (w * k) / 4, y0 + h).stroke({ width: 0.6, color: 0x7a6440, alpha: 0.6 });
    g.rect(x0, y0, w, h).stroke({ width: 1, color: 0xf0a33a });
    return;
  }
  const flatSite = v.roof === 'park' || FLAT_SITE_ROOFS.has(v.roof) || PLAN_GROUND[v.roof] !== undefined || (v.height ?? 0) <= 2;
  if (v.roof === 'park') {
    g.rect(x0, y0, w, h).fill(b.abandoned ? desaturate(base, 0.6) : base);
    const n = Math.max(2, Math.round(b.w * b.h * 2));
    for (let k = 0; k < n; k++) {
      const px = x0 + (0.15 + hash2(b.id, k, 11) * 0.7) * w;
      const py = y0 + (0.15 + hash2(k, b.id, 13) * 0.7) * h;
      g.circle(px, py, 3.2).fill(0x3f8f3a);
    }
    return;
  }
  if (flatSite) {
    g.rect(x0, y0, w, h).fill(PLAN_GROUND[v.roof] ?? roof);
    g.rect(x0, y0, w, h).stroke({ width: 0.8, color: shade(roof, 0.6), alpha: 0.8 });
    return;
  }
  // Ombre portée vers le bas et la droite, proportionnelle à la hauteur du bâtiment
  const sh = Math.min(16, (v.height ?? 10) / 5);
  g.rect(x0 + sh, y0 + sh, w, h).fill({ color: 0x1d2730, alpha: 0.28 });
  g.rect(x0, y0, w, h).fill(roof);
  // Arête de toit (toits à deux pans) ou édicule (toits plats)
  if (v.roof === 'gable' || v.roof === 'hip') {
    if (w >= h) g.moveTo(x0 + 2, y0 + h / 2).lineTo(x0 + w - 2, y0 + h / 2).stroke({ width: 1.2, color: shade(roof, 0.7) });
    else g.moveTo(x0 + w / 2, y0 + 2).lineTo(x0 + w / 2, y0 + h - 2).stroke({ width: 1.2, color: shade(roof, 0.7) });
    g.rect(x0 + w / 2, y0, w / 2, h).fill({ color: 0x000000, alpha: 0.08 });
  } else {
    g.rect(x0 + w * 0.3, y0 + h * 0.3, w * 0.25, h * 0.25).fill(shade(roof, 0.82));
  }
  g.rect(x0, y0, w, h).stroke({ width: 1, color: shade(roof, 0.55) });
  if (b.upgrades?.length && !b.abandoned) g.circle(x0 + w - 4, y0 + h - 4, 3).fill(0xf2c230);
}
