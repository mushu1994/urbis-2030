import { gridToWorld, HEIGHT_STEP } from '../IsometricProjection.js';
import { hash2 } from '../../util/rng.js';
import { hex, shade, mix } from './color.js';
import { TERRAIN } from '../../world/Terrain.js';

/** Dessin du sol : terrain en terrasses, routes, parcelles zonées, zones de desserte. */

const TERRAIN_COLORS = {
  [TERRAIN.GRASS]: 0x86b85a,
  [TERRAIN.WATER]: 0x3f8fc7,
  [TERRAIN.FOREST]: 0x5f9a45,
  [TERRAIN.SAND]: 0xdcc98f,
  [TERRAIN.ROCK]: 0x8e9182
};
const CLIFF = 0x9b7b55;
const SEASON_TONE = { autumn: [0xb59a4a, 0.28], winter: [0x8f9a7c, 0.3], spring: [0x8fd06a, 0.12] };

/** Teinte du feuillage selon la saison et la neige. */
export function foliageTint(season, snow = 0) {
  let c = { autumn: 0xc07a32, winter: 0x56704a, spring: 0x4fa83f }[season] ?? 0x3a7f37;
  if (snow > 0) c = mix(c, 0xeef3f8, 0.55 * snow);
  return c;
}

const corners = (x, y, alt) => [gridToWorld(x, y, alt), gridToWorld(x + 1, y, alt), gridToWorld(x + 1, y + 1, alt), gridToWorld(x, y + 1, alt)];

/**
 * Dessine une case de terrain avec ses falaises visibles (faces sud-ouest et sud-est).
 * @param {import('pixi.js').Graphics} g
 * @param {import('../../world/Grid.js').Grid} grid
 */
export function drawTerrainTile(g, grid, x, y, { gridLines = false, snow = 0, season = 'summer' } = {}) {
  const i = grid.idx(x, y);
  const alt = grid.altitude[i];
  const terr = grid.terrain[i];
  const [T, R, B, L] = corners(x, y, alt);
  // Falaises vers les voisins plus bas (ou le bord de la carte)
  const altS = y + 1 < grid.height ? grid.altitude[i + grid.width] : 0;
  const altE = x + 1 < grid.width ? grid.altitude[i + 1] : 0;
  const edgeS = y + 1 >= grid.height;
  const edgeE = x + 1 >= grid.width;
  if (alt > altS || edgeS) {
    const dh = (alt - (edgeS ? -1 : altS)) * HEIGHT_STEP;
    g.poly([L.x, L.y, B.x, B.y, B.x, B.y + dh, L.x, L.y + dh]).fill(shade(CLIFF, 0.9));
  }
  if (alt > altE || edgeE) {
    const dh = (alt - (edgeE ? -1 : altE)) * HEIGHT_STEP;
    g.poly([B.x, B.y, R.x, R.y, R.x, R.y + dh, B.x, B.y + dh]).fill(shade(CLIFF, 0.72));
  }
  let c = TERRAIN_COLORS[terr];
  const n = hash2(x, y, 11);
  if (terr === TERRAIN.WATER) {
    c = mix(c, 0x6fb8e6, n * 0.25);
  } else {
    c = shade(c, 0.93 + n * 0.12 + alt * 0.025);
    // Saisons : herbe jaunie en été sec, roussie en automne, terne en hiver ; manteau neigeux
    if (terr === TERRAIN.GRASS || terr === TERRAIN.FOREST) {
      const tone = SEASON_TONE[season];
      if (tone) c = mix(c, tone[0], tone[1]);
    }
    if (snow > 0 && terr !== TERRAIN.SAND) c = mix(c, 0xf3f6fa, snow * (0.75 + n * 0.2));
  }
  g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).fill(c);
  if (terr === TERRAIN.WATER && n > 0.82) {
    const cx = (T.x + B.x) / 2;
    const cy = (T.y + B.y) / 2;
    g.moveTo(cx - 8, cy).lineTo(cx + 2, cy - 1).stroke({ width: 1, color: 0xd6efff, alpha: 0.6 });
  }
  if (gridLines && terr !== TERRAIN.WATER) {
    g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).stroke({ width: 0.5, color: 0x000000, alpha: 0.12 });
  }
}

