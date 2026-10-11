/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 * L'état tient dans un entier 32 bits : il est sérialisé avec la partie,
 * ce qui garantit qu'une sauvegarde rechargée produit exactement la même suite d'événements.
 */
export class Rng {
  /** @param {number} seed */
  constructor(seed = 1) {
    this.state = seed >>> 0 || 1;
  }

  /** @returns {number} flottant dans [0, 1) */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entier dans [min, max] inclus. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** @param {number} p probabilité */
  chance(p) {
    return this.next() < p;
  }

  serialize() {
    return this.state;
  }

  static from(state) {
    const r = new Rng(1);
    r.state = state >>> 0;
    return r;
  }
}

/**
 * Hachage entier déterministe de coordonnées (variations visuelles et bruit de génération).
 * @returns {number} flottant dans [0, 1)
 */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
