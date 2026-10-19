import { gridToWorld } from '../IsometricProjection.js';
import { hex, shade, mix } from './color.js';
import { hash2 } from '../../util/rng.js';

/**
 * Dessins procéduraux des équipements ajoutés (déchets, transports, loisirs, énergie)
 * et des niveaux d'habitation futuristes. Les teintes cyan et la végétation signalent
 * les bâtiments des ères 2 et 3.
 */

export const NEON = 0x5be3f2;
export const LEAF = 0x4f9a43;

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const up = (p, h) => ({ x: p.x, y: p.y - h });
const flat = (...pts) => pts.flatMap((p) => [p.x, p.y]);
/** Point de l'emprise en coordonnées relatives (u le long de x, v le long de y). */
const at = (T, R, L, u, v) => ({ x: T.x + (R.x - T.x) * u + (L.x - T.x) * v, y: T.y + (R.y - T.y) * u + (L.y - T.y) * v });

/** Rectangle isométrique au sol, relatif à l'emprise. */
function quad(g, T, R, L, u0, v0, u1, v1, color, h = 0) {
  const a = up(at(T, R, L, u0, v0), h);
  const b = up(at(T, R, L, u1, v0), h);
  const c = up(at(T, R, L, u1, v1), h);
  const d = up(at(T, R, L, u0, v1), h);
  g.poly(flat(a, b, c, d)).fill(color);
}

/** Petit volume (boîte) relatif à l'emprise. */
export function box(g, T, R, L, u0, v0, u1, v1, h, color, z = 0) {
  const p00 = up(at(T, R, L, u0, v0), z);
  const p10 = up(at(T, R, L, u1, v0), z);
  const p11 = up(at(T, R, L, u1, v1), z);
  const p01 = up(at(T, R, L, u0, v1), z);
  g.poly(flat(p01, p11, up(p11, h), up(p01, h))).fill(shade(color, 0.86));
  g.poly(flat(p11, p10, up(p10, h), up(p11, h))).fill(shade(color, 0.7));
  g.poly(flat(up(p00, h), up(p10, h), up(p11, h), up(p01, h))).fill(color);
}

function vehicle(g, p, color, len = 7) {
  g.poly([p.x - len, p.y, p.x, p.y - len / 2, p.x + len, p.y, p.x, p.y + len / 2]).fill(color);
  g.poly([p.x - len, p.y, p.x, p.y + len / 2, p.x, p.y + len / 2 - 3, p.x - len, p.y - 3]).fill(shade(color, 0.75));
}

function tree(g, x, y, s = 1, c = LEAF) {
  g.rect(x - 0.8 * s, y - 5 * s, 1.6 * s, 5 * s).fill(0x6b4a2b);
  g.circle(x, y - 8 * s, 4.5 * s).fill(shade(c, 0.85));
  g.circle(x - 1.2 * s, y - 9.5 * s, 3 * s).fill(c);
}

// ───────────────────────────── Sites au sol (sans volume principal) ─────────────────────────────

export const FLAT_SITE_ROOFS = new Set(['landfill', 'plaza', 'field', 'zoo', 'stadium', 'runway', 'busstop', 'tramstop']);