/** Points d'arbres d'une case de forêt (déterministes). */
export function forestTrees(x, y, alt) {
  const out = [];
  const count = 2 + Math.floor(hash2(x, y, 21) * 3);
  for (let k = 0; k < count; k++) {
    const u = 0.18 + hash2(x * 7 + k, y, 31) * 0.64;
    const v = 0.18 + hash2(x, y * 7 + k, 41) * 0.64;
    const p = gridToWorld(x + u, y + v, alt);
    out.push({ x: p.x, y: p.y, s: 0.75 + hash2(x + k, y + k, 51) * 0.45 });
  }
  return out.sort((a, b) => a.y - b.y);
}

/**
 * Dessine une case de route. `conn` = masque des connexions [N, E, S, O] (bits 1, 2, 4, 8).
 * @param {{color:string, edge:string, marking:string, median?:string, width:number}} visual
 */
export function drawRoadTile(g, x, y, alt, conn, visual, { congestion = -1, era = 1, rise = null } = {}) {
  const [T, R, B, L] = corners(x, y, alt);
  const asphalt = hex(visual.color);
  const edge = hex(visual.edge);
  g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).fill(edge);
  // Chaussée : losange réduit + bras vers les voisins connectés
  const k = (1 - visual.width) / 2;
  const lo = k;
  const hi = 1 - k;
  // Rampes (v0.4) : un bras qui rejoint une route plus haute monte en pente jusqu'au bord de la case,
  // pour que la chaussée reste continue d'une terrasse à l'autre. rise = [N, E, S, O] (écart d'altitude du voisin).
  const up = [0, 0, 0, 0];
  if (rise) for (let d = 0; d < 4; d++) if (conn & (1 << d)) up[d] = Math.max(0, rise[d]);
  const sloped = up[0] || up[1] || up[2] || up[3];
  // Voie droite (ou impasse) qui monte d'un seul côté : la rampe occupe toute la case, en pente douce.
  // Ailleurs (carrefours), seul le bras concerné est incliné, le centre reste à plat.
  const ups = up.filter((u) => u > 0).length;
  const fullDir = ups === 1 && (conn === 5 || conn === 10 || [1, 2, 4, 8].includes(conn)) ? up.findIndex((u) => u > 0) : -1;
  const T_FULL = [(u, v) => 1 - v, (u) => u, (u, v) => v, (u) => 1 - u];
  const altAt = !sloped
    ? () => alt
    : fullDir >= 0
      ? (u, v) => alt + up[fullDir] * T_FULL[fullDir](u, v)
      : (u, v) => alt + Math.max(
        up[0] * Math.max(0, (lo - v) / lo),
        up[1] * Math.max(0, (u - hi) / (1 - hi)),
        up[2] * Math.max(0, (v - hi) / (1 - hi)),
        up[3] * Math.max(0, (lo - u) / lo)
      );
  const P = (u, v) => gridToWorld(x + u, y + v, altAt(u, v));
  const road = congestion >= 0 ? congestionColor(congestion) : asphalt;
  if (fullDir >= 0) {
    const G = (u, v) => gridToWorld(x + u, y + v, alt);
    const wall = shade(CLIFF, 0.8);
    // Talus visible : face est pour une rampe nord-sud, face sud pour une rampe est-ouest
    const side = fullDir === 0 || fullDir === 2 ? [[1, 0], [1, 1]] : [[0, 1], [1, 1]];
    const [a, b] = side;
    g.poly([...xy(P(...a)), ...xy(P(...b)), ...xy(G(...b)), ...xy(G(...a))]).fill(wall);
    g.poly([...xy(P(0, 0)), ...xy(P(1, 0)), ...xy(P(1, 1)), ...xy(P(0, 1))]).fill(edge);
  } else if (sloped) {
    const G = (u, v) => gridToWorld(x + u, y + v, alt);
    const wall = shade(CLIFF, 0.8);
    // Talus visibles (faces est et sud) puis dalle de la rampe, sur toute la largeur de la case
    const ramp = [
      [0, [0, lo], [1, lo], [1, 0], [0, 0], [1, lo], [1, 0]],
      [1, [hi, 0], [hi, 1], [1, 1], [1, 0], [hi, 1], [1, 1]],
      [2, [0, hi], [1, hi], [1, 1], [0, 1], [1, hi], [1, 1]],
      [3, [lo, 0], [lo, 1], [0, 1], [0, 0], [lo, 1], [0, 1]]
    ];
    for (const [d, a, b, c, e, w0, w1] of ramp) {
      if (!up[d]) continue;
      g.poly([...xy(P(...w0)), ...xy(P(...w1)), ...xy(G(...w1))]).fill(wall);
      g.poly([...xy(P(...a)), ...xy(P(...b)), ...xy(P(...c)), ...xy(P(...e))]).fill(edge);
    }
  }
  g.poly([...xy(P(lo, lo)), ...xy(P(hi, lo)), ...xy(P(hi, hi)), ...xy(P(lo, hi))]).fill(road);
  if (conn & 1) g.poly([...xy(P(lo, 0)), ...xy(P(hi, 0)), ...xy(P(hi, lo)), ...xy(P(lo, lo))]).fill(road);
  if (conn & 2) g.poly([...xy(P(hi, lo)), ...xy(P(1, lo)), ...xy(P(1, hi)), ...xy(P(hi, hi))]).fill(road);
  if (conn & 4) g.poly([...xy(P(lo, hi)), ...xy(P(hi, hi)), ...xy(P(hi, 1)), ...xy(P(lo, 1))]).fill(road);
  if (conn & 8) g.poly([...xy(P(0, lo)), ...xy(P(lo, lo)), ...xy(P(lo, hi)), ...xy(P(0, hi))]).fill(road);

  // Marquage central (ou terre-plein pour les avenues)
  const c = P(0.5, 0.5);
  const mark = hex(visual.median ?? visual.marking);
  const mw = visual.median ? 3 : 1;
  const ends = [];
  if (conn & 1) ends.push(P(0.5, 0));
  if (conn & 2) ends.push(P(1, 0.5));
  if (conn & 4) ends.push(P(0.5, 1));
  if (conn & 8) ends.push(P(0, 0.5));
  const straight = (conn === 5 || conn === 10);
  // Ères 2 et 3 : voies « intelligentes » (liserés lumineux), puis balises au centre des carrefours
  if (era >= 2 && congestion < 0) {
    const glow = era >= 3 ? 0x5be3f2 : 0x7fd6e6;
    const e1 = P(lo + 0.03, lo + 0.03);
    const e2 = P(hi - 0.03, hi - 0.03);
    const line = (pts) => {
      g.moveTo(pts[0].x, pts[0].y);
      for (let n = 1; n < pts.length; n++) g.lineTo(pts[n].x, pts[n].y);
      g.stroke({ width: 0.8, color: glow, alpha: 0.7 });
    };
    if (conn & 5) {
      for (const u of [lo + 0.03, hi - 0.03]) line([P(u, 0), P(u, lo), P(u, hi), P(u, 1)]);
    }
    if (conn & 10) {
      for (const v of [lo + 0.03, hi - 0.03]) line([P(0, v), P(lo, v), P(hi, v), P(1, v)]);
    }
    if (era >= 3 && ends.length > 2) {
      g.circle(e1.x, e1.y, 1.4).fill(glow);
      g.circle(e2.x, e2.y, 1.4).fill(glow);
    }
  }
  if (congestion < 0) {
    for (const e of ends) {
      if (!visual.median && !straight && ends.length > 2) continue; // pas de marquage au centre des carrefours
      g.moveTo(c.x, c.y).lineTo(e.x, e.y).stroke({ width: mw, color: mark, alpha: visual.median ? 1 : 0.8 });
    }
  }
}

