/** Outils de couleur pour le rendu procédural (couleurs entières 0xRRGGBB). */

export function hex(c) {
  if (typeof c === 'number') return c;
  return parseInt(String(c).replace('#', ''), 16);
}

export function shade(c, f) {
  const n = hex(c);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

export function mix(a, b, t) {
  const x = hex(a);
  const y = hex(b);
  const r = Math.round(((x >> 16) & 255) * (1 - t) + ((y >> 16) & 255) * t);
  const g = Math.round(((x >> 8) & 255) * (1 - t) + ((y >> 8) & 255) * t);
  const bl = Math.round((x & 255) * (1 - t) + (y & 255) * t);
  return (r << 16) | (g << 8) | bl;
}

export function desaturate(c, t = 0.7) {
  const n = hex(c);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const l = Math.round(r * 0.3 + g * 0.59 + b * 0.11);
  return mix(n, (l << 16) | (l << 8) | l, t);
}

/** Dégradé pour les couches de données : valeur 0..1 → couleur. */
export function ramp(t, stops) {
  const v = Math.max(0, Math.min(1, t));
  const seg = v * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  return mix(stops[i], stops[i + 1], seg - i);
}

export const RAMPS = {
  heat: [0x2b83ba, 0xabdda4, 0xffffbf, 0xfdae61, 0xd7191c],
  good: [0xd7191c, 0xfdae61, 0xffffbf, 0xa6d96a, 0x1a9641],
  mono: [0xf7fbff, 0x9ecae1, 0x3182bd, 0x08306b],
  green: [0xf7fcf5, 0xa1d99b, 0x41ab5d, 0x00441b],
  purple: [0xfcfbfd, 0xbcbddc, 0x807dba, 0x3f007d]
};