export function drawFlatSite(g, def, b, alt, T, R, B, L) {
  const v = def.visual;
  const ab = !!b.abandoned;
  switch (v.roof) {
    case 'landfill': {
      // Monticule de déchets, en partie recouvert de terre et d'herbe selon le remplissage
      const fill = Math.min(1, (b.landfillUsed ?? 0) / (def.capacity.waste?.storage || 1));
      const hgt = 4 + fill * 16;
      const c = lerp(T, B, 0.5);
      const rx = Math.abs(R.x - L.x) * 0.36;
      g.ellipse(c.x, c.y, rx, rx * 0.5).fill(0x7a6a4a);
      g.ellipse(c.x, c.y - hgt * 0.5, rx * 0.8, rx * 0.42).fill(0x8d7a55);
      g.ellipse(c.x - 4, c.y - hgt, rx * 0.5, rx * 0.26).fill(fill > 0.6 ? 0x6f8a4a : 0x9b8762);
      for (let k = 0; k < 6; k++) {
        const px = c.x - rx * 0.6 + hash2(b.id, k, 3) * rx * 1.2;
        const py = c.y - hash2(b.id, k, 9) * hgt * 0.8;
        g.rect(px, py, 3, 2).fill([0xc84b3c, 0x3f6fc0, 0xe0b43c, 0xdddddd][k % 4]);
      }
      vehicle(g, at(T, R, L, 0.85, 0.85), 0x4f8a4c);
      return;
    }
    case 'plaza': {
      quad(g, T, R, L, 0.05, 0.05, 0.95, 0.95, 0xd9cfb8);
      for (let k = 1; k < 4; k++) {
        const a = at(T, R, L, k / 4, 0.05);
        const z = at(T, R, L, k / 4, 0.95);
        g.moveTo(a.x, a.y).lineTo(z.x, z.y).stroke({ width: 0.6, color: 0xbfb49b });
      }
      const c = at(T, R, L, 0.5, 0.5);
      if (v.detail === 'fountain') {
        g.ellipse(c.x, c.y, 11, 5.5).fill(0xbfb49b);
        g.ellipse(c.x, c.y, 9, 4.5).fill(ab ? 0x8a8a8a : 0x6fc0e8);
        if (!ab) {
          g.rect(c.x - 0.8, c.y - 9, 1.6, 9).fill(0xd9f2ff);
          g.circle(c.x, c.y - 10, 2.4).fill({ color: 0xd9f2ff, alpha: 0.8 });
        }
      } else if (v.detail === 'statue') {
        box(g, T, R, L, 0.35, 0.35, 0.65, 0.65, 6, 0xbfb49b);
        const top = up(c, 6);
        g.rect(top.x - 1.6, top.y - 12, 3.2, 12).fill(0x7c8a6a);
        g.circle(top.x, top.y - 14, 2.4).fill(0x7c8a6a);
        g.moveTo(top.x, top.y - 10).lineTo(top.x + 5, top.y - 15).stroke({ width: 1.6, color: 0x7c8a6a });
      } else if (v.detail === 'boats') {
        // Pontons et bateaux vers l'eau
        for (let k = 0; k < 3; k++) {
          quad(g, T, R, L, 0.15 + k * 0.28, 0.1, 0.22 + k * 0.28, 0.95, 0xa7865a);
          const p = at(T, R, L, 0.3 + k * 0.28, 0.4 + (k % 2) * 0.3);
          g.poly([p.x - 6, p.y, p.x + 6, p.y - 2, p.x + 4, p.y + 2, p.x - 5, p.y + 3]).fill(0xf5f5f5);
          g.moveTo(p.x, p.y - 1).lineTo(p.x, p.y - 12).stroke({ width: 1, color: 0x666666 });
          g.poly([p.x + 0.5, p.y - 12, p.x + 6, p.y - 3, p.x + 0.5, p.y - 3]).fill(0xffffff);
        }
      }
      return;
    }
    case 'field': {
      quad(g, T, R, L, 0.08, 0.08, 0.92, 0.92, ab ? 0x8a9a7a : 0x4f9a43);
      quad(g, T, R, L, 0.14, 0.14, 0.86, 0.86, ab ? 0x93a383 : 0x5fae4f);
      const a = at(T, R, L, 0.5, 0.14);
      const z = at(T, R, L, 0.5, 0.86);
      g.moveTo(a.x, a.y).lineTo(z.x, z.y).stroke({ width: 1, color: 0xffffff, alpha: 0.85 });
      const c = at(T, R, L, 0.5, 0.5);
      g.ellipse(c.x, c.y, 7, 3.5).stroke({ width: 1, color: 0xffffff, alpha: 0.85 });
      for (const u of [0.14, 0.86]) {
        const p = at(T, R, L, u, 0.5);
        g.rect(p.x - 3, p.y - 6, 6, 6).stroke({ width: 1, color: 0xffffff });
      }
      return;
    }
    case 'zoo': {
      quad(g, T, R, L, 0.05, 0.05, 0.95, 0.95, 0x6aa955);
      // Enclos, bassin et arbres
      quad(g, T, R, L, 0.1, 0.1, 0.45, 0.45, 0xc9b27a);
      quad(g, T, R, L, 0.55, 0.1, 0.9, 0.45, 0x7cbf62);
      const pond = at(T, R, L, 0.3, 0.72);
      g.ellipse(pond.x, pond.y, 14, 7).fill(0x5cb7e0);
      for (const [u, v2] of [[0.1, 0.1], [0.45, 0.1], [0.45, 0.45], [0.1, 0.45]]) {
        const p = at(T, R, L, u, v2);
        g.rect(p.x - 0.5, p.y - 5, 1, 5).fill(0x8a6a4a);
      }
      const animal = at(T, R, L, 0.28, 0.28);
      g.ellipse(animal.x, animal.y - 3, 4, 2.5).fill(0xe0b84c);
      g.rect(animal.x + 2, animal.y - 9, 1.4, 6).fill(0xe0b84c);
      const pts = [];
      for (let k = 0; k < 8; k++) pts.push(at(T, R, L, 0.55 + hash2(b.id, k, 4) * 0.38, 0.5 + hash2(b.id, k, 8) * 0.42));
      pts.sort((p, q) => p.y - q.y).forEach((p) => tree(g, p.x, p.y, 0.9));
      return;
    }
    case 'stadium': {
      const c = at(T, R, L, 0.5, 0.5);
      const rx = Math.abs(R.x - L.x) * 0.42;
      const ry = rx * 0.5;
      const H = v.height;
      g.ellipse(c.x, c.y, rx, ry).fill(shade(0xd7dbe0, 0.7));
      g.ellipse(c.x, c.y - H * 0.5, rx, ry).fill(shade(0xd7dbe0, 0.85));
      g.ellipse(c.x, c.y - H, rx, ry).fill(0xd7dbe0);
      g.ellipse(c.x, c.y - H, rx * 0.84, ry * 0.84).fill(0xb7bcc4);
      g.ellipse(c.x, c.y - H + 4, rx * 0.66, ry * 0.66).fill(ab ? 0x8a9a7a : 0x4f9a43);
      g.ellipse(c.x, c.y - H + 4, rx * 0.4, ry * 0.4).stroke({ width: 1, color: 0xffffff, alpha: 0.8 });
      for (const s of [-1, 1]) {
        g.rect(c.x + s * rx * 0.9 - 1, c.y - H - 18, 2, 18).fill(0x888888);
        g.rect(c.x + s * rx * 0.9 - 4, c.y - H - 21, 8, 3).fill(ab ? 0x777777 : 0xfff3b0);
      }
      return;
    }
    case 'runway': {
      quad(g, T, R, L, 0.02, 0.02, 0.98, 0.98, 0x9fbf7f);
      quad(g, T, R, L, 0.08, 0.55, 0.95, 0.78, 0x4c5057);
      for (let k = 0; k < 7; k++) quad(g, T, R, L, 0.12 + k * 0.12, 0.655, 0.18 + k * 0.12, 0.675, 0xf2f2f2);
      quad(g, T, R, L, 0.1, 0.12, 0.6, 0.45, 0x6d737a);
      box(g, T, R, L, 0.15, 0.15, 0.55, 0.35, 14, 0xd5d9dd);
      // Tour de contrôle
      box(g, T, R, L, 0.7, 0.15, 0.78, 0.23, 34, 0xc9ced3);
      const top = up(at(T, R, L, 0.74, 0.19), 34);
      g.ellipse(top.x, top.y - 3, 7, 4).fill(0x7fc3e8);
      // Avion
      const p = at(T, R, L, 0.4, 0.66);
      g.poly([p.x - 14, p.y + 1, p.x + 14, p.y - 1, p.x + 14, p.y + 1, p.x - 14, p.y + 3]).fill(0xf5f7fa);
      g.poly([p.x - 2, p.y - 7, p.x + 3, p.y - 7, p.x + 4, p.y + 8, p.x - 1, p.y + 8]).fill(0xe8ecf0);
      return;
    }
    case 'busstop': {
      quad(g, T, R, L, 0.1, 0.1, 0.9, 0.9, 0xc9c3b4);
      box(g, T, R, L, 0.25, 0.55, 0.85, 0.75, 9, 0x9fd0e6);
      quad(g, T, R, L, 0.2, 0.5, 0.9, 0.8, ab ? 0x8a8a8a : 0xe2b13c, 10);
      const pole = at(T, R, L, 0.18, 0.3);
      g.rect(pole.x - 0.7, pole.y - 14, 1.4, 14).fill(0x666666);
      g.circle(pole.x, pole.y - 15, 3).fill(ab ? 0x888888 : 0xe2b13c);
      return;
    }
    case 'tramstop': {
      // Quai surélevé, abri vitré à toit vert, totem « T » (v0.8)
      quad(g, T, R, L, 0.05, 0.08, 0.95, 0.92, 0xd8d2c4);
      quad(g, T, R, L, 0.08, 0.12, 0.92, 0.2, 0xf0f0ea);
      box(g, T, R, L, 0.3, 0.6, 0.85, 0.78, 10, 0xa9d8ea);
      quad(g, T, R, L, 0.25, 0.55, 0.9, 0.83, ab ? 0x8a8a8a : 0x2fae6a, 11);
      const pole = at(T, R, L, 0.18, 0.35);
      g.rect(pole.x - 0.8, pole.y - 17, 1.6, 17).fill(0x5b636b);
      g.rect(pole.x - 4, pole.y - 24, 8, 8).fill(ab ? 0x888888 : 0x2fae6a);
      g.rect(pole.x - 2.6, pole.y - 22.5, 5.2, 1.4).fill(0xffffff);
      g.rect(pole.x - 0.7, pole.y - 22, 1.4, 5).fill(0xffffff);
      return;
    }
    default:
  }
}