function xy(p) {
  return [p.x, p.y];
}

export function congestionColor(vc) {
  if (vc < 0.4) return 0x58b368;
  if (vc < 0.7) return 0xc8d14f;
  if (vc < 0.95) return 0xf0a33a;
  if (vc < 1.2) return 0xe0553a;
  return 0x9c1d2a;
}

/** Parcelle zonée vide. */
export function drawZoneTile(g, x, y, alt, color, { reachable = true } = {}) {
  const P = (u, v) => gridToWorld(x + u, y + v, alt);
  const pts = [...xy(P(0.1, 0.1)), ...xy(P(0.9, 0.1)), ...xy(P(0.9, 0.9)), ...xy(P(0.1, 0.9))];
  g.poly(pts).fill({ color: hex(color), alpha: reachable ? 0.5 : 0.22 });
  g.poly(pts).stroke({ width: 1, color: shade(hex(color), 0.7), alpha: 0.8 });
}

/** Contour d'une zone de desserte autorisée (drones). */
export function drawDeliveryZoneTile(g, x, y, alt) {
  const [T, R, B, L] = corners(x, y, alt);
  g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).fill({ color: 0xf0b429, alpha: 0.16 });
}

/**
 * Tablier de pont : piles jusqu'à l'eau, chaussée surélevée et garde-corps le long du franchissement.
 */
