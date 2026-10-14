import { typedToBase64, base64ToTyped } from '../util/encoding.js';

/** Codes de zone (doivent correspondre aux "code" du catalogue). */
export const ZONE = Object.freeze({ NONE: 0, R_LOW: 1, R_HIGH: 2, C: 3, O: 4, I: 5 });

/**
 * Description des couches de la grille. Toutes sont des tableaux typés de taille width × height.
 * - "persistent" : état décidé par le joueur ou la génération.
 * - "derived"    : champs calculés par la simulation. Ils sont tout de même sauvegardés afin qu'une
 *                  partie rechargée reprenne exactement là où elle s'était arrêtée (déterminisme).
 */
export const LAYER_SPECS = {
  terrain: { type: Uint8Array, persistent: true },
  altitude: { type: Uint8Array, persistent: true },
  zone: { type: Uint8Array, persistent: true },
  road: { type: Uint8Array, persistent: true },
  building: { type: Int32Array, persistent: true },
  deliveryZone: { type: Uint8Array, persistent: true },
  /** Voie ferrée (v0.6) : 1 = voie posée. Peut croiser une route (passage à niveau). */
  rail: { type: Uint8Array, persistent: true, optional: true },
  /** Pont : altitude du tablier + 1 (0 = pas de pont). */
  bridge: { type: Uint8Array, persistent: true },
  tileVersion: { type: Uint32Array, persistent: true },
  landValue: { type: Float32Array },
  pollution: { type: Float32Array },
  noise: { type: Float32Array },
  heat: { type: Float32Array },
  green: { type: Float32Array },
  powered: { type: Uint8Array },
  watered: { type: Uint8Array },
  traffic: { type: Float32Array },
  congestion: { type: Float32Array },
  roadDist: { type: Uint8Array },
  nearestRoad: { type: Int32Array },
  accessibility: { type: Float32Array },
  coverPolice: { type: Float32Array },
  coverFire: { type: Float32Array },
  coverHealth: { type: Float32Array },
  coverEducation: { type: Float32Array },
  coverAdmin: { type: Float32Array },
  delivery: { type: Float32Array },
  density: { type: Float32Array },
  jobDensity: { type: Float32Array },
  /** Déchets accumulés non collectés (0 = propre, 1 = un mois de déchets en souffrance). */
  garbage: { type: Float32Array },
  wasteCover: { type: Float32Array },
  transitBus: { type: Float32Array },
  transitMetro: { type: Float32Array },
  transitRail: { type: Float32Array },
  /**
   * Attractivité d'implantation (v0.6) : valeur foncière pour le logement, attractivité commerciale,
   * tertiaire ou industrielle pour les autres zones (0..100). Sert aux paliers d'évolution.
   */
  siteValue: { type: Float32Array }
};

/** Distance maximale (en cases) entre une parcelle zonée et une route pour pouvoir se développer. */
export const ROAD_REACH = 3;

/**
 * Grille logique du monde : source de vérité pour toutes les règles de construction.
 */
export class Grid {
  /**
   * @param {number} width
   * @param {number} height
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    for (const [name, spec] of Object.entries(LAYER_SPECS)) {
      this[name] = new spec.type(this.size);
    }
    this.nearestRoad.fill(-1);
    this.roadDist.fill(255);
  }

  idx(x, y) {
    return y * this.width + x;
  }

  xOf(i) {
    return i % this.width;
  }

  yOf(i) {
    return (i / this.width) | 0;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Indices voisins (4-connexité) dans l'ordre N, E, S, O. Écrit dans `out` et retourne le nombre. */
  neighbors4(i, out) {
    const x = i % this.width;
    const y = (i / this.width) | 0;
    let n = 0;
    if (y > 0) out[n++] = i - this.width;
    if (x < this.width - 1) out[n++] = i + 1;
    if (y < this.height - 1) out[n++] = i + this.width;
    if (x > 0) out[n++] = i - 1;
    return n;
  }

  /** Altitude de la surface praticable : tablier pour un pont, sol sinon. */
  surfaceAlt(i) {
    return this.bridge[i] ? this.bridge[i] - 1 : this.altitude[i];
  }

  isEdge(x, y) {
    return x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1;
  }

  /** Incrémente la version d'une case (sert à invalider l'annulation et les caches). */
  touch(i) {
    this.tileVersion[i]++;
  }

  serialize() {
    const layers = {};
    for (const name of Object.keys(LAYER_SPECS)) layers[name] = typedToBase64(this[name]);
    return { width: this.width, height: this.height, layers };
  }

  static deserialize(data) {
    const g = new Grid(data.width, data.height);
    for (const [name, spec] of Object.entries(LAYER_SPECS)) {
      const b64 = data.layers[name];
      if (typeof b64 !== 'string') {
        if (spec.persistent && !spec.optional) throw new Error(`Couche persistante manquante : ${name}`);
        continue; // couche dérivée absente : sera recalculée
      }
      const arr = base64ToTyped(b64, spec.type);
      if (arr.length !== g.size) throw new Error(`Taille de couche incohérente : ${name}`);
      g[name] = arr;
    }
    return g;
  }
}