// ───────────────────────────── Volumes particuliers ─────────────────────────────

/** Arcologie : pyramide à gradins couverte de jardins, avec des liserés lumineux. */
export function drawArcology(g, b, alt, T, R, L, base, abandoned) {
  const steps = 5;
  const total = 124;
  for (let k = 0; k < steps; k++) {
    const m = k * 0.075;
    const z = (total / steps) * k;
    const h = total / steps;
    const c = abandoned ? shade(base, 0.7) : base;
    box(g, T, R, L, m, m, 1 - m, 1 - m, h, c, z);
    const a = up(at(T, R, L, m, 1 - m), z + h * 0.5);
    const z1 = up(at(T, R, L, 1 - m, 1 - m), z + h * 0.5);
    const z2 = up(at(T, R, L, 1 - m, m), z + h * 0.5);
    g.moveTo(a.x, a.y).lineTo(z1.x, z1.y).lineTo(z2.x, z2.y).stroke({ width: 1, color: abandoned ? 0x666666 : NEON, alpha: 0.8 });
    if (!abandoned) {
      // Terrasses plantées
      const p = up(at(T, R, L, 0.5, 1 - m), z + h);
      g.circle(p.x - 4, p.y - 2, 2.5).fill(LEAF);
      g.circle(p.x + 3, p.y - 1, 2).fill(shade(LEAF, 1.2));
    }
  }
  const top = up(at(T, R, L, 0.5, 0.5), total);
  g.rect(top.x - 0.8, top.y - 16, 1.6, 16).fill(0xaab4be);
  if (!abandoned) g.circle(top.x, top.y - 17, 2.5).fill(NEON);
}