export function drawBridgeTile(g, x, y, alt, conn, visual) {
  const P = (u, v, a = alt) => gridToWorld(x + u, y + v, a);
  const dh = alt * HEIGHT_STEP;
  // Sens du franchissement : nord-sud (bits 1|4) ou est-ouest (bits 2|8)
  const ns = (conn & 5) !== 0 && (conn & 10) === 0;
  const pier = 0x8d8a84;
  const pierDark = 0x6c6a66;
  // Pile centrale : deux faces visibles, du tablier jusqu'à l'eau
  const c = P(0.5, 0.5);
  const half = 4;
  g.poly([c.x - half, c.y, c.x, c.y + 2, c.x, c.y + 2 + dh, c.x - half, c.y + dh]).fill(pier);
  g.poly([c.x, c.y + 2, c.x + half, c.y, c.x + half, c.y + dh, c.x, c.y + 2 + dh]).fill(pierDark);
  // Ombre du tablier sur l'eau
  const [T0, R0, B0, L0] = corners(x, y, 0);
  g.poly([T0.x, T0.y, R0.x, R0.y, B0.x, B0.y, L0.x, L0.y]).fill({ color: 0x0b3550, alpha: 0.18 });
  // Chants du tablier (épaisseur)
  const thick = 4;
  const k = (1 - Math.min(0.95, visual.width + 0.12)) / 2;
  const lo = k;
  const hi = 1 - k;
  const edge = 0xb9b4aa;
  if (ns) {
    const a = P(lo, 1);
    const b = P(hi, 1);
    g.poly([a.x, a.y, b.x, b.y, b.x, b.y + thick, a.x, a.y + thick]).fill(shade(edge, 0.8));
    const r1 = P(hi, 0);
    g.poly([r1.x, r1.y, b.x, b.y, b.x, b.y + thick, r1.x, r1.y + thick]).fill(shade(edge, 0.65));
  } else {
    const a = P(1, lo);
    const b = P(1, hi);
    g.poly([a.x, a.y, b.x, b.y, b.x, b.y + thick, a.x, a.y + thick]).fill(shade(edge, 0.65));
    const l1 = P(0, hi);
    g.poly([l1.x, l1.y, b.x, b.y, b.x, b.y + thick, l1.x, l1.y + thick]).fill(shade(edge, 0.8));
  }
  // Plateau puis chaussée
  if (ns) g.poly([...xy(P(lo, 0)), ...xy(P(hi, 0)), ...xy(P(hi, 1)), ...xy(P(lo, 1))]).fill(edge);
  else g.poly([...xy(P(0, lo)), ...xy(P(1, lo)), ...xy(P(1, hi)), ...xy(P(0, hi))]).fill(edge);
  const road = hex(visual.color);
  const m = 0.06;
  if (ns) g.poly([...xy(P(lo + m, 0)), ...xy(P(hi - m, 0)), ...xy(P(hi - m, 1)), ...xy(P(lo + m, 1))]).fill(road);
  else g.poly([...xy(P(0, lo + m)), ...xy(P(1, lo + m)), ...xy(P(1, hi - m)), ...xy(P(0, hi - m))]).fill(road);
  // Marquage central
  const a = ns ? P(0.5, 0) : P(0, 0.5);
  const b = ns ? P(0.5, 1) : P(1, 0.5);
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: hex(visual.median ?? visual.marking), alpha: 0.8 });
  // Garde-corps
  const rail = 0xe8e4da;
  const r1a = ns ? P(lo, 0) : P(0, lo);
  const r1b = ns ? P(lo, 1) : P(1, lo);
  const r2a = ns ? P(hi, 0) : P(0, hi);
  const r2b = ns ? P(hi, 1) : P(1, hi);
  for (const [p1, p2] of [[r1a, r1b], [r2a, r2b]]) {
    g.moveTo(p1.x, p1.y - 3).lineTo(p2.x, p2.y - 3).stroke({ width: 1.2, color: rail });
    for (let t = 0; t <= 1.001; t += 0.25) {
      const px = p1.x + (p2.x - p1.x) * t;
      const py = p1.y + (p2.y - p1.y) * t;
      g.moveTo(px, py).lineTo(px, py - 3).stroke({ width: 1, color: rail });
    }
  }
}

export { corners };