/** Jardin vertical : tour fine entièrement végétalisée. */
export function drawVerticalGarden(g, b, T, R, L, H, abandoned) {
  box(g, T, R, L, 0.3, 0.3, 0.7, 0.7, H, abandoned ? 0x7a7a6a : 0x6a8f58);
  for (let k = 0; k < 9; k++) {
    const u = 0.32 + hash2(b.id, k, 2) * 0.36;
    const p = up(at(T, R, L, u, 0.7), 4 + (k / 9) * (H - 6));
    g.circle(p.x, p.y, 3 + hash2(b.id, k, 5) * 2).fill(abandoned ? 0x8a8a7a : k % 2 ? LEAF : shade(LEAF, 1.25));
  }
  const top = up(at(T, R, L, 0.5, 0.5), H);
  tree(g, top.x, top.y + 2, 1.1);
}

/** Centrale nucléaire : bâtiment réacteur et deux tours aéroréfrigérantes. */
export function drawReactor(g, b, T, R, L, abandoned, disabled) {
  // v1.4 : centrale 8 × 8 (deux réacteurs, salle des machines, quatre tours de refroidissement)
  if ((b.w ?? 4) >= 6) return drawBigReactor(g, b, T, R, L, abandoned, disabled);
  box(g, T, R, L, 0.05, 0.05, 0.55, 0.55, 14, 0xc9ced3);
  const dome = up(at(T, R, L, 0.3, 0.3), 14);
  g.ellipse(dome.x, dome.y - 4, 13, 9).fill(0xdfe2e4);
  g.ellipse(dome.x - 4, dome.y - 8, 5, 3).fill({ color: 0xffffff, alpha: 0.4 });
  for (const [u, v] of [[0.72, 0.3], [0.72, 0.75]]) {
    const c = at(T, R, L, u, v);
    const H = 40;
    const w0 = 15;
    const w1 = 10;
    g.poly([c.x - w0, c.y, c.x - w1, c.y - H * 0.6, c.x - w1 - 1, c.y - H, c.x + w1 + 1, c.y - H, c.x + w1, c.y - H * 0.6, c.x + w0, c.y]).fill(0xd3d7da);
    g.poly([c.x, c.y + 2, c.x + w0, c.y, c.x + w1, c.y - H * 0.6, c.x + w1 + 1, c.y - H, c.x, c.y - H]).fill(0xbfc4c8);
    g.ellipse(c.x, c.y - H, w1 + 1, 4).fill(0x8e959a);
    if (!abandoned && !disabled) {
      g.circle(c.x - 3, c.y - H - 8, 9).fill({ color: 0xf2f2f2, alpha: 0.7 });
      g.circle(c.x + 5, c.y - H - 16, 11).fill({ color: 0xf2f2f2, alpha: 0.5 });
    }
  }
}

/** Tour de refroidissement (hyperboloïde) avec son panache. */
function coolingTower(g, c, k, active) {
  const H = 40 * k;
  const w0 = 15 * k;
  const w1 = 10 * k;
  g.poly([c.x - w0, c.y, c.x - w1, c.y - H * 0.6, c.x - w1 - k, c.y - H, c.x + w1 + k, c.y - H, c.x + w1, c.y - H * 0.6, c.x + w0, c.y]).fill(0xd3d7da);
  g.poly([c.x, c.y + 2 * k, c.x + w0, c.y, c.x + w1, c.y - H * 0.6, c.x + w1 + k, c.y - H, c.x, c.y - H]).fill(0xbfc4c8);
  g.ellipse(c.x, c.y - H, w1 + k, 4 * k).fill(0x8e959a);
  if (active) {
    g.circle(c.x - 3 * k, c.y - H - 8 * k, 9 * k).fill({ color: 0xf2f2f2, alpha: 0.7 });
    g.circle(c.x + 5 * k, c.y - H - 16 * k, 11 * k).fill({ color: 0xf2f2f2, alpha: 0.5 });
  }
}

/** v1.4 : grande centrale nucléaire 8 × 8. */
function drawBigReactor(g, b, T, R, L, abandoned, disabled) {
  const k = ((b.w ?? 8) + (b.h ?? 8)) / 10;
  const on = !abandoned && !disabled;
  // Enceinte et voirie interne
  quadFlat(g, T, R, L, 0.03, 0.03, 0.97, 0.97, 0xb7bdb3);
  // Deux bâtiments réacteurs et leurs dômes
  for (const v0 of [0.08, 0.36]) {
    const hgt = 16 * k;
    box(g, T, R, L, 0.07, v0, 0.33, v0 + 0.24, hgt, 0xc9ced3);
    const d = up(at(T, R, L, 0.2, v0 + 0.12), hgt);
    g.ellipse(d.x, d.y - 5 * k, 14 * k, 10 * k).fill(0xdfe2e4);
    g.ellipse(d.x - 4 * k, d.y - 9 * k, 5 * k, 3 * k).fill({ color: 0xffffff, alpha: 0.4 });
  }
  // Salle des machines
  box(g, T, R, L, 0.07, 0.66, 0.33, 0.94, 11 * k, 0xaeb6bd);
  box(g, T, R, L, 0.09, 0.7, 0.31, 0.9, 3 * k, 0x8e98a0, 11 * k);
  // Quatre tours de refroidissement, de l'arrière vers l'avant
  const towers = [[0.55, 0.22], [0.82, 0.22], [0.55, 0.7], [0.82, 0.7]].sort((a, z) => a[0] + a[1] - (z[0] + z[1]));
  for (const [u, v] of towers) coolingTower(g, at(T, R, L, u, v), k * 0.85, on);
}

/** Dalle au sol (sans épaisseur) sur une partie de l'emprise. */
function quadFlat(g, T, R, L, u0, v0, u1, v1, color) {
  g.poly(flat(at(T, R, L, u0, v0), at(T, R, L, u1, v0), at(T, R, L, u1, v1), at(T, R, L, u0, v1))).fill(color);
}

/** Réacteur à fusion : enceinte basse et tore lumineux (v1.4 : à l'échelle de l'emprise 8 × 8). */
export function drawFusion(g, b, T, R, L, abandoned) {
  const k = Math.max(1, ((b.w ?? 3) + (b.h ?? 3)) / 8);
  const hb = 12 * k;
  if (k > 1) {
    quadFlat(g, T, R, L, 0.03, 0.03, 0.97, 0.97, 0xc4cdd6);
    // Bâtiments annexes : alimentation des aimants et salle de contrôle
    box(g, T, R, L, 0.06, 0.06, 0.24, 0.4, 8 * k, 0xd6dde6);
    box(g, T, R, L, 0.06, 0.6, 0.24, 0.94, 8 * k, 0xd6dde6);
  }
  const u0 = k > 1 ? 0.3 : 0.08;
  box(g, T, R, L, u0, 0.12, 0.92, 0.88, hb, 0xe8eef6);
  const c = up(at(T, R, L, (u0 + 0.92) / 2, 0.5), hb);
  const rx = Math.abs(R.x - L.x) * (k > 1 ? 0.22 : 0.28);
  g.ellipse(c.x, c.y - 8 * k, rx, rx * 0.5).fill(0xb8c6d4);
  g.ellipse(c.x, c.y - 14 * k, rx, rx * 0.5).fill(0xdfe7ef);
  g.ellipse(c.x, c.y - 14 * k, rx * 0.55, rx * 0.27).fill(abandoned ? 0x6a7480 : 0x1f3550);
  if (!abandoned) {
    g.ellipse(c.x, c.y - 14 * k, rx * 0.78, rx * 0.39).stroke({ width: 3 * k, color: NEON, alpha: 0.9 });
    g.ellipse(c.x, c.y - 14 * k, rx * 0.9, rx * 0.45).stroke({ width: 1 * k, color: 0xc8f7ff, alpha: 0.6 });
  }
}

// ───────────────────────────── Détails posés sur le volume ─────────────────────────────

/**
 * @param {import('pixi.js').Graphics} g
 * @param {string} d identifiant du détail
 * @param {{T:any,R:any,B:any,L:any,Tt:any,Rt:any,Bt:any,Lt:any,H:number,base:number,roof:number,abandoned:boolean,id:number}} c
 */
export function drawFutureDetail(g, d, c) {
  const { T, R, L, Tt, Rt, Bt, Lt, H, abandoned: ab, id } = c;
  const center = lerp(Tt, Bt, 0.5);
  const on = !ab;
  switch (d) {
    case 'bioHouse': {
      // Toit végétal, panneaux solaires et pergola
      for (let k = 0; k < 4; k++) {
        const p = lerp(lerp(Tt, Rt, 0.2 + k * 0.2), lerp(Lt, Bt, 0.2 + k * 0.2), 0.5);
        g.circle(p.x, p.y - 1.5, 2.5).fill(on ? shade(LEAF, 1 + (k % 2) * 0.2) : 0x777766);
      }
      quad(g, Tt, Rt, Lt, 0.1, 0.1, 0.45, 0.45, on ? 0x2f4f8a : 0x555555, 1);
      tree(g, at(T, R, L, 0.9, 0.95).x, at(T, R, L, 0.9, 0.95).y, 0.7);
      return;
    }
    case 'modular': {
      // Modules empilés en quinconce, liserés lumineux
      box(g, T, R, L, 0.1, 0.4, 0.6, 0.9, 8, on ? 0xe6edf3 : 0x8a8a8a, H);
      box(g, T, R, L, 0.4, 0.1, 0.9, 0.6, 8, on ? 0xd9e8f2 : 0x8a8a8a, H + 8);
      if (on) {
        const a = up(at(T, R, L, 0.1, 0.9), H + 4);
        const z = up(at(T, R, L, 0.6, 0.9), H + 4);
        g.moveTo(a.x, a.y).lineTo(z.x, z.y).stroke({ width: 1.2, color: NEON });
      }
      return;
    }
    case 'greenTower': {
      // Balcons plantés sur chaque face
      const floors = Math.floor(H / 10);
      for (let f = 1; f < floors; f++) {
        for (const [a, b2] of [[L, c.B], [c.B, R]]) {
          for (let k = 0; k < 3; k++) {
            const p = up(lerp(a, b2, 0.2 + k * 0.3), f * 10);
            if (hash2(id + f, k, 7) < 0.7) g.circle(p.x, p.y, 2.6).fill(on ? (k % 2 ? LEAF : shade(LEAF, 1.25)) : 0x777766);
          }
        }
      }
      for (let k = 0; k < 3; k++) {
        const p = lerp(lerp(Tt, Rt, 0.3 + k * 0.2), lerp(Lt, Bt, 0.3 + k * 0.2), 0.5);
        tree(g, p.x, p.y, 0.9);
      }
      return;
    }
    case 'hologram': {
      // Anneau holographique au-dessus du toit et bandes lumineuses
      if (on) {
        g.ellipse(center.x, center.y - 10, 12, 5).stroke({ width: 2, color: NEON, alpha: 0.9 });
        g.ellipse(center.x, center.y - 16, 8, 3.4).stroke({ width: 1.4, color: 0xa8f4ff, alpha: 0.7 });
        g.poly([center.x - 3, center.y - 9, center.x + 3, center.y - 9, center.x, center.y - 22]).fill({ color: NEON, alpha: 0.35 });
        const a = up(L, H * 0.5);
        const z = up(c.B, H * 0.5);
        const z2 = up(R, H * 0.5);
        g.moveTo(a.x, a.y).lineTo(z.x, z.y).lineTo(z2.x, z2.y).stroke({ width: 1.6, color: NEON, alpha: 0.8 });
      }
      return;
    }
    case 'solarGlass': {
      // Couronne de panneaux solaires, jardin sur le toit
      quad(g, Tt, Rt, Lt, 0.08, 0.08, 0.5, 0.92, on ? 0x2f4f8a : 0x555555, 1);
      for (let k = 0; k < 3; k++) {
        const p = lerp(lerp(Tt, Rt, 0.7), lerp(Lt, Bt, 0.7), 0.2 + k * 0.3);
        g.circle(p.x, p.y - 2, 2.5).fill(on ? LEAF : 0x777766);
      }
      return;
    }
    case 'aiTower': {
      // Arête lumineuse, antenne et halo
      if (on) {
        g.moveTo(c.B.x, c.B.y - 4).lineTo(Bt.x, Bt.y).stroke({ width: 2, color: NEON, alpha: 0.9 });
        g.moveTo(R.x, R.y - 4).lineTo(Rt.x, Rt.y).stroke({ width: 1, color: NEON, alpha: 0.5 });
      }
      g.rect(center.x - 1, center.y - 26, 2, 26).fill(0x9aa5b1);
      g.circle(center.x, center.y - 28, on ? 3.2 : 2).fill(on ? NEON : 0x777777);
      if (on) g.circle(center.x, center.y - 28, 6).fill({ color: NEON, alpha: 0.25 });
      return;
    }
    case 'cleanroom': {
      // Dômes de salles blanches
      for (const u of [0.3, 0.7]) {
        const p = lerp(lerp(Tt, Rt, u), lerp(Lt, Bt, u), 0.5);
        g.ellipse(p.x, p.y - 3, 9, 6).fill(on ? 0xe8f6fa : 0x999999);
        g.ellipse(p.x - 2, p.y - 5, 3, 2).fill({ color: 0xffffff, alpha: 0.7 });
      }
      return;
    }
    case 'dam': {
      // Canal et turbines
      quad(g, T, R, L, 0.05, 0.6, 0.95, 0.95, 0x4f8fc0, 0);
      for (let k = 0; k < 3; k++) {
        const p = at(T, R, L, 0.2 + k * 0.3, 0.78);
        g.ellipse(p.x, p.y, 4, 2).fill(on ? 0xd6efff : 0x888888);
      }
      return;
    }
    case 'desal': {
      for (let k = 0; k < 3; k++) {
        const p = lerp(lerp(Tt, Rt, 0.2 + k * 0.3), lerp(Lt, Bt, 0.2 + k * 0.3), 0.5);
        g.ellipse(p.x, p.y - 4, 6, 3).fill(0xdbe7ee);
        g.rect(p.x - 6, p.y - 4, 12, 4).fill(0xc5d4de);
        g.ellipse(p.x, p.y, 6, 3).fill(0xb5c6d2);
      }
      return;
    }
    case 'trucks': {
      for (let k = 0; k < 3; k++) vehicle(g, up(lerp(lerp(Tt, Rt, 0.25 + k * 0.25), lerp(Lt, Bt, 0.25 + k * 0.25), 0.5), 2), on ? 0x4f8a4c : 0x777777, 6);
      return;
    }
    case 'furnace': {
      const p = lerp(Tt, Rt, 0.65);
      g.rect(p.x - 4, p.y - 34, 8, 34).fill(0x8c857c);
      g.rect(p.x - 4, p.y - 34, 8, 4).fill(0xc84b3c);
      if (on) {
        g.circle(p.x + 3, p.y - 40, 6).fill({ color: 0xbdbdbd, alpha: 0.6 });
        g.circle(p.x + 9, p.y - 48, 8).fill({ color: 0xbdbdbd, alpha: 0.4 });
        const f = lerp(L, c.B, 0.5);
        g.rect(f.x - 4, f.y - 10, 8, 7).fill(0xf08a2e);
      }
      return;
    }
    case 'recycle': {
      const cols = [0x3f9a5a, 0xe0b43c, 0x3f6fc0, 0xc84b3c];
      for (let k = 0; k < 4; k++) {
        const p = at(T, R, L, 0.15 + k * 0.2, 0.95);
        g.rect(p.x - 3, p.y - 7, 6, 7).fill(cols[k]);
      }
      if (on) {
        g.circle(center.x, center.y - 2, 6).stroke({ width: 2, color: 0x3f9a5a });
        g.poly([center.x + 5, center.y - 5, center.x + 9, center.y - 2, center.x + 4, center.y]).fill(0x3f9a5a);
      }
      return;
    }
    case 'biogas': {
      for (const u of [0.3, 0.7]) {
        const p = lerp(lerp(Tt, Rt, u), lerp(Lt, Bt, u), 0.5);
        g.ellipse(p.x, p.y - 2, 10, 7).fill(on ? 0x8fbf6a : 0x888888);
        g.ellipse(p.x - 3, p.y - 5, 4, 2.4).fill({ color: 0xffffff, alpha: 0.35 });
      }
      return;
    }
    case 'valorisation': {
      quad(g, Tt, Rt, Lt, 0.1, 0.1, 0.9, 0.9, on ? 0x48c7a8 : 0x777777, 1);
      for (let k = 0; k < 2; k++) {
        const p = lerp(lerp(Tt, Rt, 0.3 + k * 0.4), lerp(Lt, Bt, 0.3 + k * 0.4), 0.5);
        g.rect(p.x - 1.5, p.y - 10, 3, 10).fill(0xf0a030);
        g.rect(p.x - 1.5, p.y - 12, 9, 2.5).fill(0xf0a030);
      }
      if (on) {
        const a = up(L, H * 0.7);
        const z = up(c.B, H * 0.7);
        g.moveTo(a.x, a.y).lineTo(z.x, z.y).stroke({ width: 1.4, color: NEON, alpha: 0.8 });
      }
      return;
    }
    case 'columns': {
      for (let k = 0; k < 5; k++) {
        const p = lerp(L, c.B, 0.1 + k * 0.2);
        g.rect(p.x - 1.2, p.y - H + 3, 2.4, H - 4).fill(0xf6f1e3);
      }
      return;
    }
    case 'playground': {
      const cols = [0xe0553a, 0x3f6fc0, 0xe0b43c];
      for (let k = 0; k < 3; k++) {
        const p = at(T, R, L, 0.25 + k * 0.25, 0.3 + (k % 2) * 0.35);
        g.rect(p.x - 3, p.y - 6, 6, 6).fill(cols[k]);
      }
      return;
    }
    case 'busdepot': {
      for (let k = 0; k < 3; k++) {
        const p = at(T, R, L, 0.2 + k * 0.28, 1.08);
        g.poly([p.x - 9, p.y, p.x + 1, p.y - 5, p.x + 1, p.y - 10, p.x - 9, p.y - 5]).fill(on ? 0xe2b13c : 0x888888);
        g.poly([p.x - 8, p.y - 3, p.x, p.y - 7, p.x, p.y - 9, p.x - 8, p.y - 5]).fill(0x9fd0e6);
      }
      return;
    }
    case 'tramdepot': {
      // Rames de tramway garées devant le dépôt (v0.8)
      for (let k = 0; k < 2; k++) {
        const p = at(T, R, L, 0.18 + k * 0.42, 1.08);
        g.poly([p.x - 16, p.y + 2, p.x + 2, p.y - 7, p.x + 2, p.y - 13, p.x - 16, p.y - 4]).fill(on ? 0xf2f4f6 : 0x8a8a8a);
        g.poly([p.x - 15, p.y - 1, p.x + 1, p.y - 9, p.x + 1, p.y - 11, p.x - 15, p.y - 3]).fill(on ? 0x2fae6a : 0x777777);
        g.poly([p.x - 14, p.y - 2.5, p.x, p.y - 9.5, p.x, p.y - 10.3, p.x - 14, p.y - 3.3]).fill(0x9fd0e6);
      }
      return;
    }
    case 'metro': {
      // Entrée de station : édicule vitré et totem
      const pole = lerp(Tt, Rt, 0.85);
      g.rect(pole.x - 1, pole.y - 18, 2, 18).fill(0x666e78);
      g.rect(pole.x - 5, pole.y - 26, 10, 9).fill(on ? 0x2f6fc0 : 0x777777);
      g.rect(pole.x - 3, pole.y - 24, 1.6, 5).fill(0xffffff);
      g.rect(pole.x + 1.4, pole.y - 24, 1.6, 5).fill(0xffffff);
      g.rect(pole.x - 1, pole.y - 23, 2, 2).fill(0xffffff);
      quad(g, Tt, Rt, Lt, 0.2, 0.2, 0.8, 0.8, on ? 0x9fd0e6 : 0x777777, 1);
      return;
    }
    case 'train': {
      // Quai et voies (les rames sont animées par TrainRenderer quand la gare est en service)
      const a = at(T, R, L, 0.02, 1.06);
      const z = at(T, R, L, 0.98, 1.06);
      g.moveTo(a.x, a.y).lineTo(z.x, z.y).stroke({ width: 3, color: 0x7a6a5a });
      g.moveTo(a.x, a.y - 2).lineTo(z.x, z.y - 2).stroke({ width: 1, color: 0xbfbfbf });
      const q1 = at(T, R, L, 0.02, 0.93);
      const q2 = at(T, R, L, 0.98, 0.93);
      g.moveTo(q1.x, q1.y - 1.5).lineTo(q2.x, q2.y - 1.5).stroke({ width: 2, color: on ? 0xd9d3c4 : 0x888888 });
      const clock = lerp(Tt, Rt, 0.5);
      g.circle(clock.x, clock.y - 8, 3.5).fill(0xf6f1e3);
      return;
    }
    case 'hyperloop': {
      const a = at(T, R, L, -0.3, 0.5);
      const z = at(T, R, L, 1.3, 0.5);
      g.moveTo(a.x, a.y - H - 6).lineTo(z.x, z.y - H - 6).stroke({ width: 7, color: 0xdfe7ef });
      g.moveTo(a.x, a.y - H - 6).lineTo(z.x, z.y - H - 6).stroke({ width: 2, color: on ? NEON : 0x888888, alpha: 0.9 });
      for (const u of [0, 1]) {
        const p = at(T, R, L, u, 0.5);
        g.rect(p.x - 1.5, p.y - H - 6, 3, H + 6).fill(0xb8c2cc);
      }
      return;
    }
    case 'cranes': {
      // Conteneurs et portiques
      const cols = [0xc84b3c, 0x3f6fc0, 0xe0b43c, 0x3f9a5a];
      for (let k = 0; k < 6; k++) {
        const p = lerp(lerp(Tt, Rt, 0.15 + (k % 3) * 0.3), lerp(Lt, Bt, 0.15 + (k % 3) * 0.3), 0.3 + Math.floor(k / 3) * 0.4);
        g.rect(p.x - 5, p.y - 4, 10, 4).fill(cols[k % 4]);
      }
      for (const u of [0.25, 0.75]) {
        const p = at(T, R, L, u, 1.02);
        g.rect(p.x - 1, p.y - 36, 2, 36).fill(0xe0b43c);
        g.moveTo(p.x - 14, p.y - 34).lineTo(p.x + 14, p.y - 38).stroke({ width: 2, color: 0xe0b43c });
      }
      return;
    }
    case 'holoPark':
      return;
    default:
  }
}

/** Sculptures holographiques d'un parc de l'ère 3 (dessinées après les arbres). */
export function drawHoloSculptures(g, b, T, R, L, abandoned) {
  if (abandoned) return;
  for (const [u, v] of [[0.3, 0.3], [0.7, 0.65]]) {
    const p = at(T, R, L, u, v);
    g.ellipse(p.x, p.y, 7, 3.5).fill({ color: NEON, alpha: 0.3 });
    g.poly([p.x - 4, p.y, p.x + 4, p.y, p.x, p.y - 20]).fill({ color: NEON, alpha: 0.4 });
    g.circle(p.x, p.y - 22, 3).fill({ color: 0xc8f7ff, alpha: 0.85 });
  }
}

export { mix, hex };
