/**
 * Moteur de la vue 3D d'URBIS 2030 (v1.5) — rendu Three.js de la vraie partie, en lecture seule.
 *
 * Contenu, dans l'ordre :
 * 1. outils communs, état visuel (technologies, nuit, animations) et catalogue au format 3D ;
 * 2. géométrie : gabarits de primitives, accumulateur de sommets fusionnés, contexte de modélisation ;
 * 3. vie de la ville : matériaux, objets animés instanciés (personnes, animaux, machines, véhicules de chantier,
 *    bateaux, avions, drones), particules (fumées, vapeur, poussière), éclairage nocturne, train, porte-conteneurs ;
 * 4. modèles des 119 bâtiments du catalogue et rendu visible de leurs améliorations ;
 * 5. circulation : voies, carrefours (priorité ou feux prédictifs), piétons, véhicules d'intervention ;
 * 6. scène : terrain, eau, routes, rails, forêts et bâtiments par tronçons reconstruits à la demande ;
 * 7. crises de la partie mises en scène : incendies et pompiers, crue boueuse, manifestation et émeute,
 *    cambriolages et braquages, ruines, chantiers, sinistres, démolitions, poubelles.
 *
 * Le rendu ne décide d'aucune règle : il lit l'état (via Adapter3D) et ses événements, et anime ce qui s'y passe.
 */
import * as THREE from 'three';
import { T3 } from './Adapter3D.js';

/* ---------- 1. outils communs ---------- */
const LEVEL_H = 0.3;
const T_GRASS = T3.GRASS, T_SAND = T3.SAND, T_FOREST = T3.FOREST, T_ROCK = T3.ROCK, T_WATER = T3.WATER;
void T_GRASS; void T_SAND; void T_ROCK;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, z, s = 0) {
  let h = Math.imul(x * 374761393 + z * 668265263 + s * 2246822519, 1) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Catalogue au format 3D (voir Adapter3D.catalog3d) et état visuel partagé. */
let CATALOG = { roads: [], b: [], ups: [], techs: [] };
const STATE = { tech: new Set(), night: false, nightK: 0, anim: true };
const hasTech = (id) => STATE.tech.has(id);
const hasUp = (b, id) => !!(b && b.ups && b.ups.has(id));
/** Points d'accroche vers l'extérieur (sons ponctuels, poubelles de la partie). */
const HOOKS = { sound: () => {}, garbageAt: () => 0 };
function setCatalog(cat) { CATALOG = cat; }


/* ---------- 2. géométrie ---------- */
const _colCache = new Map();
function C(hex, f = 1) {
  const key = hex + '|' + f;
  let c = _colCache.get(key);
  if (!c) { c = new THREE.Color(hex); if (f !== 1) c.multiplyScalar(f); _colCache.set(key, c); }
  return c;
}
function MIX(a, b, t) {
  const key = a + '>' + b + '|' + t;
  let c = _colCache.get(key);
  if (!c) { c = new THREE.Color(a).lerp(new THREE.Color(b), t); _colCache.set(key, c); }
  return c;
}

const TPL = (() => {
  const prep = (g) => { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; };
  // retire les faces tournées vers le bas (jamais visibles, caméra toujours au-dessus) : −17 % de triangles
  const noBottom = (g) => {
    const P = g.attributes.position.array, N = g.attributes.normal.array, keep = [];
    for (let t = 0; t < P.length / 9; t++) if (!(N[t * 9 + 1] < -0.98 && N[t * 9 + 4] < -0.98 && N[t * 9 + 7] < -0.98)) keep.push(t);
    const p = new Float32Array(keep.length * 9), n = new Float32Array(keep.length * 9);
    keep.forEach((t, i) => { p.set(P.subarray(t * 9, t * 9 + 9), i * 9); n.set(N.subarray(t * 9, t * 9 + 9), i * 9); });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(p, 3)); out.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    return out;
  };
  const box = noBottom(prep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)));
  const boxFull = prep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const plane = prep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const cyl = new Map();
  const cylinder = (k = 1, seg = 12) => {
    const key = k + ':' + seg;
    if (!cyl.has(key)) cyl.set(key, noBottom(prep(new THREE.CylinderGeometry(k, 1, 1, seg).translate(0, 0.5, 0))));
    return cyl.get(key);
  };
  const cylFull = new Map();
  const cylinderFull = (seg = 10) => {
    if (!cylFull.has(seg)) cylFull.set(seg, prep(new THREE.CylinderGeometry(1, 1, 1, seg).translate(0, 0.5, 0)));
    return cylFull.get(seg);
  };
  const hemi = prep(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2));
  const sphere = prep(new THREE.IcosahedronGeometry(1, 1));
  const lowSphere = prep(new THREE.IcosahedronGeometry(1, 0));
  const tri = (pts) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.computeVertexNormals(); return g; };
  // Toit à deux pans, faîtage selon x, base y = 0, sommet y = 1
  const prism = tri([
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
  ]);
  // Shed (toit en dents de scie) : versant incliné vers +z, face verticale vitrée à −z
  const shed = tri([
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, -0.5, -0.5, 0, 0.5, 0.5, 1, -0.5, -0.5, 1, -0.5,
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, -0.5, 0.5, 0, -0.5, -0.5, 1, -0.5, 0.5, 1, -0.5,
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, -0.5,
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, -0.5,
  ]);
  const tor = new Map();
  const torus = (t = 0.25) => {
    if (!tor.has(t)) tor.set(t, prep(new THREE.TorusGeometry(1, t, 10, 36).rotateX(Math.PI / 2)));
    return tor.get(t);
  };
  // Tour de refroidissement (hyperboloïde) en coque fermée : paroi extérieure, couronne, paroi intérieure.
  // Hauteur 1, rayon de base 0.5. La paroi intérieure est visible depuis le haut (plus de « trou »).
  const prof = (y) => 0.31 + 0.19 * Math.pow((y - 0.68) / 0.68, 2);
  const pts = [], th = 0.035;
  for (let i = 0; i <= 12; i++) { const y = i / 12; pts.push(new THREE.Vector2(Math.min(0.5, prof(y)), y)); }
  for (let i = 12; i >= 1; i--) { const y = i / 12; pts.push(new THREE.Vector2(Math.min(0.5, prof(y)) - th, Math.max(0.12, y - 0.001))); }
  const cooling = prep(new THREE.LatheGeometry(pts, 24));
  return { box, boxFull, plane, cylinder, cylinderFull, hemi, sphere, lowSphere, prism, shed, torus, cooling, prof };
})();

/* Accumulateur de sommets. Avec `extra`, deux attributs par sommet pour les objets animés :
 * aEmit (0 normal, 1 lumineux, 2 allumé la nuit, 3 lumineux teinté par instance) et aTint (1 = prend la couleur d'instance). */
class Acc {
  constructor(extra = false) { this.p = []; this.n = []; this.c = []; this.extra = extra; if (extra) { this.e = []; this.k = []; } }
  push(geo, m, col, emit = 0, tint = 1) {
    const P = geo.attributes.position.array, Nn = geo.attributes.normal.array;
    const e = m.elements;
    const a00 = e[0], a01 = e[1], a02 = e[2], a10 = e[4], a11 = e[5], a12 = e[6], a20 = e[8], a21 = e[9], a22 = e[10];
    const b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
    let det = a00 * b01 + a01 * b11 + a02 * b21; det = det ? 1 / det : 0;
    const n00 = b01 * det, n01 = (-a22 * a01 + a02 * a21) * det, n02 = (a12 * a01 - a02 * a11) * det;
    const n10 = b11 * det, n11 = (a22 * a00 - a02 * a20) * det, n12 = (-a12 * a00 + a02 * a10) * det;
    const n20 = b21 * det, n21 = (-a21 * a00 + a01 * a20) * det, n22 = (a11 * a00 - a01 * a10) * det;
    const r = col.r, g = col.g, b = col.b;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      this.p.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      const nx = Nn[i], ny = Nn[i + 1], nz = Nn[i + 2];
      const ox = n00 * nx + n01 * ny + n02 * nz, oy = n10 * nx + n11 * ny + n12 * nz, oz = n20 * nx + n21 * ny + n22 * nz;
      const l = Math.hypot(ox, oy, oz) || 1;
      this.n.push(ox / l, oy / l, oz / l);
      this.c.push(r, g, b);
      if (this.extra) { this.e.push(emit); this.k.push(tint); }
    }
  }
  quad(x0, z0, x1, z1, y, col) {
    const { r, g, b } = col;
    this.p.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
    for (let i = 0; i < 6; i++) { this.n.push(0, 1, 0); this.c.push(r, g, b); if (this.extra) { this.e.push(0); this.k.push(1); } }
  }
  wall(x0, z0, x1, z1, yb, yt, nx, nz, col) {
    const { r, g, b } = col;
    this.p.push(x0, yb, z0, x1, yb, z1, x1, yt, z1, x0, yb, z0, x1, yt, z1, x0, yt, z0);
    const ex = x1 - x0, ez = z1 - z0;
    const cx = -ez, cz = ex;
    if (cx * nx + cz * nz < 0) {
      const p = this.p, k = p.length - 18;
      for (let t = 0; t < 2; t++) { const a = k + t * 9; for (let j = 0; j < 3; j++) { const tmp = p[a + 3 + j]; p[a + 3 + j] = p[a + 6 + j]; p[a + 6 + j] = tmp; } }
    }
    for (let i = 0; i < 6; i++) { this.n.push(nx, 0, nz); this.c.push(r, g, b); if (this.extra) { this.e.push(0); this.k.push(1); } }
  }
  get count() { return this.p.length / 3; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.extra) { g.setAttribute('aEmit', new THREE.Float32BufferAttribute(this.e, 1)); g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.k, 1)); }
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/* Contexte de modélisation : repère local d'un bâtiment (avant = +z, sol = y 0).
 * Les modèles y déclarent aussi leurs éléments vivants : objets animés, fumées, lampadaires, fontaines. */
const EMIT_OF = { body: 0, dark: 0, glow: 1, lit: 2, litc: 2, tglow: 3 };
class Ctx {
  constructor(treeSink) {
    this.trees = treeSink;
    this.sink = null; // { anims, emitters, lamps, pools, landfills }
    this.base = new THREE.Matrix4();
    this._m = new THREE.Matrix4(); this._r = new THREE.Matrix4(); this._s = new THREE.Matrix4(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._v = new THREE.Vector3(); this._u = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.rnd = Math.random;
    this.single = null; // Acc unique (géométrie d'objet animé)
  }
  frame(x, y, z, angle, layers, rnd) {
    this.base.makeRotationY(angle).setPosition(x, y, z);
    this.angle = angle; this.L = layers; this.rnd = rnd || this.rnd;
    this.single = null;
  }
  frameSingle(acc) { this.base.identity(); this.angle = 0; this.single = acc; this.L = null; }
  prim(tpl, x, y, z, sx, sy, sz, col, o) {
    const m = this._m.makeTranslation(x, y, z);
    if (o && (o.rx || o.ry || o.rz)) { this._e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); m.multiply(this._r.makeRotationFromEuler(this._e)); }
    m.multiply(this._s.makeScale(sx, sy, sz));
    m.premultiply(this.base);
    const layer = (o && o.layer) || 'body';
    if (this.single) this.single.push(tpl, m, col, EMIT_OF[layer] || 0, o && o.tint === false ? 0 : 1);
    else this.L[layer === 'tglow' ? 'glow' : layer].push(tpl, m, col);
  }
  box(x, y, z, sx, sy, sz, col, o) { this.prim(o && o.full ? TPL.boxFull : TPL.box, x, y, z, sx, sy, sz, col, o); }
  cyl(x, y, z, r, h, col, o) { this.prim(TPL.cylinder(o && o.k != null ? o.k : 1, (o && o.seg) || 12), x, y, z, r, h, r, col, o); }
  cone(x, y, z, r, h, col, o) { this.prim(TPL.cylinder(0, (o && o.seg) || 10), x, y, z, r, h, r, col, o); }
  hemi(x, y, z, r, col, o) { this.prim(TPL.hemi, x, y, z, r, (o && o.sy) || r, r, col, o); }
  sphere(x, y, z, r, col, o) { this.prim(o && o.low ? TPL.lowSphere : TPL.sphere, x, y, z, r, (o && o.sy) || r, r, col, o); }
  gable(x, y, z, w, h, d, col, o) {
    if (d > w) this.prim(TPL.prism, x, y, z, d, h, w, col, Object.assign({}, o, { ry: Math.PI / 2 }));
    else this.prim(TPL.prism, x, y, z, w, h, d, col, o);
  }
  shed(x, y, z, w, h, d, col, o) { this.prim(TPL.shed, x, y, z, w, h, d, col, o); }
  torus(x, y, z, R, t, col, o) { this.prim(TPL.torus(t), x, y, z, R, (o && o.sy) || R, R, col, o); }
  cooling(x, y, z, r, h, col, o) {
    this.prim(TPL.cooling, x, y, z, r * 2, h, r * 2, col, o);
    this.cyl(x, y + h * 0.12, z, (TPL.prof(0.12) - 0.04) * r * 2, 0.01, C('#2c3136'), { seg: 20 }); // bassin intérieur sombre
  }
  /* cylindre plein orienté entre deux points (tuyaux, grumes, mâts inclinés…) */
  tube(x0, y0, z0, x1, y1, z1, r, col, o) {
    const v = this._v.set(x1 - x0, y1 - y0, z1 - z0), len = v.length();
    if (len < 1e-6) return;
    this._q.setFromUnitVectors(this._u.set(0, 1, 0), v.multiplyScalar(1 / len));
    const m = this._m.compose(this._u.set(x0, y0, z0), this._q, this._v.set(r, len, r));
    m.premultiply(this.base);
    const layer = (o && o.layer) || 'body';
    const tpl = TPL.cylinderFull((o && o.seg) || 8);
    if (this.single) this.single.push(tpl, m, col, EMIT_OF[layer] || 0, o && o.tint === false ? 0 : 1);
    else this.L[layer === 'tglow' ? 'glow' : layer].push(tpl, m, col);
  }
  world(x, y, z) { return new THREE.Vector3(x, y, z).applyMatrix4(this.base); }
  /* ---- éléments vivants ---- */
  anim(kind, x, y, z, data = {}, ry = 0) {
    if (!this.sink) return;
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z).premultiply(this.base);
    this.sink.anims.push({ kind, base: m, d: data, angle: this.angle + ry });
  }
  emit(type, x, y, z, o = {}) {
    if (!this.sink) return;
    const p = this.world(x, y, z);
    this.sink.emitters.push(Object.assign({ type, x: p.x, y: p.y, z: p.z, acc: this.rnd() }, o));
  }
  lamp(x, y, z, r = 0.6, col = '#ffd69a') { if (this.sink) { const p = this.world(x, y, z); this.sink.lamps.push({ x: p.x, y: p.y, z: p.z, r, col }); } }
  pool(x, z, r, col = '#ffd69a', y = 0.05) { if (this.sink) { const p = this.world(x, y, z); this.sink.pools.push({ x: p.x, y: p.y, z: p.z, r, col }); } }
  tree(x, z, s = 1, kind = 0, y = 0) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(this.base);
    this.trees.push({ x: v.x, y: v.y, z: v.z, s, kind });
  }
}

/* Construit la géométrie d'un objet animé dans son repère local. */
function animGeo(fn) {
  const a = new Acc(true), g = new Ctx([]);
  g.frameSingle(a); g.rnd = mulberry32(5);
  fn(g);
  return a.geometry();
}



/* ---------- 3. vie de la ville ---------- */
const U_NIGHT = { value: 0 };
const WATER_Y = -0.3;
const frac = (x) => x - Math.floor(x);
const hf = (a, b) => hash2(Math.floor(a * 977) + 13, b, 77);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const pingpong = (x) => { const f = frac(x * 0.5) * 2; return f < 1 ? f : 2 - f; };

/* Matériau des objets animés : couleur par sommet, teinte par instance (aTint) et parties lumineuses (aEmit). */
function animMaterial(o = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: !!o.transparent, opacity: o.opacity ?? 1, depthWrite: o.transparent ? false : true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U_NIGHT;
    sh.vertexShader = 'attribute float aEmit;\nattribute float aTint;\nuniform float uNight;\nvarying vec3 vEmitC;\n' + sh.vertexShader.replace('#include <color_vertex>', `
      vColor = vec3(1.0);
      #ifdef USE_COLOR
        vColor *= color;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vColor *= mix(vec3(1.0), instanceColor, aTint);
      #endif
      float fE = aEmit < 0.5 ? 0.0 : (aEmit < 1.5 ? 1.0 : (aEmit < 2.5 ? uNight : 1.0));
      vEmitC = (aEmit > 2.5 ? vColor : color) * fE * ${o.gain ? o.gain.toFixed(2) : '1.0'};`);
    sh.fragmentShader = 'varying vec3 vEmitC;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vEmitC;' + (o.self ? ` totalEmissiveRadiance += diffuseColor.rgb * ${o.self.toFixed(2)};` : ''));
  };
  m.customProgramCacheKey = () => 'anim' + (o.transparent ? 't' : '') + (o.gain || '') + (o.self || '');
  return m;
}
function particleMaterial() {
  const m = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = U_NIGHT;
    sh.fragmentShader = 'uniform float uNight;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * (0.42 - 0.3 * uNight);');
    sh.vertexShader = 'attribute float aAlpha;\nvarying float vAlpha;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vAlpha = aAlpha;');
    sh.fragmentShader = 'varying float vAlpha;\n' + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );');
  };
  m.customProgramCacheKey = () => 'particle';
  return m;
}
function radialTexture(stops = [[0, 1], [0.35, 0.55], [1, 0]]) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [p, a] of stops) gr.addColorStop(p, `rgba(255,255,255,${a})`);
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function beamTexture() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 64;
  const x = c.getContext('2d');
  for (let j = 0; j < 64; j++) {
    const a = Math.pow(1 - j / 64, 1.6) * 0.9;
    const gr = x.createLinearGradient(0, 0, 32, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, j, 32, 1);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ------------------------------------------------------------------ genres d'objets animés */
const KINDS = {};
function kind(name, geo, update, opts = {}) { KINDS[name] = { name, geoFn: geo, update, opts, geo: null }; }
const SHIRTS = ['#d64a3a', '#3f6fb0', '#e2b13c', '#3f9a5a', '#f2f2f2', '#8a4f9e', '#e48a2c', '#2d3136', '#5bb8d6', '#c46f93', '#7a8a3c', '#b0b6bd'];
const O = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, hide: false };
function resetO() { O.x = O.y = O.z = O.rx = O.ry = O.rz = 0; O.sx = O.sy = O.sz = 1; O.hide = false; }

/* trajectoire douce dans un rectangle (Lissajous), avec arrêts périodiques si d.stop */
function lissa(d, t, o) {
  const s = d.seed || 0, sp = d.sp || 0.25;
  const a1 = 0.7 + hf(s, 1) * 0.6, a2 = 1.3 + hf(s, 2) * 0.9, b1 = 0.6 + hf(s, 3) * 0.7, b2 = 1.1 + hf(s, 4) * 0.9;
  const p1 = s * 1.7, p2 = s * 2.3, p3 = s * 0.9, p4 = s * 3.1;
  let tt = t * sp, k = 1;
  if (d.stop) { const w = d.stop; tt = t * sp - (sp / w) * Math.sin(t * w + s); k = 1 - Math.cos(t * w + s); }
  o.x = d.cx + d.rx * (0.62 * Math.sin(tt * a1 + p1) + 0.38 * Math.sin(tt * a2 + p2));
  o.z = d.cz + d.rz * (0.62 * Math.sin(tt * b1 + p3) + 0.38 * Math.sin(tt * b2 + p4));
  const dx = d.rx * (0.62 * a1 * Math.cos(tt * a1 + p1) + 0.38 * a2 * Math.cos(tt * a2 + p2));
  const dz = d.rz * (0.62 * b1 * Math.cos(tt * b1 + p3) + 0.38 * b2 * Math.cos(tt * b2 + p4));
  o.ry = Math.atan2(dx, dz);
  return Math.hypot(dx, dz) * sp * k;
}
/* parcours d'une polyligne (fermée ou non) à abscisse curviligne s */
function pathPrep(d) {
  if (d._c) return;
  const P = d.path, n = P.length, closed = d.closed !== false;
  d._c = [0];
  let L = 0;
  for (let i = 0; i < (closed ? n : n - 1); i++) { const a = P[i], b = P[(i + 1) % n]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); d._c.push(L); }
  d._L = L;
}
function onPath(d, s, o) {
  pathPrep(d);
  const P = d.path, n = P.length, c = d._c, L = d._L;
  s = d.closed === false ? Math.max(0, Math.min(L - 1e-6, s)) : ((s % L) + L) % L;
  let i = 0;
  while (i < c.length - 2 && c[i + 1] < s) i++;
  const a = P[i], b = P[(i + 1) % n], u = (s - c[i]) / Math.max(1e-6, c[i + 1] - c[i]);
  o.x = a[0] + (b[0] - a[0]) * u; o.z = a[1] + (b[1] - a[1]) * u;
  o.ry = Math.atan2(b[0] - a[0], b[1] - a[1]);
}
/* parcours aller-retour avec pauses aux extrémités (engins) */
function shuttle(d, t, o) {
  if (d.closed === undefined) d.closed = false;
  pathPrep(d);
  const L = d._L, sp = d.sp || 0.3, dw = d.dwell ?? 1.5;
  const T = L / sp, P = 2 * T + 2 * dw;
  const q = frac(t / P + (d.ph || 0)) * P;
  let s, back = false;
  if (q < dw) s = 0; else if (q < dw + T) s = (q - dw) * sp; else if (q < 2 * dw + T) s = L; else { s = L - (q - 2 * dw - T) * sp; back = true; }
  onPath(d, Math.max(0, Math.min(L - 1e-4, s)), o);
  if (back && !d.reverse) o.ry += Math.PI;
  return (q >= dw && q < dw + T) || back;
}

/* ---------- personnes */
kind('person', (g) => {
  g.box(-0.011, 0, 0, 0.014, 0.048, 0.016, C('#2f3742'), { tint: false });
  g.box(0.011, 0, 0, 0.014, 0.048, 0.016, C('#2f3742'), { tint: false });
  g.box(0, 0.046, 0, 0.042, 0.042, 0.022, C('#ffffff'));
  g.box(0, 0.088, 0, 0.022, 0.024, 0.022, C('#e3b48f'), { tint: false });
}, (d, t, o, inst) => {
  let moving = true;
  switch (d.m) {
    case 'path': pathPrep(d); onPath(d, t * (d.sp || 0.12) + (d.ph || 0) * d._L, o); break;
    case 'commute': { // trajet ouvert répété : apparaît au début, disparaît à l'arrivée
      d.closed = false; pathPrep(d);
      const cyc = d.cyc || 8, q = frac(t / cyc + (d.ph || 0)) * cyc, s = q * (d.sp || 0.1);
      if (s >= d._L) { o.hide = true; break; }
      onPath(d, s, o); break;
    }
    case 'wander': moving = lissa(d, t, o) > 0.01; break;
    case 'kid': lissa(d, t, o); o.y = 0.025 * Math.abs(Math.sin(t * 6 + (d.seed || 0))); break;
    case 'sway': o.x = d.x; o.z = d.z; o.ry = (d.ry || 0) + 0.5 * Math.sin(t * 0.4 + (d.seed || 0)); moving = false; break;
    case 'player': playerPos(d, t, o); { const x0 = o.x, z0 = o.z; playerPos(d, t + 0.15, o); const dx = o.x - x0, dz = o.z - z0; o.x = x0; o.z = z0; o.ry = Math.atan2(dx, dz); moving = Math.hypot(dx, dz) > 0.004; } break;
    case 'passenger': moving = passenger(d, t, o, inst); break;
    case 'run': { // course sur un trajet à partir de d.t0 (cambrioleurs, braqueurs) ; d.hold : reste au bout
      d.closed = false; pathPrep(d);
      const s = (t - d.t0) * (d.sp || 0.6);
      if (s < 0 || (s >= d._L && !d.hold)) { o.hide = true; break; }
      onPath(d, Math.min(d._L - 1e-4, s), o);
      if (s >= d._L) { moving = false; o.ry += 0.4 * Math.sin(t * 2 + (d.seed || 0)); }
      else o.y = 0.012 * Math.abs(Math.sin(t * 16 + (d.seed || 0)));
      break;
    }
    case 'riot': // émeutiers : agitation, sauts, dispersion progressive
      if (d.i / d.n >= d.ev.crowd) { o.hide = true; break; }
      lissa(d, t, o); o.y = d.calm ? 0 : 0.03 + 0.02 * Math.abs(Math.sin(t * 7 + (d.seed || 0))); break;
    default: o.x = d.x || 0; o.z = d.z || 0;
  }
  if (moving && !o.hide) o.y += 0.006 * Math.abs(Math.sin(t * 11 + (d.seed || 0) * 3));
  const s = d.s || 1; o.sx = o.sy = o.sz = s;
}, { palette: SHIRTS });

function ballPos(f, t, o) { // ballon sur un terrain : demi-axes f.rx, f.rz
  const s = f.seed || 0;
  o.bx = f.rx * 0.85 * (0.65 * Math.sin(t * 0.37 + s) + 0.35 * Math.sin(t * 0.91 + s * 2));
  o.bz = f.rz * 0.8 * (0.6 * Math.sin(t * 0.53 + s * 3) + 0.4 * Math.sin(t * 1.17 + s));
}
const _b = {};
function playerPos(d, t, o) {
  ballPos(d.f, t - (d.lag || 0.4), _b);
  const w = d.keeper ? 0.15 : 0.5;
  o.x = d.hx * (1 - w) + _b.bx * w + 0.04 * Math.sin(t * 1.3 + d.seed);
  o.z = d.hz * (1 - w) + _b.bz * w + 0.04 * Math.cos(t * 1.1 + d.seed);
}
kind('ball', (g) => g.sphere(0, 0.012, 0, 0.012, C('#f4f4f4'), { tint: false }), (d, t, o) => { ballPos(d.f, t, _b); o.x = _b.bx; o.z = _b.bz; o.y = 0.02 * Math.abs(Math.sin(t * 3)); });

/* voyageurs de la gare : montent dans le train à l'arrêt, d'autres en descendent */
function passenger(d, t, o, inst) {
  const tr = LIFE.train, st = LIFE.station;
  if (!st || !tr.P) { o.hide = true; return false; }
  const P = tr.P, tau = frac((t - tr.t0) / P) * P, tS = 0.35 * P, tE = 0.5 * P;
  const k = d.k, board = k % 2 === 0, h1 = hf(k, 1), h2 = hf(k, 2);
  const spot = [lerp(st.x0, st.x1, h1), st.pz + (h2 - 0.5) * 0.12];
  const door = st.doors.reduce((a, b) => (Math.abs(b - spot[0]) < Math.abs(a - spot[0]) ? b : a), st.doors[0]);
  const entry = st.entry;
  const go = (a, b, u) => { u = clamp01(u); o.x = lerp(a[0], b[0], u); o.z = lerp(a[1], b[1], u); o.ry = Math.atan2(b[0] - a[0], b[1] - a[1]); };
  if (board) {
    const ta = (0.56 + 0.36 * h2) * P;              // arrivée sur le quai après le départ du train précédent
    const r = (((tau - ta) % P) + P) % P;
    const waitEnd = (tS + P - ta) % P + 0.8 + 0.35 * (k / 2 % 6);
    if (r < 3) { go(entry, spot, r / 3); return true; }
    if (r < waitEnd) { o.x = spot[0]; o.z = spot[1]; o.ry = Math.PI * 0 + (st.faceTrain || 0) + 0.3 * Math.sin(t * 0.5 + k); return false; }
    if (r < waitEnd + 1.2) { go(spot, [door, st.dz], (r - waitEnd) / 1.2); return true; }
    o.hide = true; return false;
  }
  const t0 = tS + 0.9 + 0.3 * ((k - 1) / 2 % 8);
  const r = tau - t0;
  if (r < 0 || r > 3.4) { o.hide = true; return false; }
  go([door, st.dz], entry, r / 3.4); return true;
}

/* ---------- animaux */
const animal = (body, upd) => (d, t, o) => { const v = lissa(d, t, o); o.y = 0; if (upd) upd(d, t, o, v); const s = d.s || 1; o.sx = o.sy = o.sz = s; };
kind('cow', (g) => {
  g.box(0, 0.035, 0, 0.055, 0.045, 0.11, C('#f2efe9'));
  g.box(0.012, 0.05, 0.01, 0.057, 0.025, 0.04, C('#3a2e28'), { tint: false });
  g.box(0, 0.05, 0.065, 0.035, 0.035, 0.035, C('#f2efe9'));
  for (const [x, z] of [[-0.02, -0.04], [0.02, -0.04], [-0.02, 0.04], [0.02, 0.04]]) g.box(x, 0, z, 0.012, 0.036, 0.012, C('#4a3c30'), { tint: false });
}, animal(0, (d, t, o, v) => { o.rx = v < 0.01 ? 0.25 : 0; }), { palette: ['#f2efe9', '#8a5a3c', '#3a2e28', '#d8c2a0'] });
kind('sheep', (g) => {
  g.sphere(0, 0.045, 0, 0.042, C('#f4f1e8'), { sy: 0.032, low: true });
  g.box(0, 0.04, 0.045, 0.022, 0.026, 0.026, C('#3a3330'), { tint: false });
  for (const [x, z] of [[-0.018, -0.02], [0.018, -0.02], [-0.018, 0.02], [0.018, 0.02]]) g.box(x, 0, z, 0.008, 0.025, 0.008, C('#3a3330'), { tint: false });
}, animal(0, (d, t, o, v) => { o.rx = v < 0.01 ? 0.3 : 0; }));
kind('elephant', (g) => {
  g.box(0, 0.06, 0, 0.1, 0.08, 0.16, C('#8f8a85'));
  g.box(0, 0.085, 0.1, 0.07, 0.06, 0.05, C('#8f8a85'));
  g.box(0, 0.03, 0.135, 0.018, 0.07, 0.018, C('#8f8a85'));
  g.box(-0.05, 0.08, 0.09, 0.012, 0.06, 0.05, C('#a09a95')); g.box(0.05, 0.08, 0.09, 0.012, 0.06, 0.05, C('#a09a95'));
  for (const [x, z] of [[-0.035, -0.05], [0.035, -0.05], [-0.035, 0.05], [0.035, 0.05]]) g.box(x, 0, z, 0.025, 0.06, 0.025, C('#857f7a'));
}, animal());
kind('giraffe', (g) => {
  g.box(0, 0.07, 0, 0.045, 0.045, 0.1, C('#e0b45a'));
  g.box(0, 0.1, 0.045, 0.022, 0.14, 0.022, C('#e0b45a'), { rx: 0.35 });
  g.box(0, 0.23, 0.09, 0.025, 0.025, 0.05, C('#d9a54a'));
  for (const [x, z] of [[-0.016, -0.04], [0.016, -0.04], [-0.016, 0.04], [0.016, 0.04]]) g.box(x, 0, z, 0.01, 0.075, 0.01, C('#c98f3a'));
}, animal());
kind('zebra', (g) => {
  g.box(0, 0.045, 0, 0.04, 0.04, 0.1, C('#f4f4f4'));
  for (let i = 0; i < 4; i++) g.box(0, 0.046, -0.04 + i * 0.026, 0.042, 0.041, 0.008, C('#202020'));
  g.box(0, 0.07, 0.055, 0.022, 0.05, 0.03, C('#f4f4f4'), { rx: 0.5 });
  for (const [x, z] of [[-0.014, -0.035], [0.014, -0.035], [-0.014, 0.035], [0.014, 0.035]]) g.box(x, 0, z, 0.009, 0.048, 0.009, C('#2a2a2a'));
}, animal());
kind('duck', (g) => { g.sphere(0, 0.008, 0, 0.018, C('#f6f6f2'), { sy: 0.012, low: true }); g.box(0, 0.016, 0.014, 0.01, 0.014, 0.01, C('#2f7a3a')); g.box(0, 0.02, 0.022, 0.006, 0.004, 0.01, C('#e8a22c')); },
  (d, t, o) => { lissa(d, t, o); o.y = d.y || 0; });
kind('gull', (g) => {
  g.box(0, 0, 0, 0.014, 0.012, 0.045, C('#f4f6f8'));
  g.box(0, 0.006, 0, 0.11, 0.004, 0.022, C('#e6e9ec'));
  g.box(-0.05, 0.007, -0.002, 0.012, 0.004, 0.02, C('#3a3f45'), { tint: false }); g.box(0.05, 0.007, -0.002, 0.012, 0.004, 0.02, C('#3a3f45'), { tint: false });
}, (d, t, o) => {
  const a = t * (d.sp || 0.6) + (d.ph || 0);
  o.x = d.cx + Math.cos(a) * d.r; o.z = d.cz + Math.sin(a) * d.r * 0.8; o.y = d.y + 0.12 * Math.sin(t * 0.7 + (d.ph || 0));
  o.ry = Math.atan2(-Math.sin(a), Math.cos(a) * 0.8) ; o.rz = -0.35;
  o.sx = 0.65 + 0.35 * Math.abs(Math.sin(t * 7 + (d.ph || 0)));
});

/* ---------- engins */
const wheelsAt = (g, pts, r, w) => { for (const [x, z] of pts) g.tube(x - w / 2, r, z, x + w / 2, r, z, r, C('#22262b'), { tint: false, seg: 8 }); };
kind('tractor', (g) => {
  g.box(0, 0.04, 0.02, 0.07, 0.05, 0.14, C('#3f9a3a'));
  g.box(0, 0.09, -0.03, 0.065, 0.06, 0.06, C('#bcd8e6'), { tint: false });
  g.box(0, 0.15, -0.03, 0.075, 0.008, 0.07, C('#3f9a3a'));
  g.box(0.02, 0.09, 0.07, 0.01, 0.05, 0.01, C('#2b2f33'), { tint: false });
  wheelsAt(g, [[-0.05, -0.04], [0.05, -0.04]], 0.04, 0.03); wheelsAt(g, [[-0.045, 0.06], [0.045, 0.06]], 0.025, 0.022);
  g.box(0, 0.05, 0.1, 0.05, 0.015, 0.01, C('#fff4c8'), { layer: 'lit', tint: false });
}, (d, t, o) => { shuttle(d, t, o); }, { palette: ['#3f9a3a', '#c8463a', '#2f6fb0', '#e2b13c'] });
kind('harvester', (g) => {
  g.box(0, 0.035, 0, 0.12, 0.08, 0.2, C('#e2b13c'));
  g.box(0, 0.115, -0.03, 0.07, 0.06, 0.07, C('#bcd8e6'), { tint: false });
  g.box(0, 0.02, 0.13, 0.22, 0.04, 0.05, C('#c99a2c'));
  g.tube(0.05, 0.12, -0.02, 0.12, 0.16, -0.12, 0.012, C('#c99a2c'));
  wheelsAt(g, [[-0.065, 0.05], [0.065, 0.05], [-0.06, -0.07], [0.06, -0.07]], 0.035, 0.025);
}, (d, t, o) => { shuttle(d, t, o); });
kind('forklift', (g) => {
  g.box(0, 0.02, 0, 0.06, 0.05, 0.08, C('#e48a2c'));
  g.box(0, 0.07, -0.01, 0.055, 0.004, 0.055, C('#2b2f33'), { tint: false });
  for (const x of [-0.022, 0.022]) g.box(x, 0.07, -0.035, 0.004, 0.004, 0.004, C('#2b2f33'), { tint: false }), g.box(x, 0.02, 0.045, 0.006, 0.1, 0.006, C('#2b2f33'), { tint: false });
  g.box(0, 0.02, 0.06, 0.05, 0.004, 0.05, C('#5a5f66'), { tint: false });
  g.box(0, 0.026, 0.06, 0.045, 0.035, 0.04, C('#c9a774'), { tint: false });
  wheelsAt(g, [[-0.03, -0.025], [0.03, -0.025], [-0.03, 0.025], [0.03, 0.025]], 0.014, 0.012);
}, (d, t, o) => { shuttle(d, t, o); }, { palette: ['#e48a2c', '#e2b13c'] });
kind('dumper', (g) => {
  g.box(0, 0.03, 0.06, 0.09, 0.07, 0.06, C('#e2b13c'));
  g.box(0, 0.05, -0.03, 0.1, 0.05, 0.13, C('#e2b13c'));
  g.box(0, 0.095, -0.03, 0.09, 0.012, 0.11, C('#9b9384'), { tint: false });
  wheelsAt(g, [[-0.055, 0.06], [0.055, 0.06], [-0.055, -0.06], [0.055, -0.06]], 0.03, 0.025);
}, (d, t, o) => { shuttle(d, t, o); if (d.lf && d.lf.heightAt) o.y = d.lf.heightAt(o.x, o.z); });
kind('bulldozer', (g) => {
  g.box(0, 0.02, 0, 0.08, 0.05, 0.11, C('#e2b13c'));
  g.box(0, 0.07, -0.02, 0.05, 0.04, 0.045, C('#bcd8e6'), { tint: false });
  g.box(0, 0.0, 0.075, 0.11, 0.045, 0.012, C('#7d7f84'), { tint: false });
  g.box(-0.045, 0.0, 0, 0.022, 0.03, 0.12, C('#2b2f33'), { tint: false }); g.box(0.045, 0.0, 0, 0.022, 0.03, 0.12, C('#2b2f33'), { tint: false });
}, (d, t, o) => { shuttle(d, t, o); if (d.lf && d.lf.heightAt) o.y = d.lf.heightAt(o.x, o.z); });
kind('lorry', (g) => {
  g.box(0, 0.025, 0.12, 0.1, 0.11, 0.08, C('#e6e8ea'), { tint: false });
  g.box(0, 0.07, 0.165, 0.09, 0.04, 0.005, C('#2f4256'), { tint: false });
  g.box(0, 0.025, -0.04, 0.1, 0.13, 0.24, C('#ffffff'));
  wheelsAt(g, [[-0.05, 0.12], [0.05, 0.12], [-0.05, -0.1], [0.05, -0.1]], 0.022, 0.02);
  g.box(-0.035, 0.05, 0.161, 0.02, 0.012, 0.005, C('#ffffff'), { layer: 'glow', tint: false }); g.box(0.035, 0.05, 0.161, 0.02, 0.012, 0.005, C('#ffffff'), { layer: 'glow', tint: false });
}, (d, t, o) => { shuttle(d, t, o); if (d.lf && d.lf.heightAt) o.y = d.lf.heightAt(o.x, o.z); }, { palette: ['#3f8a4c', '#ffffff', '#3f6fb0', '#c8463a'] });
kind('agv', (g) => {
  g.box(0, 0.006, 0, 0.07, 0.022, 0.09, C('#e9eef2'), { tint: false });
  g.box(0, 0.028, 0, 0.06, 0.03, 0.06, C('#c9a774'));
  g.box(0, 0.012, 0.046, 0.05, 0.008, 0.003, C('#62e6f7'), { layer: 'glow', tint: false });
}, (d, t, o) => { if (d.closed === false) shuttle(d, t, o); else { pathPrep(d); onPath(d, t * (d.sp || 0.25) + (d.ph || 0) * d._L, o); } }, { palette: ['#c9a774', '#3f6fb0', '#c8463a'] });

/* ---------- machines */
kind('pumpBeam', (g) => {
  g.box(-0.04, -0.02, 0, 0.42, 0.035, 0.035, C('#e0a030'));
  g.box(0.18, -0.07, 0, 0.05, 0.11, 0.045, C('#e0a030'), { rz: 0.2 });
  g.box(-0.24, -0.03, 0, 0.03, 0.05, 0.03, C('#3f3f46'), { tint: false });
}, (d, t, o) => { o.rz = 0.24 * Math.sin(t * (d.sp || 1.6) + (d.ph || 0)); }, { palette: ['#e0a030', '#d24a32', '#4fc3d9'] });
kind('pumpCrank', (g) => {
  g.box(0, -0.01, 0.03, 0.03, 0.1, 0.012, C('#3f3f46'), { tint: false });
  g.box(0, 0.06, 0.03, 0.06, 0.05, 0.018, C('#c8463a'));
}, (d, t, o) => { o.rz = t * (d.sp || 1.6) + (d.ph || 0); });
kind('drillPipe', (g) => {
  g.tube(0, 0, 0, 0, 0.75, 0, 0.012, C('#c9cdd0'), { tint: false });
  g.box(0, 0.6, 0, 0.07, 0.08, 0.07, C('#e2b13c'));
}, (d, t, o) => { o.y = -0.2 * (0.5 + 0.5 * Math.sin(t * 0.5 + (d.ph || 0))); o.ry = t * 3; });
kind('flame', (g) => {
  g.cone(0, 0, 0, 0.03, 0.12, C('#ff8a2a'), { layer: 'glow', tint: false, seg: 6 });
  g.cone(0, 0.0, 0, 0.018, 0.08, C('#ffe36a'), { layer: 'glow', tint: false, seg: 6 });
}, (d, t, o) => {
  if (d.on === false) { o.hide = true; return; }
  const p = d.ph || 0, s = d.s || 1;
  o.sy = s * (0.9 + 0.35 * Math.sin(t * 13 + p) + 0.2 * Math.sin(t * 29 + p * 2));
  o.sx = o.sz = s * (0.9 + 0.15 * Math.sin(t * 17 + p));
  o.rz = 0.15 * Math.sin(t * 3 + p);
});
kind('rotor', (g) => {
  for (let k = 0; k < 3; k++) g.box(0, 0, 0, 0.045, 1, 0.015, C('#f4f6f7'), { rz: (k * Math.PI * 2) / 3 });
  g.sphere(0, 0, 0, 0.05, C('#e2e6e8'), { low: true });
}, (d, t, o) => { o.rz = t * (d.sp || 1.6) + (d.ph || 0); o.sx = o.sy = d.R || 0.9; });
kind('fan', (g) => {
  for (let k = 0; k < 4; k++) g.box(0, 0, 0, 0.18, 0.006, 1.6, C('#4a5058'), { ry: (k * Math.PI) / 4 });
}, (d, t, o) => { o.ry = t * (d.sp || 5) + (d.ph || 0); o.sx = o.sz = d.r || 0.08; });
kind('tracker', (g) => {
  g.box(0, -0.008, 0, 1, 0.016, 0.16, C('#24365e'));
  g.box(0, -0.003, 0, 1.0, 0.004, 0.17, C('#9aa3ab'), { tint: false });
}, (d, t, o) => { o.rx = 0.7 * Math.sin(t * 0.05 + (d.ph || 0)); o.sx = d.len || 1; });
kind('clarifier', (g) => {
  g.box(0.5, 0, 0, 1, 0.015, 0.035, C('#8e979f'), { tint: false });
  g.box(0, 0, 0, 0.07, 0.04, 0.07, C('#c9cdd0'), { tint: false });
  g.box(0.95, 0, 0, 0.05, 0.035, 0.05, C('#e2b13c'), { tint: false });
}, (d, t, o) => { o.ry = t * 0.25 + (d.ph || 0); o.sx = o.sz = d.r || 0.4; });
kind('craneTrolley', (g) => {
  g.box(0, 0, 0, 0.16, 0.06, 0.16, C('#f2f2f2'), { tint: false });
  g.box(0, -0.45, 0, 0.008, 0.45, 0.008, C('#3a3f45'), { tint: false });
  g.box(0, -0.48, 0, 0.13, 0.025, 0.3, C('#e2b13c'), { tint: false });
}, (d, t, o) => { craneX(d, t, o); });
kind('craneBox', (g) => g.box(0, -0.1, 0, 0.12, 0.1, 0.28, C('#ffffff')), (d, t, o) => { const carry = craneX(d, t, o); o.y = -0.4 + 0.0; if (!carry) o.hide = true; }, { palette: ['#c8463a', '#2f6fb0', '#e2b13c', '#3f9a5a', '#8a4f9e'] });
function craneX(d, t, o) {
  if (!LIFE.ship.docked) { o.x = 0.2; return false; }
  const P = 11, q = frac(t / P + (d.ph || 0)), A = 0.3, B = -0.78;
  // 0–0.4 aller vers le navire (vide), 0.4–0.5 accroche, 0.5–0.9 retour chargé, 0.9–1 dépose
  const x = q < 0.4 ? lerp(A, B, smooth(q / 0.4)) : q < 0.5 ? B : q < 0.9 ? lerp(B, A, smooth((q - 0.5) / 0.4)) : A;
  o.x = x;
  return q >= 0.45 && q < 0.95;
}
kind('robotArm', (g) => {
  g.cyl(0, 0, 0, 0.035, 0.05, C('#4b6070'), { tint: false });
  g.box(0, 0.05, 0.0, 0.03, 0.16, 0.03, C('#e48a2c'), { rx: 0.35 });
  g.box(0, 0.19, 0.06, 0.025, 0.025, 0.14, C('#e48a2c'), { rx: -0.25 });
  g.box(0, 0.16, 0.13, 0.03, 0.04, 0.02, C('#3a3f45'), { tint: false });
}, (d, t, o) => { o.ry = 1.2 * Math.sin(t * (d.sp || 0.9) + (d.ph || 0)); o.y = 0; o.sx = o.sy = o.sz = d.s || 1; }, { palette: ['#e48a2c', '#3fa0b8', '#48c7a8'] });
kind('beltStone', (g) => g.sphere(0, 0.015, 0, 0.022, C('#a39887'), { low: true }), beltUpd, { palette: ['#a39887', '#8f8371', '#b9ae97', '#7c705f'] });
kind('beltLog', (g) => g.tube(-0.12, 0.022, 0, 0.12, 0.022, 0, 0.022, C('#8a5f3a'), { seg: 6 }), beltUpd);
kind('beltBox', (g) => g.box(0, 0, 0, 0.05, 0.04, 0.05, C('#c9a774')), beltUpd, { palette: ['#c9a774', '#b58a58', '#e1d0b0'] });
function beltUpd(d, t, o) {
  const u = frac(t * (d.sp || 0.15) + d.k / d.n);
  o.x = lerp(d.a[0], d.b[0], u); o.y = lerp(d.a[1], d.b[1], u); o.z = lerp(d.a[2], d.b[2], u);
  o.ry = Math.atan2(d.b[0] - d.a[0], d.b[2] - d.a[2]) + Math.PI / 2;
  if (d.drop && u > 0.96) o.hide = true;
}
kind('swing', (g) => {
  g.box(-0.035, -0.12, 0, 0.004, 0.12, 0.004, C('#8e979f'), { tint: false }); g.box(0.035, -0.12, 0, 0.004, 0.12, 0.004, C('#8e979f'), { tint: false });
  g.box(0, -0.125, 0, 0.08, 0.008, 0.03, C('#c8463a'));
}, (d, t, o) => { o.rx = STATE.night ? 0 : 0.75 * Math.sin(t * 2.6 + (d.ph || 0)); }, { palette: ['#c8463a', '#e2b13c', '#3f9a5a', '#3f6fb0'] });
kind('carousel', (g) => {
  g.cyl(0, 0, 0, 0.11, 0.015, C('#e2b13c'), { seg: 10 });
  for (let k = 0; k < 4; k++) g.box(0, 0.015, 0, 0.004, 0.05, 0.2, C('#c8463a'), { ry: (k * Math.PI) / 4 });
  g.cyl(0, 0.015, 0, 0.012, 0.06, C('#8e979f'), { tint: false });
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; g.box(Math.cos(a) * 0.075, 0.015, Math.sin(a) * 0.075, 0.025, 0.02, 0.025, C(SHIRTS[k * 3]), { tint: false }); }
}, (d, t, o) => { o.ry = STATE.night ? (d.ph || 0) : t * 1.6 + (d.ph || 0); });

/* ---------- eau : jets de fontaine aux motifs variés, jets d'arrosage */
kind('jet', (g) => {
  g.cyl(0, 0, 0, 0.014, 1, C('#e4f6ff'), { k: 0.25, seg: 7, layer: 'lit' });
  g.sphere(0, 1, 0, 0.022, C('#e6f7ff'), { low: true, layer: 'lit' });
}, (d, t, o) => {
  if (d.ev && (d.ev.ended || d.ev.trucksGone)) { o.hide = true; return; }
  const h = d.h || 0.2, k = d.k || 0, p = d.ph || 0;
  let f;
  switch (d.pattern) {
    case 'wave': f = 0.25 + 0.75 * Math.max(0, Math.sin(t * 2.6 - k * (Math.PI * 2 / (d.n || 6)))); break;
    case 'dance': { const seq = Math.floor((t + p) / 4) % 3; const on = seq === 0 ? 1 : seq === 1 ? (k % 2) : ((k + 1) % 2); f = on ? 0.35 + 0.65 * Math.abs(Math.sin(t * 1.9 + k * 0.6)) : 0.08; break; }
    case 'arc': f = 0.6 + 0.4 * Math.sin(t * 1.3 + p); o.rx = d.tilt || 0.55; break;
    case 'bubble': f = 0.7 + 0.3 * Math.sin(t * 5 + p); break;
    default: f = 0.55 + 0.45 * Math.sin(t * 1.7 + p) * Math.sin(t * 0.43 + p * 2);
  }
  o.sy = Math.max(0.02, h * f); o.sx = o.sz = d.w || 1;
  if (d.spin) o.ry = t * d.spin + p;
}, { mat: 'water' });
kind('splash', (g) => g.torus(0, 0, 0, 1, 0.3, C('#e6f7ff'), { sy: 0.4, layer: 'lit' }), (d, t, o) => {
  const s = (d.r || 0.04) * (1 + 0.18 * Math.sin(t * 4 + (d.ph || 0))); o.sx = o.sz = s; o.sy = s;
}, { mat: 'water' });

/* ---------- lumières, hologrammes, capteurs */
kind('holoRing', (g) => g.torus(0, 0, 0, 1, 0.04, C('#62e6f7'), { layer: 'tglow' }), (d, t, o) => {
  o.y = 0.04 * Math.sin(t * 1.4 + (d.ph || 0)); o.ry = t * (d.spin || 0.8); o.rx = d.tilt || 0; o.sx = o.sy = o.sz = d.r || 0.2;
  if (d.need && !hasTech(d.need)) o.hide = true;
}, { palette: ['#62e6f7'] });
kind('holoBars', (g) => { for (let i = 0; i < 4; i++) g.box(-0.06 + i * 0.04, 0, 0, 0.025, 1, 0.006, C(['#62e6f7', '#7ff0b0', '#c58bff', '#62e6f7'][i]), { layer: 'glow', tint: false }); },
  (d, t, o) => { o.sy = 0.06 + 0.05 * Math.abs(Math.sin(t * 0.9 + (d.ph || 0))); o.ry = t * 0.6; });
kind('beacon', (g) => g.sphere(0, 0, 0, 0.022, C('#ff3b30'), { layer: 'glow', tint: false, low: true }), (d, t, o) => {
  const on = frac(t * 0.7 + (d.ph || 0)) < 0.45; o.sx = o.sy = o.sz = on ? 1 : 0.35;
});
kind('beaconBlue', (g) => g.sphere(0, 0, 0, 0.022, C('#3d7bff'), { layer: 'glow', tint: false, low: true }), (d, t, o) => {
  const on = frac(t * 1.6 + (d.ph || 0) + 0.5) < 0.45; o.sx = o.sy = o.sz = on ? 1.2 : 0.3;
});
kind('sensor', (g) => { g.box(0, 0, 0, 0.012, 0.16, 0.012, C('#7d8288'), { tint: false }); g.sphere(0, 0.17, 0, 0.018, C('#62e6f7'), { layer: 'glow', tint: false, low: true }); },
  (d, t, o) => { if (d.need && !hasTech(d.need)) { o.hide = true; return; } o.sy = 1; const on = frac(t * 0.6 + (d.ph || 0)) < 0.2; o.sx = o.sz = on ? 1.4 : 1; });
kind('pulse', (g) => g.sphere(0, 0, 0, 0.035, C('#62e6f7'), { layer: 'glow', tint: false, low: true }), (d, t, o) => {
  if (!hasTech('smart_grid')) { o.hide = true; return; }
  const u = frac(t * (d.sp || 0.35) + d.k / 3);
  o.x = lerp(d.a[0], d.b[0], u); o.y = lerp(d.a[1], d.b[1], u) - 0.12 * Math.sin(u * Math.PI); o.z = lerp(d.a[2], d.b[2], u);
});

/* ---------- drones */
kind('drone', (g) => {
  g.box(0, 0, 0, 0.12, 0.012, 0.012, C('#2b2f33'), { tint: false, ry: Math.PI / 4 }); g.box(0, 0, 0, 0.12, 0.012, 0.012, C('#2b2f33'), { tint: false, ry: -Math.PI / 4 });
  g.box(0, -0.008, 0, 0.04, 0.025, 0.04, C('#eef1f4'));
  for (const [x, z] of [[0.042, 0.042], [-0.042, 0.042], [0.042, -0.042], [-0.042, -0.042]]) g.cyl(x, 0.008, z, 0.025, 0.004, C('#8e979f'), { tint: false, seg: 8 });
  g.box(0, -0.04, 0, 0.035, 0.03, 0.035, C('#c9a774'), { tint: false });
  g.sphere(0, 0.012, 0.022, 0.008, C('#62e6f7'), { layer: 'glow', tint: false, low: true });
  g.sphere(0, 0.012, -0.022, 0.008, C('#ff3b30'), { layer: 'glow', tint: false, low: true });
}, (d, t, o) => {
  if (d.m === 'patrol') {
    const a = t * 0.5 + (d.ph || 0);
    o.x = d.c[0] + Math.cos(a) * d.r; o.z = d.c[2] + Math.sin(a) * d.r; o.y = d.c[1] + 0.8 + 0.15 * Math.sin(t * 1.3 + (d.ph || 0));
    o.ry = Math.atan2(-Math.sin(a), Math.cos(a)); o.rz = 0.15; return;
  }
  if (!hasTech('drone_delivery')) { o.hide = true; return; }
  droneDelivery(d, t, o);
});
function droneDelivery(d, t, o) {
  const P = 26, cyc = Math.floor(t / P + (d.ph || 0)), q = frac(t / P + (d.ph || 0)) * P;
  const T = LIFE.targets;
  if (!T.length) { o.hide = true; return; }
  if (!d._near) d._near = T.filter((p) => Math.hypot(p.x - d.h[0], p.z - d.h[2]) < 16 && Math.hypot(p.x - d.h[0], p.z - d.h[2]) > 2);
  const N = d._near.length ? d._near : T;
  const tg = N[Math.floor(hf(cyc, d.k + 3) * N.length) % N.length];
  const h = d.h, cy = Math.max(h[1], tg.y) + 1.2 + 0.2 * (d.k % 3);
  // 0–2 décollage, 2–10 vol aller, 10–12 descente, 12–14 livraison, 14–16 montée, 16–24 retour, 24–26 atterrissage
  let x, y, z, u;
  if (q < 2) { x = h[0]; z = h[2]; y = lerp(h[1], cy, smooth(q / 2)); }
  else if (q < 10) { u = smooth((q - 2) / 8); x = lerp(h[0], tg.x, u); z = lerp(h[2], tg.z, u); y = cy; }
  else if (q < 12) { x = tg.x; z = tg.z; y = lerp(cy, tg.y + 0.08, smooth((q - 10) / 2)); }
  else if (q < 14) { x = tg.x; z = tg.z; y = tg.y + 0.08; }
  else if (q < 16) { x = tg.x; z = tg.z; y = lerp(tg.y + 0.08, cy, smooth((q - 14) / 2)); }
  else if (q < 24) { u = smooth((q - 16) / 8); x = lerp(tg.x, h[0], u); z = lerp(tg.z, h[2], u); y = cy; }
  else { x = h[0]; z = h[2]; y = lerp(cy, h[1], smooth((q - 24) / 2)); }
  o.x = x; o.y = y; o.z = z;
  const out = q < 12;
  o.ry = Math.atan2((out ? tg.x - h[0] : h[0] - tg.x), (out ? tg.z - h[2] : h[2] - tg.z));
  o.rx = (q > 2 && q < 10) || (q > 16 && q < 24) ? 0.2 : 0;
}

/* ---------- avions de l'aéroport (repère local : piste selon x à z = −1,3, tarmac à z ≈ −0,4) */
kind('plane', (g) => {
  g.tube(0, 0.1, -0.42, 0, 0.1, 0.4, 0.055, C('#f4f6f8'), { seg: 10 });
  g.cone(0, 0.1, 0.4, 0.055, 0.1, C('#f4f6f8'), { rx: Math.PI / 2, seg: 10 });
  g.box(0, 0.09, 0.02, 0.9, 0.018, 0.16, C('#e3e7ea'));
  g.box(0, 0.1, -0.38, 0.32, 0.012, 0.08, C('#e3e7ea'));
  g.box(0, 0.12, -0.38, 0.014, 0.16, 0.1, C('#2f6fb0'));
  g.tube(-0.2, 0.06, 0.06, -0.2, 0.06, 0.16, 0.025, C('#c9cdd0'), { tint: false, seg: 8 }); g.tube(0.2, 0.06, 0.06, 0.2, 0.06, 0.16, 0.025, C('#c9cdd0'), { tint: false, seg: 8 });
  g.box(0, 0.12, 0.3, 0.07, 0.02, 0.03, C('#2f4256'), { tint: false, layer: 'lit' });
  for (let i = 0; i < 6; i++) { g.box(-0.056, 0.115, -0.25 + i * 0.09, 0.004, 0.012, 0.03, C('#2f4256'), { tint: false, layer: 'lit' }); g.box(0.056, 0.115, -0.25 + i * 0.09, 0.004, 0.012, 0.03, C('#2f4256'), { tint: false, layer: 'lit' }); }
  g.sphere(-0.45, 0.09, 0.02, 0.012, C('#ff3b30'), { layer: 'glow', tint: false, low: true });
  g.sphere(0.45, 0.09, 0.02, 0.012, C('#3dff7a'), { layer: 'glow', tint: false, low: true });
  g.sphere(0, 0.29, -0.42, 0.01, C('#ffffff'), { layer: 'glow', tint: false, low: true });
  g.box(0, 0.0, 0.25, 0.008, 0.05, 0.008, C('#3a3f45'), { tint: false }); g.box(-0.12, 0, -0.02, 0.008, 0.05, 0.008, C('#3a3f45'), { tint: false }); g.box(0.12, 0, -0.02, 0.008, 0.05, 0.008, C('#3a3f45'), { tint: false });
}, (d, t, o) => planePath(d, t, o), { palette: ['#2f6fb0', '#c8463a', '#3f9a5a'] });
function planeKeys(sx) {
  return [
    [0, sx, 0, -0.22], [10, sx, 0, -0.22], [13, sx, 0, -0.95], [18, -1.75, 0, -1.3], [20, -1.75, 0, -1.3],
    [24.5, 0.8, 0, -1.3, 'in'], [27, 2.8, 0.45, -1.3], [33, 14, 4.2, -1.3], [38, 30, 8, -1.3], [50, -30, 8, -1.3, 'hide'],
    [56, -12, 3.4, -1.3], [60, -1.6, 0, -1.3], [63.5, 1.0, 0, -1.3, 'out'], [66, 1.5, 0, -0.95], [70, sx, 0, -0.95], [72, sx, 0, -0.22], [80, sx, 0, -0.22],
  ];
}
function planePath(d, t, o) {
  const K = d._k || (d._k = planeKeys(d.sx || 0));
  const q = frac(t / 80 + (d.ph || 0)) * 80;
  let i = 0;
  while (i < K.length - 2 && K[i + 1][0] <= q) i++;
  const a = K[i], b = K[i + 1];
  if (b[4] === 'hide') { o.hide = true; return; }
  let u = (q - a[0]) / Math.max(1e-6, b[0] - a[0]);
  if (b[4] === 'in') u = u * u; else if (b[4] === 'out') u = 1 - (1 - u) * (1 - u);
  o.x = lerp(a[1], b[1], u); o.y = lerp(a[2], b[2], u); o.z = lerp(a[3], b[3], u);
  // cap : direction du segment en cours, sinon du prochain segment en mouvement
  let j = i, dx = b[1] - a[1], dz = b[3] - a[3], dy = b[2] - a[2];
  while (Math.hypot(dx, dz) < 1e-6 && j < K.length - 2) { j++; dx = K[j + 1][1] - K[j][1]; dz = K[j + 1][3] - K[j][3]; dy = 0; }
  o.ry = Math.atan2(dx, dz);
  o.rx = -Math.atan2(dy, Math.hypot(dx, dz)) * 0.8;
}

/* ---------- bateaux (repère monde) */
kind('barge', (g) => {
  g.box(0, -0.03, 0, 0.2, 0.08, 0.95, C('#3a3f45'), { tint: false });
  g.box(0, 0.05, 0.42, 0.2, 0.012, 0.1, C('#6b6f75'), { tint: false });
  for (let i = 0; i < 6; i++) g.box(0, 0.05, -0.3 + i * 0.11, 0.17, 0.065, 0.1, C('#ffffff'));
  g.box(0, 0.05, -0.43, 0.16, 0.09, 0.07, C('#eef1f3'), { tint: false });
  g.box(0, 0.11, -0.43, 0.14, 0.03, 0.06, C('#2f4256'), { tint: false, layer: 'lit' });
  g.sphere(0, 0.15, -0.43, 0.008, C('#ffffff'), { layer: 'glow', tint: false, low: true });
}, boatUpd, { palette: ['#c8463a', '#2f6fb0', '#e2b13c', '#3f9a5a'] });
kind('tourBoat', (g) => {
  g.box(0, -0.03, 0, 0.16, 0.07, 0.55, C('#f4f6f8'), { tint: false });
  g.box(0, 0.04, -0.02, 0.13, 0.06, 0.4, C('#9fd3ee'), { tint: false, layer: 'lit' });
  g.box(0, 0.1, -0.02, 0.14, 0.01, 0.42, C('#ffffff'));
}, boatUpd, { palette: ['#2f6fb0', '#c8463a', '#3f9a5a'] });
kind('motorBoat', (g) => {
  g.box(0, -0.025, 0, 0.09, 0.05, 0.24, C('#ffffff'), { tint: false });
  g.box(0, -0.025, 0.1, 0.09, 0.05, 0.05, C('#ffffff'));
  g.box(0, 0.025, -0.02, 0.07, 0.035, 0.07, C('#2f4256'), { tint: false, layer: 'lit' });
}, boatUpd, { palette: ['#2f6fb0', '#c8463a', '#e2b13c'] });
kind('sailBoat', (g) => {
  g.box(0, -0.025, 0, 0.09, 0.05, 0.26, C('#ffffff'), { tint: false });
  g.box(0, 0.025, -0.04, 0.06, 0.03, 0.08, C('#d8cdb3'), { tint: false });
  g.box(0, 0.025, 0.03, 0.006, 0.34, 0.006, C('#8e979f'), { tint: false });
  g.box(0, 0.06, -0.03, 0.003, 0.26, 0.12, C('#f4efe2'), { ry: 0.25 });
}, boatUpd, { palette: ['#f4efe2', '#f2d6d0', '#d8e6f2'] });
kind('cargoShip', (g) => {
  g.box(0, -0.06, 0, 0.26, 0.11, 1.55, C('#7a2f2a'), { tint: false });
  g.box(0, 0.03, 0, 0.26, 0.03, 1.55, C('#2d4a63'), { tint: false });
  const cols = ['#c8463a', '#2f6fb0', '#e2b13c', '#3f9a5a', '#d6d9dc', '#8a4f9e'];
  for (let i = 0; i < 9; i++) for (let j = 0; j < 2; j++) g.box(-0.06 + j * 0.12, 0.06, -0.5 + i * 0.12, 0.11, 0.06, 0.11, C(cols[(i * 3 + j * 5) % 6]), { tint: false });
  g.box(0, 0.06, 0.66, 0.22, 0.1, 0.12, C('#eef1f3'), { tint: false });
  g.box(0, 0.12, 0.66, 0.2, 0.025, 0.1, C('#2f4256'), { tint: false, layer: 'lit' });
  g.sphere(0, 0.18, 0.66, 0.01, C('#ffffff'), { layer: 'glow', tint: false, low: true });
}, (d, t, o) => {
  const s = LIFE.ship;
  if (!s.vis) { o.hide = true; return; }
  o.x = s.x; o.z = s.z; o.ry = s.ry; o.y = WATER_Y + 0.008 * Math.sin(t * 1.1);
});
function boatUpd(d, t, o) {
  const p = d.ph || 0;
  if (d.m === 'river') { // couloir d'eau détecté sur la carte, parcouru de bout en bout
    const L = Math.hypot(d.x1 - d.x0, d.z1 - d.z0) || 1, u = frac(t * d.sp / L + p);
    o.x = lerp(d.x0, d.x1, u); o.z = lerp(d.z0, d.z1, u); o.ry = Math.atan2(d.x1 - d.x0, d.z1 - d.z0);
    if (u < 0.03 || u > 0.97) { o.hide = true; return; }
  } else if (d.m === 'dock') { o.x = d.x; o.z = d.z; o.ry = d.ry || 0; }
  else if (d.m === 'flood') { // bateaux de secours pendant la crue
    if (!FX.flood || FX.flood.L < 0.75) { o.hide = true; return; }
    lissa(d, t, o); o.y = 0.14; o.rz = 0.03 * Math.sin(t * 1.3 + p * 5); return;
  }
  else if (d.m === 'loop') {
    pathPrep(d);
    const T = d._L / d.sp, P = T + d.dwell, q = frac(t / P + p) * P;
    if (q < d.dwell) onPath(d, 0, o), (o.ry = d.dockRy ?? o.ry);
    else onPath(d, (q - d.dwell) * d.sp, o);
  }
  o.y = WATER_Y + 0.008 * Math.sin(t * 1.7 + p * 9);
  o.rz = 0.03 * Math.sin(t * 1.3 + p * 5); o.rx = 0.015 * Math.sin(t * 0.9 + p);
}

/* ------------------------------------------------------------------ système */
const LIFE = {
  scene: null, meshes: {}, lists: {}, t: 0,
  train: { P: 50, t0: 0, x: -10, line: null }, station: null, ship: { vis: false, docked: false, x: 0, z: 0, ry: 0 }, port: null,
  targets: [], landfills: [], emitters: [],
  mats: null,
  init(scene) {
    this.scene = scene;
    // nouvelle scène : les objets de la précédente sont abandonnés (pas de réutilisation d'un maillage détaché)
    this.meshes = {}; this.lists = {}; this.landfills = []; this.emitters = []; this.poolMesh = null; this.halo = null; this.station = null; this.port = null;
    this.mats = { anim: animMaterial(), water: animMaterial({ transparent: true, opacity: 0.78, gain: 0.9, self: 0.45 }) };
    this.initParticles(); this.initLights(); this.initTrain();
  },
  /* remplace l'ensemble des objets animés */
  setAnims(list) {
    const by = {};
    for (const a of list) (by[a.kind] ??= []).push(a);
    for (const name of Object.keys(this.lists)) if (!by[name]) { this.lists[name] = []; if (this.meshes[name]) this.meshes[name].count = 0; }
    const col = new THREE.Color();
    for (const [name, arr] of Object.entries(by)) {
      const K = KINDS[name];
      if (!K) { console.warn('genre inconnu', name); continue; }
      if (!K.geo) K.geo = animGeo(K.geoFn);
      let mesh = this.meshes[name];
      if (!mesh || mesh.userData.cap < arr.length) {
        if (mesh) { this.scene.remove(mesh); mesh.dispose(); }
        const cap = Math.ceil(arr.length * 1.4) + 8;
        mesh = new THREE.InstancedMesh(K.geo, this.mats[K.opts.mat || 'anim'], cap);
        mesh.userData.cap = cap; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.meshes[name] = mesh; this.scene.add(mesh);
      }
      mesh.count = arr.length;
      const pal = K.opts.palette;
      arr.forEach((a, i) => {
        a.wx = a.base.elements[12]; a.wz = a.base.elements[14];
        if (a.d.color) col.set(a.d.color); else if (pal) col.set(pal[Math.floor(hf(i, name.length) * pal.length) % pal.length]); else col.set('#ffffff');
        mesh.setColorAt(i, col);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.lists[name] = arr;
    }
  },
  _m: new THREE.Matrix4(), _w: new THREE.Matrix4(), _p: new THREE.Vector3(), _q: new THREE.Quaternion(), _s: new THREE.Vector3(), _e: new THREE.Euler(0, 0, 0, 'YXZ'),
  updateAnims(t, cam) {
    const near = cam && cam.d < 34, R2 = cam ? Math.pow(cam.d * 2.4 + 6, 2) : 0, night = STATE.night;
    for (const [name, arr] of Object.entries(this.lists)) {
      if (!arr.length) continue;
      const K = KINDS[name], mesh = this.meshes[name];
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        if (near && !a.d.far) { const dx = a.wx - cam.tx, dz = a.wz - cam.tz; if (dx * dx + dz * dz > R2) continue; }
        resetO();
        if ((a.d.need && !hasTech(a.d.need)) || (a.act === 'day' && night) || (a.act === 'night' && !night)) O.hide = true; else K.update(a.d, t, O, a);
        if (O.hide) { this._w.makeScale(0, 0, 0); this._w.setPosition(a.wx, -50, a.wz); }
        else {
          this._e.set(O.rx, O.ry, O.rz, 'YXZ'); this._q.setFromEuler(this._e);
          this._m.compose(this._p.set(O.x, O.y, O.z), this._q, this._s.set(O.sx, O.sy, O.sz));
          this._w.multiplyMatrices(a.base, this._m);
        }
        mesh.setMatrixAt(i, this._w);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  },

  /* ---------------- particules : fumées, vapeurs, poussières */
  PT: {
    smoke: { col: '#8a8c90', s0: 0.05, s1: 0.3, life: 4.5, rise: 0.3, rate: 1.1, a: 0.62 },
    smokeDark: { col: '#5b5d61', s0: 0.05, s1: 0.32, life: 4.5, rise: 0.3, rate: 1.2, a: 0.7 },
    smokeLight: { col: '#c3c5c8', s0: 0.06, s1: 0.4, life: 5, rise: 0.35, rate: 1.1, a: 0.55 },
    steam: { col: '#f6f8fa', s0: 0.3, s1: 1.15, life: 6, rise: 0.5, rate: 1.5, a: 0.7 },
    steamS: { col: '#eef1f3', s0: 0.06, s1: 0.32, life: 3.2, rise: 0.38, rate: 1.1, a: 0.5 },
    chimney: { col: '#b0b2b5', s0: 0.02, s1: 0.1, life: 2.8, rise: 0.2, rate: 0.45, a: 0.4 },
    dust: { col: '#cbb994', s0: 0.04, s1: 0.18, life: 2, rise: 0.08, rate: 2.2, a: 0.5, spread: 0.12 },
    foam: { col: '#ffffff', s0: 0.05, s1: 0.18, life: 1.5, rise: 0, rate: 4, a: 0.65, spread: 0.2, flat: true },
    smokeBlack: { col: '#2b2b2e', s0: 0.12, s1: 0.85, life: 6, rise: 0.55, rate: 3.2, a: 0.78, spread: 0.25 },
    gas: { col: '#e9ecef', s0: 0.1, s1: 0.6, life: 4, rise: 0.08, rate: 2.5, a: 0.5, spread: 0.3 },
  },
  initParticles() {
    const cap = 1500;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(geo, particleMaterial(), cap);
    mesh.frustumCulled = false; mesh.count = 0;
    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    alpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAlpha', alpha);
    mesh.setColorAt(0, new THREE.Color('#fff'));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    this.P = { mesh, alpha, cap, n: 0, x: new Float32Array(cap), y: new Float32Array(cap), z: new Float32Array(cap), age: new Float32Array(cap), life: new Float32Array(cap), s0: new Float32Array(cap), s1: new Float32Array(cap), a: new Float32Array(cap), rise: new Float32Array(cap), flat: new Uint8Array(cap), col: [] };
  },
  setEmitters(list) { this.emitters = list; },
  updateParticles(dt) {
    const P = this.P, wx = 0.22, wz = 0.1, col = this._c || (this._c = new THREE.Color());
    for (const e of this.emitters) {
      if (e.need && !e.need()) continue;
      const T = this.PT[e.type];
      e.acc += (T.rate * (e.kf ? e.kf() : e.k ?? 1)) * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        if (P.n >= P.cap) break;
        const i = P.n++, sp = (T.spread || 0.02) * (e.s || 1);
        P.x[i] = e.x + (Math.random() - 0.5) * sp; P.y[i] = e.y; P.z[i] = e.z + (Math.random() - 0.5) * sp;
        P.age[i] = 0; P.life[i] = T.life * (0.8 + Math.random() * 0.4) * (e.l || 1);
        P.s0[i] = T.s0 * (e.s || 1); P.s1[i] = T.s1 * (e.s || 1) * (0.85 + Math.random() * 0.3); P.a[i] = T.a * (e.a || 1); P.rise[i] = T.rise * (e.r || 1); P.flat[i] = T.flat ? 1 : 0;
        col.set(e.col || T.col); P.mesh.setColorAt(i, col);
      }
    }
    const m = this._m, q = this._q.identity(), s = this._s, p = this._p;
    for (let i = 0; i < P.n; i++) {
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) { // retire en échangeant avec la dernière
        const j = --P.n;
        if (i !== j) {
          for (const k of ['x', 'y', 'z', 'age', 'life', 's0', 's1', 'a', 'rise', 'flat']) P[k][i] = P[k][j];
          P.mesh.getColorAt(j, col); P.mesh.setColorAt(i, col);
          i--;
        }
        continue;
      }
      const u = P.age[i] / P.life[i], drift = 0.25 + 0.75 * Math.min(1, P.age[i] / 2);
      P.x[i] += wx * drift * dt; P.z[i] += wz * drift * dt; P.y[i] += P.rise[i] * (1 - 0.5 * u) * dt;
      const sc = P.s0[i] + (P.s1[i] - P.s0[i]) * Math.sqrt(u);
      m.compose(p.set(P.x[i], P.y[i], P.z[i]), q, P.flat[i] ? s.set(sc, sc * 0.25, sc) : s.set(sc, sc, sc));
      P.mesh.setMatrixAt(i, m);
      P.alpha.array[i] = P.a[i] * Math.min(1, P.age[i] / 0.35) * Math.pow(1 - u, 1.2);
    }
    P.mesh.count = P.n;
    P.mesh.instanceMatrix.needsUpdate = true; P.alpha.needsUpdate = true;
    if (P.mesh.instanceColor) P.mesh.instanceColor.needsUpdate = true;
  },

  /* ---------------- éclairage nocturne : halos des lampadaires et flaques de lumière au sol */
  initLights() {
    this.poolTex = radialTexture([[0, 0.85], [0.4, 0.45], [1, 0]]);
    this.haloTex = radialTexture([[0, 1], [0.2, 0.8], [0.5, 0.18], [1, 0]]);
  },
  setLights(lamps, pools) {
    if (this.poolMesh) { this.scene.remove(this.poolMesh); this.poolMesh.dispose(); }
    if (this.halo) { this.scene.remove(this.halo); this.halo.geometry.dispose(); }
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: this.poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -4 });
    const n = pools.length;
    const pm = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    const m = new THREE.Matrix4(), c = new THREE.Color();
    pools.forEach((p, i) => { m.makeScale(p.r * 2, 1, p.r * 2).setPosition(p.x, p.y, p.z); pm.setMatrixAt(i, m); pm.setColorAt(i, c.set(p.col)); });
    pm.count = n; pm.frustumCulled = false; pm.renderOrder = 2; pm.visible = STATE.night;
    this.poolMesh = pm; this.scene.add(pm);
    const pos = new Float32Array(lamps.length * 3), cols = new Float32Array(lamps.length * 3);
    lamps.forEach((l, i) => { pos.set([l.x, l.y, l.z], i * 3); c.set(l.col); cols.set([c.r, c.g, c.b], i * 3); });
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); hg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.halo = new THREE.Points(hg, new THREE.PointsMaterial({ size: 0.55, map: this.haloTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this.halo.visible = STATE.night; this.halo.frustumCulled = false; this.halo.renderOrder = 3;
    this.scene.add(this.halo);
  },
  setNight(n) { if (this.poolMesh) this.poolMesh.visible = n; if (this.halo) this.halo.visible = n; },

  /* ---------------- train régional et voyageurs */
  initTrain() {
    const a = new Acc(true), g = new Ctx([]);
    g.frameSingle(a);
    for (let k = 0; k < 5; k++) {
      const x = -k * 0.72;
      g.box(x, 0.07, 0, 0.68, 0.2, 0.26, C(k === 0 ? '#c8463a' : '#e8ecef'), { tint: false });
      g.box(x, 0.17, 0, 0.66, 0.06, 0.265, C('#3b4b5c'), { tint: false, layer: 'lit' });
      g.box(x, 0.27, 0, 0.66, 0.02, 0.22, C('#9aa3ab'), { tint: false });
      g.box(x + 0.1, 0.08, 0.131, 0.08, 0.15, 0.004, C('#5a6570'), { tint: false });
    }
    g.box(0.36, 0.07, 0, 0.08, 0.16, 0.24, C('#c8463a'), { tint: false });
    g.box(0.405, 0.12, -0.08, 0.01, 0.025, 0.04, C('#fff6d8'), { layer: 'glow', tint: false }); g.box(0.405, 0.12, 0.08, 0.01, 0.025, 0.04, C('#fff6d8'), { layer: 'glow', tint: false });
    this.trainMesh = new THREE.Mesh(a.geometry(), this.mats.anim);
    this.scene.add(this.trainMesh);
  },
  /** Ligne du train : voies alignées devant la gare, dans l'axe du quai. */
  setTrainLine(st, map) {
    const tr = this.train;
    tr.line = null;
    if (!st) { this.trainMesh.visible = false; return; }
    const rp = new THREE.Vector3(0, 0, st.railLocal).applyMatrix4(st.base), ax = new THREE.Vector3(1, 0, 0).transformDirection(st.base);
    const rx = Math.round(ax.x), rz = Math.round(ax.z);
    const tx = Math.floor(rp.x), tz = Math.floor(rp.z);
    if (!map.inside(tx, tz) || !map.rail[map.idx(tx, tz)]) { this.trainMesh.visible = false; return; }
    const walk = (s) => { let k = 0; while (k < 300) { const x = tx + rx * s * (k + 1), z = tz + rz * s * (k + 1); if (!map.inside(x, z) || !map.rail[map.idx(x, z)]) break; k++; } return k; };
    const a = walk(-1), b = walk(1);
    const ox = rx ? rp.x : tx + 0.5, oz = rz ? rp.z : tz + 0.5;
    const alongStart = rx ? (tx - a) - ox : (tz - a) - oz, alongEnd = rx ? (tx + b + 1) - ox : (tz + b + 1) - oz;
    tr.line = { ox, oz, ax: rx, az: rz, s0: alongStart * (rx || rz), s1: alongEnd * (rx || rz), stop: st.stopL, y: map.alt[map.idx(tx, tz)] * LEVEL_H };
    if ((rx || rz) < 0) { const s = tr.line.s0; tr.line.s0 = -tr.line.s1; tr.line.s1 = -s; }
    this.trainMesh.rotation.set(0, Math.atan2(-rz, rx), 0);
  },
  updateTrain(t) {
    const tr = this.train, L = tr.line;
    if (!L) { this.trainMesh.visible = false; return; }
    const P = tr.P, u = frac((t - tr.t0) / P), a0 = L.s0 - 4, a1 = L.s1 + 4;
    let s;
    if (u < 0.35) s = a0 + (L.stop - a0) * (1 - Math.pow(1 - u / 0.35, 2));
    else if (u < 0.5) s = L.stop;
    else s = L.stop + (a1 - L.stop) * Math.pow((u - 0.5) / 0.5, 1.6);
    tr.x = s;
    this.trainMesh.visible = s > L.s0 + 0.4 && s - 3.6 < L.s1 - 0.2;
    this.trainMesh.position.set(L.ox + L.ax * s, L.y, L.oz + L.az * s);
  },

  /* ---------------- porte-conteneurs : arrivée par l'eau, accostage, départ */
  updateShip(t, dt) {
    const s = this.ship, pt = this.port;
    if (!pt) { s.vis = false; s.docked = false; return; }
    const P = 100, q = frac((t - (this.shipT0 || 0)) / P + 0.15) * P;
    const px = -pt.wz, pz = pt.wx, far = pt.reach;
    const pts = [[pt.bx + pt.wx * far, pt.bz + pt.wz * far], [pt.bx + pt.wx * 3.4, pt.bz + pt.wz * 3.4], [pt.bx + pt.wx * 1.2 + px * 0.35, pt.bz + pt.wz * 1.2 + pz * 0.35], [pt.bx, pt.bz]];
    const at = (u) => { // le long de la polyligne, u ∈ [0,1]
      const segs = []; let L = 0;
      for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); segs.push(l); L += l; }
      let r = u * L, i = 0;
      while (i < segs.length - 1 && r > segs[i]) { r -= segs[i]; i++; }
      const k = Math.min(1, r / (segs[i] || 1));
      return [lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)];
    };
    let u, dir = 1;
    s.vis = true; s.docked = false;
    if (q < 26) u = 1 - Math.pow(1 - q / 26, 2);
    else if (q < 62) { u = 1; s.docked = true; }
    else if (q < 88) { u = 1 - Math.pow((q - 62) / 26, 2); dir = -1; }
    else { s.vis = false; return; }
    const p = at(u), p2 = at(Math.max(0, Math.min(1, u - 0.01)));
    s.x = p[0]; s.z = p[1];
    let target = Math.atan2(p[0] - p2[0], p[1] - p2[1]);
    if (s.docked || u > 0.995) target = Math.atan2(px, pz);
    if (dir < 0) target += Math.PI;
    if (!isFinite(target) || (Math.abs(p[0] - p2[0]) + Math.abs(p[1] - p2[1]) < 1e-5)) target = s.ry;
    let da = target - s.ry; da = Math.atan2(Math.sin(da), Math.cos(da));
    s.ry += da * Math.min(1, dt * 0.8);
  },

  /* ---------------- décharge : dôme arrondi qui grossit avec le volume stocké */
  setLandfills(list) {
    for (const lf of this.landfills) { this.scene.remove(lf.mesh); lf.mesh.geometry.dispose(); this.scene.remove(lf.debris); }
    this.landfills = list;
    for (const lf of list) this.buildLandfill(lf);
  },
  buildLandfill(lf) {
    const N = 30, geo = new THREE.PlaneGeometry(lf.W - 0.34, lf.D - 0.34, N, N).rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    lf.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    lf.mesh.matrixAutoUpdate = false; lf.mesh.matrix.copy(lf.base); lf.mesh.receiveShadow = true;
    this.scene.add(lf.mesh);
    const dg = animGeo((g) => g.box(0, 0, 0, 1, 1, 1, C('#ffffff')));
    lf.debris = new THREE.InstancedMesh(dg, this.mats.anim, 90);
    lf.debris.frustumCulled = false; this.scene.add(lf.debris);
    const pal = ['#e8e8e8', '#5f88b8', '#c8463a', '#e2b13c', '#7d7f84', '#a58b68', '#3f9a5a', '#d9d4c7'], c = new THREE.Color();
    for (let i = 0; i < 90; i++) lf.debris.setColorAt(i, c.set(pal[i % pal.length]));
    lf.heightAt = (x, z) => this.lfHeight(lf, x, z);
    lf.built = -1;
    this.refreshLandfill(lf);
  },
  lfShape(lf) {
    const f = lf.b.fill ?? 0.35, ext = hasUp(lf.b, 'landfill_extension');
    const cap = ext ? 1.8 : 1;           // l'extension double presque la capacité : à volume égal, le dôme est plus bas
    const v = f / cap;
    const hx = (lf.W - 0.4) / 2, hz = (lf.D - 0.4) / 2;
    if (!ext) return [{ cx: 0, cz: -0.05, ax: hx * (0.55 + 0.45 * Math.min(1, v * 1.3)), az: hz * (0.5 + 0.45 * Math.min(1, v * 1.3)), h: 0.12 + 1.15 * v }];
    return [
      { cx: -hx * 0.35, cz: -0.05, ax: hx * (0.42 + 0.25 * v), az: hz * (0.6 + 0.35 * v), h: 0.12 + 1.6 * Math.min(1, v * 1.4) * 0.6 },
      { cx: hx * 0.4, cz: 0.05, ax: hx * (0.4 + 0.2 * v), az: hz * (0.55 + 0.35 * v), h: 0.08 + 1.4 * Math.max(0, v * 1.4 - 0.3) * 0.6 },
    ];
  },
  lfHeight(lf, x, z) {
    let h = 0;
    for (const b of lf.shape || this.lfShape(lf)) {
      const u = Math.abs(x - b.cx) / b.ax, w = Math.abs(z - b.cz) / b.az;
      const r = Math.pow(Math.pow(u, 3) + Math.pow(w, 3), 1 / 3);
      if (r < 1) h = Math.max(h, b.h * Math.pow(smooth((1 - r) / 0.75), 0.85));
    }
    return h;
  },
  refreshLandfill(lf) {
    const f = lf.b.fill ?? 0.35;
    if (Math.abs(f - lf.built) < 0.004 && lf.builtExt === hasUp(lf.b, 'landfill_extension')) return;
    lf.built = f; lf.builtExt = hasUp(lf.b, 'landfill_extension');
    lf.shape = this.lfShape(lf);
    const pos = lf.mesh.geometry.attributes.position, col = lf.mesh.geometry.attributes.color, c = new THREE.Color();
    const soil = new THREE.Color('#8a7656'), cap = new THREE.Color('#7f9a55'), trashPal = ['#d9d4c7', '#5f88b8', '#c8463a', '#e2b13c', '#7d7f84', '#a58b68', '#e8e8e8', '#4f9a43', '#2f3439'].map((h) => new THREE.Color(h));
    const capAng = -Math.PI + f * Math.PI * 1.25, activeAng = capAng + 0.9;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = this.lfHeight(lf, x, z);
      pos.setY(i, 0.035 + h);
      const a = Math.atan2(z, x), r = hf(i, 3);
      if (h < 0.02) c.copy(soil).multiplyScalar(0.85 + r * 0.2);
      else if (a < capAng) c.copy(cap).multiplyScalar(0.85 + r * 0.25);                                    // alvéoles fermées et végétalisées
      else if (Math.abs(a - activeAng) < 0.9) c.copy(trashPal[Math.floor(r * trashPal.length)]).lerp(soil, 0.25); // front de déchargement : déchets visibles
      else c.copy(soil).lerp(trashPal[Math.floor(hf(i, 5) * 9)], 0.35 * r);                                  // couverture quotidienne de terre
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true; col.needsUpdate = true; lf.mesh.geometry.computeVertexNormals();
    // débris dispersés sur le front actif
    const m = new THREE.Matrix4(), w = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const R = Math.min(lf.W, lf.D) * 0.32;
    for (let i = 0; i < 90; i++) {
      const ang = activeAng + (hf(i, 7) - 0.5) * 1.5, rr = R * (0.15 + 0.85 * Math.sqrt(hf(i, 8)));
      const x = Math.cos(ang) * rr, z = Math.sin(ang) * rr, h = this.lfHeight(lf, x, z);
      const s = 0.025 + hf(i, 9) * 0.04;
      e.set(hf(i, 10) * 3, hf(i, 11) * 3, 0); q.setFromEuler(e);
      m.compose(this._p.set(x, 0.035 + h, z), q, this._s.set(s, s * 0.6, s * 1.2));
      if (h < 0.03 || f < 0.05) m.makeScale(0, 0, 0);
      w.multiplyMatrices(lf.base, m); lf.debris.setMatrixAt(i, w);
    }
    lf.debris.instanceMatrix.needsUpdate = true; if (lf.debris.instanceColor) lf.debris.instanceColor.needsUpdate = true;
    lf.activeAng = activeAng;
  },
  updateLandfills(dt) {
    for (const lf of this.landfills) {
      const b = lf.b;
      if (b.fillAuto !== false) b.fill = Math.min(1, (b.fill ?? 0.3) + dt / (hasUp(b, 'waste_trucks') ? 180 : 260));
      this.refreshLandfill(lf);
    }
  },

  update(dt, t, cam) {
    this.t = t;
    this.updateTrain(t); this.updateShip(t, dt);
    if (!STATE.anim) return;
    this.updateLandfills(dt);
    this.updateAnims(t, cam);
    this.updateParticles(dt);
  },
};



/* ---------- 4. modèles des bâtiments ---------- */
const HS = 1 / 22; // hauteur du catalogue (pixels isométriques) → unités 3D (1 = une case)
const K = {
  WIN: '#4d6680', GLASS: '#5a83a6', CONC: '#cfcac0', DARK: '#363b42', STEEL: '#8e979f', WHITE: '#eef1f3',
  LAWN: '#86bd62', GRASS: '#79b25a', WATER: '#3f8fbf', ASPH: '#55595f', WOOD: '#9b7148', BRICK: '#a65a43',
  RED: '#c8463a', GLOW: '#62e6f7', PAVE: '#cdc6b6', GRAVEL: '#aaa294', SAND: '#e3d29b', YELLOW: '#e2b13c',
  ORANGE: '#e48a2c', GREEN: '#4f9a43', TRUNK: '#7a5636', SOLAR: '#24365e', BLUE: '#2f6fc0',
};
const PLOT = {
  residential_low: K.LAWN, residential_high: '#bdb7a8', commerce: '#c9c3b5', offices: '#c6c3bd', industry: K.GRAVEL,
  energy: '#a9aba3', water: '#b7b9ae', waste: '#a39f8c', services: '#c8c2b2', parks: K.GRASS, logistics: '#a6a49d', transport: '#bdb8ad',
};

/* ---------- aides de modélisation ---------- */
const lay = (g) => (g.rnd() < 0.62 ? 'lit' : 'dark');
function pad(g, W, D, col) { g.box(0, 0, 0, W - 0.04, 0.03, D - 0.04, C(col)); }
function bands(g, x, z, w, d, y0, y1, glass, col) {
  const pitch = 0.26, th = glass ? 0.16 : 0.07;
  for (let y = y0 + 0.12; y + th < y1 - 0.04; y += pitch) g.box(x, y, z, w + 0.024, th, d + 0.024, C(col || (glass ? K.GLASS : K.WIN)), { layer: lay(g) });
}
function frontWins(g, x, z, w, d, y, n, h = 0.1) {
  for (let i = 0; i < n; i++) g.box(x - w / 2 + (i + 0.5) * (w / n), y, z + d / 2, Math.min(0.12, (w / n) * 0.55), h, 0.02, C(K.WIN), { layer: lay(g) });
}
function door(g, x, z, col = K.DARK, w = 0.11, h = 0.17) { g.box(x, 0.02, z, w, h, 0.025, C(col)); }
function roofOf(g, v, x, z, w, d, y, kind, rh) {
  const rc = C(v.roofColor);
  switch (kind) {
    case 'gable': g.gable(x, y, z, w * 1.12, Math.min(rh || 0.42, Math.min(w, d) * 0.48), d * 1.12, rc); break;
    case 'green':
      g.box(x, y, z, w + 0.03, 0.05, d + 0.03, rc);
      for (let i = 0; i < 3; i++) g.sphere(x + (g.rnd() - 0.5) * w * 0.6, y + 0.07, z + (g.rnd() - 0.5) * d * 0.6, 0.06 + g.rnd() * 0.04, C(K.GREEN), { low: true });
      break;
    case 'saw': {
      const n = Math.max(2, Math.round(d / 0.26));
      for (let i = 0; i < n; i++) g.shed(x, y, z - d / 2 + (i + 0.5) * (d / n), w, rh || 0.16, d / n, rc);
      break;
    }
    default:
      g.box(x, y, z, w + 0.03, 0.045, d + 0.03, rc);
      if (w > 0.35) g.box(x + w * 0.18, y + 0.04, z - d * 0.15, w * 0.22, 0.07, d * 0.2, C(K.STEEL));
  }
}
function blk(g, v, x, z, w, d, h, o = {}) {
  const kind = o.roof || v.roof;
  const wallH = kind === 'gable' ? h * 0.66 : kind === 'saw' ? h * 0.72 : h;
  g.box(x, o.y || 0, z, w, wallH - (o.y || 0), d, C(o.color || v.color));
  if (o.win !== false) bands(g, x, z, w, d, o.y || 0, wallH, o.glass, o.winCol);
  roofOf(g, v, x, z, w, d, wallH, kind, kind === 'gable' ? h - wallH : kind === 'saw' ? h - wallH : 0);
  return wallH;
}
function car(g, x, z, ry, col) {
  g.box(x, 0.03, z, 0.13, 0.055, 0.26, C(col), { ry });
  g.box(x, 0.085, z, 0.11, 0.045, 0.14, C(K.DARK), { ry });
}
function truck(g, x, z, ry, col, len = 0.42) {
  g.box(x, 0.03, z, 0.15, 0.17, len, C(col), { ry });
  const fx = Math.sin(ry) * (len / 2 + 0.06), fz = Math.cos(ry) * (len / 2 + 0.06);
  g.box(x + fx, 0.03, z + fz, 0.15, 0.13, 0.12, C(K.WHITE), { ry });
}
function parking(g, x, z, w, d, n, ry = 0) {
  g.box(x, 0.03, z, w, 0.012, d, C(K.ASPH));
  const cols = ['#c8463a', '#3f6fb0', '#e6e8ea', '#2d3136', '#d7b23c', '#6c7a86'];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const px = ry ? x : x - w / 2 + t * w, pz = ry ? z - d / 2 + t * d : z;
    if (g.rnd() < 0.75) car(g, px, pz, ry ? Math.PI / 2 : 0, cols[(g.rnd() * cols.length) | 0]);
  }
}
function trees(g, n, x0, z0, x1, z1, s = 1, kind = 0) {
  for (let i = 0; i < n; i++) g.tree(x0 + g.rnd() * (x1 - x0), z0 + g.rnd() * (z1 - z0), s * (0.75 + g.rnd() * 0.5), kind);
}
function fence(g, w, d, h = 0.08, col = '#8a8f95') {
  g.box(0, 0.03, -d / 2 + 0.03, w - 0.06, h, 0.015, C(col)); g.box(0, 0.03, d / 2 - 0.03, w - 0.06, h, 0.015, C(col));
  g.box(-w / 2 + 0.03, 0.03, 0, 0.015, h, d - 0.06, C(col)); g.box(w / 2 - 0.03, 0.03, 0, 0.015, h, d - 0.06, C(col));
}
/* cheminée qui fume (et balise rouge si elle est haute) */
function chimney(g, x, z, r, h, o = {}) {
  g.cyl(x, 0, z, r, h, C(o.col || K.BRICK), { k: 0.82 });
  if (o.band) g.cyl(x, h * 0.86, z, r * 0.86, h * 0.07, C(o.band), { k: 0.97 });
  if (o.smoke !== false) g.emit(o.smoke || 'smoke', x, h + 0.02, z, { k: o.k ?? 1, s: o.s ?? r / 0.07 });
  if (h > 1.6) g.anim('beacon', x, h + 0.04, z, { ph: g.rnd() });
}
function stack(g, x, z, r, h, o = {}) { chimney(g, x, z, r, h, Object.assign({ col: '#d9d6cf', band: K.RED, smoke: 'smokeLight' }, o)); }
function glowRing(g, x, y, z, R, col = K.GLOW, t = 0.06) { g.torus(x, y, z, R, t, C(col), { layer: 'glow' }); }
function lattice(g, x, z, base, top, h, col) {
  const ang = Math.atan((base - top) / 2 / h);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    g.box(x + sx * (base + top) / 4, 0, z + sz * (base + top) / 4, 0.03, h / Math.cos(ang), 0.03, C(col), { rx: sz * ang, rz: -sx * ang });
  }
  for (let i = 1; i < 4; i++) {
    const y = (h * i) / 4, s = base + (top - base) * (i / 4);
    g.box(x, y, z + s / 2, s, 0.02, 0.02, C(col)); g.box(x, y, z - s / 2, s, 0.02, 0.02, C(col));
    g.box(x + s / 2, y, z, 0.02, 0.02, s, C(col)); g.box(x - s / 2, y, z, 0.02, 0.02, s, C(col));
  }
}
function house(g, v, x, z, w, d, H, o = {}) {
  const roof = o.roof || v.roof;
  const wh = blk(g, v, x, z, w, d, H, { win: false, roof, color: o.color });
  frontWins(g, x, z, w, d, wh * 0.5, Math.max(1, Math.round(w / 0.22)));
  door(g, x + w * 0.22, z + d / 2);
  if (roof === 'gable' && o.chimney !== false) {
    const ch = H - wh + 0.05;
    g.box(x - w * 0.25, wh, z - d * 0.15, 0.06, ch, 0.06, C(K.BRICK));
    if (g.rnd() < 0.3) g.emit('chimney', x - w * 0.25, wh + ch + 0.01, z - d * 0.15, { k: 0.6, s: 0.8 });
  }
  return wh;
}
function shopFront(g, v, x, z, w, d, h, o = {}) {
  g.box(x, 0.03, z + d / 2 + 0.005, w * 0.86, 0.17, 0.02, C(K.GLASS), { layer: 'lit' });
  g.box(x, Math.min(h * 0.55, 0.26), z + d / 2 + 0.07, w * 0.95, 0.025, 0.15, C(v.roofColor), { rx: 0.25 });
  g.box(x, h + 0.02, z + d / 2 - 0.03, w * 0.6, 0.09, 0.025, C(o.sign || v.roofColor), { layer: 'glow' });
  g.pool(x, z + d / 2 + 0.15, 0.32, '#ffe2b0');
}
function umbrella(g, x, z, col) { g.box(x, 0.03, z, 0.012, 0.16, 0.012, C(K.DARK)); g.cone(x, 0.16, z, 0.08, 0.05, C(col), { seg: 8 }); }
function panelRows(g, x, z, w, d, rows, y = 0.03, tilt = 0.45, col = K.SOLAR) {
  for (let i = 0; i < rows; i++) {
    const pz = z - d / 2 + (i + 0.5) * (d / rows);
    g.box(x, y + 0.04, pz, w, 0.02, (d / rows) * 0.7, C(col), { rx: -tilt });
    g.box(x, y, pz, w * 0.96, 0.06, 0.015, C(K.STEEL));
  }
}
function containerStack(g, x, z, nx, nz, nh, ry = 0) {
  const cols = ['#c8463a', '#2f6fb0', '#e2b13c', '#3f9a5a', '#d6d9dc', '#8a4f9e'];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const hh = 1 + ((g.rnd() * nh) | 0);
    for (let k = 0; k < hh; k++) g.box(x + (i - (nx - 1) / 2) * 0.32, 0.03 + k * 0.12, z + (j - (nz - 1) / 2) * 0.14, 0.3, 0.115, 0.12, C(cols[(g.rnd() * cols.length) | 0]), { ry });
  }
}
function towerGlass(g, v, x, z, w, d, h, o = {}) {
  g.box(x, 0, z, w, h, d, C(o.color || v.color));
  bands(g, x, z, w, d, 0, h, true, o.winCol);
  g.box(x, h, z, w + 0.03, 0.06, d + 0.03, C(v.roofColor));
  if (o.crown) { g.box(x, h + 0.06, z, w * 0.6, 0.18, d * 0.6, C(v.roofColor)); g.cyl(x, h + 0.24, z, 0.015, o.crown, C(K.STEEL)); g.anim('beacon', x, h + 0.25 + o.crown, z, { ph: g.rnd() }); }
  else if (h > 2.5) g.anim('beacon', x + w * 0.35, h + 0.08, z + d * 0.35, { ph: g.rnd() });
}
/* personnes et animaux */
function walkers(g, n, path, o = {}) {
  for (let i = 0; i < n; i++) g.anim('person', 0, o.y || 0, 0, { m: 'path', path, sp: (o.sp || 0.09) * (0.8 + g.rnd() * 0.4), ph: i / n + g.rnd() * 0.1, seed: g.rnd() * 9, s: o.s, color: o.color });
}
function loopPath(x0, z0, x1, z1) { return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; }
function crowd(g, n, cx, cz, rx, rz, o = {}) {
  for (let i = 0; i < n; i++) g.anim(o.kind || 'person', 0, o.y || 0, 0, { m: o.m || 'wander', cx, cz, rx, rz, sp: (o.sp || 0.25) * (0.7 + g.rnd() * 0.6), seed: g.rnd() * 50, stop: o.stop, s: o.s, color: o.color, act: o.act });
}
function standing(g, pts, o = {}) { for (const [x, z, ry] of pts) g.anim('person', 0, o.y || 0, 0, { m: 'sway', x, z, ry: ry ?? 0, seed: g.rnd() * 9, s: o.s, color: o.color, act: o.act }); }
/* fontaine : bassin + jets animés selon un motif */
function fountain(g, x, z, R, pattern = 'wave', o = {}) {
  g.cyl(x, 0.03, z, R, 0.06, C('#bdb3a0'), { seg: 18 }); g.cyl(x, 0.04, z, R * 0.86, 0.055, C('#3f9ccc'), { seg: 18, layer: 'litc' });
  const H = o.h || 0.22, y = 0.095;
  if (pattern === 'wave' || pattern === 'arc') {
    const n = o.n || 6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * R * 0.6, pz = z + Math.sin(a) * R * 0.6;
      g.anim('jet', px, y, pz, { pattern, k, n, h: H * 0.7, ph: k * 0.4, tilt: 0.5 }, Math.atan2(x - px, z - pz));
    }
    g.anim('jet', x, y, z, { pattern: 'pulse', h: H * 1.3, ph: g.rnd() * 6 });
  } else if (pattern === 'dance') {
    for (let k = 0; k < 6; k++) g.anim('jet', x + ((k % 3) - 1) * R * 0.45, y, z + (k < 3 ? -1 : 1) * R * 0.3, { pattern: 'dance', k, h: H, ph: g.rnd() * 3 });
  } else if (pattern === 'tiers') {
    g.cyl(x, 0.03, z, 0.035, 0.16, C('#cfc5b0'), { seg: 8 }); g.cyl(x, 0.19, z, R * 0.5, 0.025, C('#cfc5b0'), { seg: 14 });
    g.anim('jet', x, 0.215, z, { pattern: 'pulse', h: H * 0.6, ph: 1 });
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; g.anim('jet', x + Math.cos(a) * R * 0.45, 0.2, z + Math.sin(a) * R * 0.45, { pattern: 'arc', h: 0.12, tilt: -1.2, ph: k }, Math.atan2(Math.cos(a), Math.sin(a))); }
  } else {
    g.anim('jet', x, y, z, { pattern: pattern === 'bubble' ? 'bubble' : 'pulse', h: pattern === 'bubble' ? 0.06 : H * 1.6, w: pattern === 'bubble' ? 2.5 : 1, ph: g.rnd() * 6 });
  }
  g.anim('splash', x, y, z, { r: R * 0.32, ph: g.rnd() * 3 });
  g.pool(x, z, R * 1.6, '#bfe8ff');
}
const H_OF = (v) => Math.max(0.1, v.height * HS);

/* ---------- modèles par identifiant ---------- */
const BY_ID = {
  /* Résidentiel */
  res_low_1(g, v, W, D, H) {
    pad(g, W, D, K.LAWN);
    house(g, v, 0, -0.1, 0.56, 0.44, H + 0.12);
    g.box(0.24, 0.03, 0.31, 0.07, 0.012, 0.3, C(K.PAVE));
    g.box(0, 0.03, -0.44, W - 0.12, 0.06, 0.05, C('#5f8f45'));
    g.tree(-0.3, 0.3, 0.8, g.rnd() < 0.5 ? 0 : 3);
  },
  res_low_2(g, v, W, D, H) {
    pad(g, W, D, K.LAWN);
    g.box(0, 0, -0.08, 0.58, H * 0.55, 0.5, C(v.color));
    g.box(-0.08, H * 0.55, -0.12, 0.44, H * 0.4, 0.4, C(v.color));
    g.box(0, 0.06, 0.17, 0.4, 0.2, 0.02, C(K.GLASS), { layer: 'lit' });
    frontWins(g, -0.08, -0.12, 0.44, 0.4, H * 0.68, 2);
    g.box(-0.08, H * 0.95, -0.12, 0.47, 0.035, 0.43, C(v.roofColor));
    for (const px of [-0.2, 0.04]) g.box(px, H * 0.97, -0.12, 0.2, 0.015, 0.3, C(K.SOLAR), { rx: -0.35 });
    car(g, 0.32, 0.3, 0, '#3f6fb0');
  },
  res_low_3(g, v, W, D, H) {
    pad(g, W, D, K.LAWN);
    g.box(-0.08, 0, -0.18, 0.66, H * 0.7, 0.34, C(v.color));
    g.box(0.18, 0, 0.02, 0.26, H * 0.45, 0.34, C(v.color));
    g.box(-0.08, H * 0.7, -0.18, 0.7, 0.035, 0.38, C(v.roofColor));
    g.box(0.18, H * 0.45, 0.02, 0.3, 0.035, 0.38, C(v.roofColor));
    g.box(-0.08, 0.06, 0.0, 0.5, 0.22, 0.02, C(K.GLASS), { layer: 'lit' });
    g.box(-0.2, 0.03, 0.3, 0.37, 0.02, 0.21, C(K.WHITE));
    g.box(-0.2, 0.03, 0.3, 0.32, 0.03, 0.16, C('#5cc6e6'), { layer: 'litc' });
    if (g.rnd() < 0.5) g.anim('person', 0, 0.035, 0, { m: 'wander', cx: -0.2, cz: 0.3, rx: 0.1, rz: 0.04, sp: 0.15, seed: g.rnd() * 9, color: '#e3b48f' });
    g.tree(0.36, 0.35, 0.7, 2);
  },
  res_low_4(g, v, W, D, H) {
    pad(g, W, D, K.LAWN);
    const wh = blk(g, v, 0, -0.06, 0.6, 0.48, H * 0.75, { win: false, color: '#b98b5c' });
    frontWins(g, 0, -0.06, 0.6, 0.48, wh * 0.45, 3);
    door(g, 0.18, 0.18);
    for (const px of [-0.25, 0, 0.25]) g.box(px, 0.03, 0.32, 0.03, 0.24, 0.03, C(K.WOOD));
    g.box(0, 0.27, 0.32, 0.6, 0.025, 0.16, C(K.WOOD));
    g.tree(-0.32, -0.36, 0.7, 3); g.tree(0.36, 0.38, 0.6, 0);
  },
  res_low_5(g, v, W, D, H) {
    pad(g, W, D, '#9cc8a0');
    const m = [[-0.1, 0, -0.08, 0.56, 0.44], [0.08, 1, -0.12, 0.5, 0.42], [-0.05, 2, -0.05, 0.42, 0.36]];
    const lh = H / 3;
    for (const [x, k, z, w, d] of m) {
      g.box(x, k * lh, z, w, lh - 0.02, d, C(v.color));
      g.box(x, k * lh + 0.05, z + d / 2, w * 0.85, lh * 0.55, 0.02, C(K.GLASS), { layer: 'lit' });
      g.box(x, k * lh + lh - 0.03, z, w + 0.02, 0.02, d + 0.02, C(v.roofColor), { layer: 'glow' });
    }
    g.box(-0.05, H, -0.05, 0.3, 0.015, 0.25, C(K.SOLAR), { rx: -0.3 });
  },
  res_low_2x1_1(g, v, W, D, H) {
    pad(g, W, D, K.LAWN);
    const n = Math.round(Math.max(W, D)), along = W >= D;
    for (let i = 0; i < n; i++) {
      const t = -Math.max(W, D) / 2 + (i + 0.5);
      const x = along ? t : 0, z = along ? -0.1 : t;
      house(g, v, x, z, along ? 0.92 : 0.6, along ? 0.48 : 0.88, H + 0.12, { color: i % 2 ? '#e9d6b4' : v.color });
    }
    trees(g, 2, -W / 2 + 0.2, D / 2 - 0.25, W / 2 - 0.2, D / 2 - 0.15, 0.7);
  },
  res_low_2x1_2(g, v, W, D, H) {
    pad(g, W, D, K.LAWN);
    const L = Math.max(W, D), along = W >= D, n = 3;
    const cols = [v.color, '#e6dccb', '#dfe5ea'];
    for (let i = 0; i < n; i++) {
      const t = -L / 2 + 0.12 + (i + 0.5) * ((L - 0.24) / n);
      const x = along ? t : 0, z = along ? -0.08 : t;
      const w = along ? (L - 0.24) / n - 0.02 : 0.55, d = along ? 0.55 : (L - 0.24) / n - 0.02;
      const wh = blk(g, v, x, z, w, d, H + 0.25, { win: false, color: cols[i] });
      frontWins(g, x, z, w, d, wh * 0.35, 2); frontWins(g, x, z, w, d, wh * 0.7, 2);
      door(g, x, z + d / 2);
    }
  },
  res_high_1(g, v, W, D, H) {
    pad(g, W, D, PLOT.residential_high);
    blk(g, v, 0, -0.04, 0.78, 0.68, H);
    door(g, 0, 0.3, K.DARK, 0.16, 0.2);
    g.box(0, 0.24, 0.36, 0.3, 0.025, 0.12, C(v.roofColor));
    g.tree(-0.36, 0.38, 0.6);
  },
  res_high_2(g, v, W, D, H) {
    pad(g, W, D, PLOT.residential_high);
    blk(g, v, 0, 0, 0.8, 0.76, H - 0.25, { roof: 'flat' });
    blk(g, v, -0.06, -0.06, 0.6, 0.56, H, { y: H - 0.25 });
    door(g, 0, 0.38, K.DARK, 0.16, 0.2);
  },
  res_high_3(g, v, W, D, H) {
    pad(g, W, D, PLOT.residential_high);
    g.box(0, 0, 0, 0.88, 0.36, 0.86, C('#bfc8d0'));
    g.box(0, 0.03, 0.43, 0.8, 0.22, 0.02, C(K.GLASS), { layer: 'lit' });
    towerGlass(g, v, 0, -0.04, 0.6, 0.6, H, { crown: 0.25 });
  },
  res_high_4(g, v, W, D, H) {
    pad(g, W, D, '#a9c79a');
    g.box(0, 0, 0, 0.62, H, 0.62, C(v.color));
    bands(g, 0, 0, 0.62, 0.62, 0, H, false);
    for (let y = 0.5, k = 0; y < H - 0.2; y += 0.78, k++) {
      const s = k % 2 ? 1 : -1;
      g.box(0.08 * s, y, 0.08 * s, 0.7, 0.07, 0.7, C(v.roofColor));
      g.tree(0.3 * s, 0.3 * s, 0.45, 0, y + 0.07); g.tree(-0.28 * s, 0.31, 0.4, 4, y + 0.07);
    }
    g.box(0, H, 0, 0.66, 0.06, 0.66, C(v.roofColor));
    g.tree(0.1, 0.1, 0.55, 0, H + 0.06); g.tree(-0.15, -0.12, 0.5, 2, H + 0.06);
    g.anim('beacon', 0.25, H + 0.1, -0.25, { ph: g.rnd() });
  },
  res_high_5(g, v, W, D, H) {
    pad(g, W, D, '#a9c79a');
    const n = 6;
    for (let i = 0; i < n; i++) {
      const s = 0.92 - i * 0.1, y = (H * 0.92 * i) / n, h = (H * 0.92) / n;
      g.box(0, y, 0, s, h, s, C(v.color));
      bands(g, 0, 0, s, s, y - 0.06, y + h, true, '#5c86a8');
      g.box(0, y + h - 0.03, 0, s + 0.06, 0.05, s + 0.06, C('#6fae5c'));
      if (i % 2 === 1) glowRing(g, 0, y + h * 0.5, 0, s * 0.56, v.roofColor, 0.025);
    }
    g.cone(0, H * 0.92, 0, 0.12, H * 0.2, C(K.WHITE));
    g.anim('beacon', 0, H * 1.13, 0, { ph: g.rnd() });
  },
  res_high_2x2_1(g, v, W, D, H) {
    pad(g, W, D, PLOT.residential_high);
    const t = 0.5, L = W - 0.16, M = D - 0.16;
    blk(g, v, 0, -M / 2 + t / 2, L, t, H);
    blk(g, v, -L / 2 + t / 2, t / 2, t, M - t, H);
    blk(g, v, L / 2 - t / 2, t / 2, t, M - t, H);
    g.box(0, 0.03, 0.25, L - 2 * t, 0.015, M - t - 0.2, C(K.LAWN));
    g.tree(0, 0.3, 0.8);
    crowd(g, 2, 0, 0.35, 0.25, 0.2, { m: 'kid', s: 0.75, sp: 0.4 });
  },
  res_high_2x2_2(g, v, W, D, H) {
    pad(g, W, D, K.LAWN);
    blk(g, v, -0.42, -0.2, 0.7, 1.3, H);
    blk(g, v, 0.45, -0.5, 0.8, 0.62, H * 0.75);
    trees(g, 4, 0.1, 0.1, 0.85, 0.85, 0.8);
    g.box(0.45, 0.03, 0.45, 0.6, 0.012, 0.5, C(K.PAVE));
    walkers(g, 2, loopPath(0.2, 0.25, 0.7, 0.65), { y: 0.03 });
  },
  res_high_2x2_3(g, v, W, D, H) {
    pad(g, W, D, PLOT.residential_high);
    g.box(0, 0, 0, W - 0.14, 0.38, D - 0.14, C('#c3ccd4'));
    g.box(0, 0.03, D / 2 - 0.07, W - 0.3, 0.22, 0.02, C(K.GLASS), { layer: 'lit' });
    towerGlass(g, v, -0.42, -0.42, 0.62, 0.62, H, { crown: 0.2 });
    towerGlass(g, v, 0.45, -0.3, 0.55, 0.55, H * 0.78);
    towerGlass(g, v, 0.05, 0.45, 0.5, 0.5, H * 0.62);
  },
  /* Commerce */
  com_1(g, v, W, D, H, b, o = {}) {
    pad(g, W, D, PLOT.commerce);
    g.box(0, 0, -0.05, 0.8, H, 0.62, C(v.color)); roofOf(g, v, 0, -0.05, 0.8, 0.62, H, 'flat');
    shopFront(g, v, 0, -0.05, 0.8, 0.62, H, o);
    if (g.rnd() < 0.6) crowd(g, 1, 0, 0.4, 0.3, 0.05, { y: 0.03, sp: 0.2 });
  },
  com_1_bar(g, v, W, D, H, b) {
    BY_ID.com_1(g, v, W, D, H, b, { sign: '#f2b84b' });
    umbrella(g, -0.25, 0.4, v.roofColor); umbrella(g, 0.22, 0.4, '#e8e2d0');
    standing(g, [[-0.32, 0.36, 1.2], [-0.18, 0.44, -1.6], [0.16, 0.36, 0.9]], { y: 0.03, act: 'any' });
    standing(g, [[0.32, 0.44, -1.2], [0.05, 0.46, 0.4], [-0.05, 0.4, 2.2]], { y: 0.03, act: 'night' });
  },
  com_1_hair(g, v, W, D, H, b) {
    BY_ID.com_1(g, v, W, D, H, b);
    g.cyl(0.36, 0.03, 0.3, 0.025, 0.2, C(K.RED)); g.cyl(0.36, 0.1, 0.3, 0.027, 0.04, C(K.WHITE));
  },
  com_1_shop(g, v, W, D, H, b) { BY_ID.com_1(g, v, W, D, H, b); g.box(-0.2, 0.03, 0.42, 0.04, 0.16, 0.04, C('#e8d9c8')); g.box(0.2, 0.03, 0.42, 0.04, 0.16, 0.04, C('#e8d9c8')); },
  com_2(g, v, W, D, H) {
    pad(g, W, D, PLOT.commerce);
    g.box(0, 0, -0.04, 0.84, H, 0.7, C(v.color));
    bands(g, 0, -0.04, 0.84, 0.7, 0.3, H, false);
    roofOf(g, v, 0, -0.04, 0.84, 0.7, H, 'flat');
    shopFront(g, v, 0, -0.04, 0.84, 0.7, H);
    crowd(g, 2, 0, 0.42, 0.35, 0.04, { y: 0.03, sp: 0.2 });
  },
  com_2_resto(g, v, W, D, H) {
    pad(g, W, D, PLOT.commerce);
    const wh = blk(g, v, 0, -0.12, 0.76, 0.56, H + 0.1, { win: false });
    shopFront(g, v, 0, -0.12, 0.76, 0.56, wh, { sign: '#f2c46b' });
    frontWins(g, 0, -0.12, 0.76, 0.56, wh * 0.72, 3);
    umbrella(g, -0.28, 0.36, '#e8e2d0'); umbrella(g, 0, 0.38, v.roofColor); umbrella(g, 0.28, 0.36, '#e8e2d0');
    standing(g, [[-0.34, 0.3, 1.5], [-0.06, 0.32, 1.4], [0.22, 0.42, -1.5], [0.34, 0.3, -1.4]], { y: 0.03, act: 'any' });
  },
  com_2_retail(g, v, W, D, H) {
    pad(g, W, D, PLOT.commerce);
    g.box(0, 0, -0.04, 0.86, H, 0.72, C(v.color));
    bands(g, 0, -0.04, 0.86, 0.72, 0, H, true);
    roofOf(g, v, 0, -0.04, 0.86, 0.72, H, 'flat');
    g.box(0, H - 0.2, 0.33, 0.5, 0.14, 0.03, C(v.roofColor), { layer: 'glow' });
    crowd(g, 2, 0, 0.42, 0.35, 0.04, { y: 0.03, sp: 0.2 });
  },
  com_3(g, v, W, D, H) {
    pad(g, W, D, PLOT.commerce);
    g.box(0, 0, -0.03, 0.9, H, 0.8, C(v.color));
    bands(g, 0, -0.03, 0.9, 0.8, 0, H, true);
    g.box(0, H, -0.03, 0.93, 0.05, 0.83, C(v.roofColor));
    g.hemi(0, H, -0.03, 0.26, C('#9fd3ee'), { sy: 0.18 });
    g.box(0, H * 0.6, 0.38, 0.6, 0.12, 0.03, C('#f6d36b'), { layer: 'glow' });
    g.pool(0, 0.45, 0.4, '#fff1c4');
  },
  com_3_club(g, v, W, D, H) {
    pad(g, W, D, '#5a5363');
    g.box(0, 0, -0.04, 0.84, H, 0.74, C(v.color));
    roofOf(g, v, 0, -0.04, 0.84, 0.74, H, 'flat');
    for (const y of [0.25, 0.55, 0.85]) g.box(0, y, -0.04, 0.86, 0.025, 0.76, C(v.roofColor), { layer: 'glow' });
    g.box(0, H + 0.04, 0.3, 0.5, 0.14, 0.03, C('#ff6ad5'), { layer: 'glow' });
    door(g, 0, 0.33, '#191520', 0.18, 0.2);
    g.pool(0, 0.45, 0.45, '#ff6ad5');
    standing(g, [[-0.25, 0.42, 0], [-0.15, 0.43, 0.3], [-0.05, 0.42, -0.2], [0.18, 0.44, 0.5]], { y: 0.03 });
    // la nuit : file d'attente et monde devant la boîte
    for (let i = 0; i < 9; i++) g.anim('person', 0, 0.03, 0, { m: 'sway', x: -0.38 + i * 0.09, z: 0.47 + (i % 2) * 0.02, ry: 0.4 * (i % 3 - 1), seed: i * 1.7, act: 'night', color: ['#c23fbf', '#2d3136', '#f2f2f2', '#d64a3a'][i % 4] });
    crowd(g, 4, 0.1, 0.44, 0.3, 0.04, { y: 0.03, sp: 0.3, act: 'night' });
  },
  com_4(g, v, W, D, H) {
    pad(g, W, D, PLOT.commerce);
    g.box(0, 0, -0.04, 0.9, H * 0.6, 0.82, C(v.color));
    bands(g, 0, -0.04, 0.9, 0.82, 0, H * 0.6, true);
    g.box(-0.1, H * 0.6, -0.12, 0.6, H * 0.4, 0.55, C(v.color));
    bands(g, -0.1, -0.12, 0.6, 0.55, H * 0.6, H, true);
    g.box(-0.1, H, -0.12, 0.62, 0.05, 0.57, C(v.roofColor));
    g.box(0.1, H * 0.62, 0.3, 0.5, 0.3, 0.02, C('#7fe0ff'), { layer: 'glow' });
    g.anim('holoRing', -0.1, H + 0.15, -0.12, { r: 0.22, spin: 0.9 });
  },
  com_5(g, v, W, D, H) {
    pad(g, W, D, '#cfe3ea');
    g.cyl(0, 0, 0, 0.42, H * 0.8, C(v.color), { seg: 16 });
    for (let y = 0.15; y < H * 0.8 - 0.1; y += 0.26) g.cyl(0, y, 0, 0.432, 0.16, C('#5c9fc4'), { seg: 16, layer: lay(g) });
    g.cyl(0, H * 0.8, 0, 0.44, 0.05, C(v.roofColor), { seg: 16 });
    g.anim('holoRing', 0, H * 0.95, 0, { r: 0.36, spin: 0.6, color: v.roofColor });
    g.anim('holoRing', 0, H * 1.08, 0, { r: 0.24, spin: -1.1, color: v.roofColor });
    g.cyl(0, H * 0.8, 0, 0.03, H * 0.35, C(v.roofColor), { layer: 'glow' });
  },
  mall_1(g, v, W, D, H) {
    pad(g, W, D, PLOT.commerce);
    g.box(0, 0, -0.4, W - 0.25, H, 0.95, C(v.color));
    roofOf(g, v, 0, -0.4, W - 0.25, 0.95, H, 'flat');
    g.box(0, 0.03, 0.075, W - 0.5, 0.2, 0.02, C(K.GLASS), { layer: 'lit' });
    g.box(0, H * 0.75, 0.15, 0.9, 0.04, 0.2, C(v.roofColor));
    g.box(0, H + 0.02, 0.05, 0.7, 0.13, 0.03, C(v.roofColor), { layer: 'glow' });
    parking(g, 0, 0.6, W - 0.2, 0.6, 7);
    crowd(g, 3, 0, 0.2, 0.7, 0.05, { y: 0.03, sp: 0.2 });
    g.pool(-0.5, 0.6, 0.45); g.pool(0.5, 0.6, 0.45);
  },
  mall_2(g, v, W, D, H) {
    pad(g, W, D, PLOT.commerce);
    g.box(0, 0, -0.35, W - 0.15, H, 1.05, C(v.color));
    bands(g, 0, -0.35, W - 0.15, 1.05, 0, H, true);
    g.box(0, H, -0.35, W - 0.12, 0.05, 1.08, C(v.roofColor));
    g.hemi(0, H, -0.35, 0.4, C('#a9d8f2'), { sy: 0.28 });
    parking(g, 0, 0.62, W - 0.2, 0.55, 7);
    crowd(g, 3, 0, 0.25, 0.7, 0.04, { y: 0.03, sp: 0.2 });
    g.pool(-0.5, 0.62, 0.45); g.pool(0.5, 0.62, 0.45);
  },
  mall_3(g, v, W, D, H) {
    pad(g, W, D, PLOT.commerce);
    g.box(0, 0, -0.3, W - 0.12, H * 0.55, 1.15, C(v.color));
    bands(g, 0, -0.3, W - 0.12, 1.15, 0, H * 0.55, true);
    g.cyl(0.2, H * 0.55, -0.35, 0.5, H * 0.45, C(v.color), { seg: 20 });
    for (let y = H * 0.6; y < H - 0.1; y += 0.26) g.cyl(0.2, y, -0.35, 0.51, 0.16, C('#5c9fc4'), { seg: 20, layer: lay(g) });
    g.cyl(0.2, H, -0.35, 0.52, 0.05, C(v.roofColor), { seg: 20 });
    g.anim('holoRing', 0.2, H + 0.18, -0.35, { r: 0.42, spin: 0.5 });
    g.box(-0.5, H * 0.3, 0.28, 0.7, 0.3, 0.02, C('#7fe0ff'), { layer: 'glow' });
    parking(g, 0, 0.66, W - 0.2, 0.5, 7);
    crowd(g, 3, 0, 0.32, 0.7, 0.03, { y: 0.03, sp: 0.2 });
  },
  /* Bureaux */
  off_1(g, v, W, D, H) { pad(g, W, D, PLOT.offices); blk(g, v, 0, -0.04, 0.8, 0.7, H); door(g, 0, 0.31, K.GLASS, 0.2, 0.2); },
  off_2(g, v, W, D, H) { pad(g, W, D, PLOT.offices); towerGlass(g, v, 0, -0.03, 0.82, 0.76, H); g.box(0, 0.22, 0.38, 0.4, 0.03, 0.14, C(v.roofColor)); g.pool(0, 0.45, 0.3, '#fff1c4'); },
  off_3(g, v, W, D, H) {
    pad(g, W, D, PLOT.offices);
    towerGlass(g, v, 0, 0, 0.82, 0.82, H * 0.55);
    towerGlass(g, v, 0, -0.04, 0.66, 0.66, H * 0.85);
    towerGlass(g, v, 0, -0.06, 0.48, 0.48, H, { crown: 0.4 });
  },
  off_4(g, v, W, D, H) {
    pad(g, W, D, '#b8d0a8');
    g.box(0, 0, -0.05, 0.84, H * 0.7, 0.72, C(v.color));
    bands(g, 0, -0.05, 0.84, 0.72, 0, H * 0.7, true);
    g.box(-0.12, H * 0.7, -0.12, 0.56, H * 0.3, 0.5, C(v.color));
    bands(g, -0.12, -0.12, 0.56, 0.5, H * 0.7, H, true);
    g.box(-0.12, H, -0.12, 0.6, 0.04, 0.54, C(v.roofColor));
    for (let i = 0; i < 3; i++) g.box(-0.12, H + 0.04, -0.3 + i * 0.18, 0.5, 0.015, 0.14, C(K.SOLAR), { rx: -0.4 });
    g.box(0.28, H * 0.7, 0.15, 0.24, 0.03, 0.28, C(K.SOLAR), { rx: -0.3 });
    g.tree(0.35, 0.38, 0.6, 3);
  },
  off_5(g, v, W, D, H) {
    pad(g, W, D, PLOT.offices);
    g.box(0, 0, 0, 0.88, 0.3, 0.88, C('#c9d6e3'));
    const n = 22, h = (H * 0.9) / n;
    for (let i = 0; i < n; i++) {
      const s = 0.62 - i * 0.008;
      g.box(0, 0.3 + i * h, 0, s, h * 0.62, s, C(K.GLASS), { ry: i * 0.035, layer: lay(g) });
      g.box(0, 0.3 + i * h + h * 0.62, 0, s + 0.02, h * 0.38, s + 0.02, C(v.color), { ry: i * 0.035 });
      if (i % 6 === 5) g.box(0, 0.3 + i * h + h * 0.7, 0, s + 0.05, 0.03, s + 0.05, C(K.GLOW), { ry: i * 0.035, layer: 'glow' });
    }
    g.cone(0, 0.3 + H * 0.9, 0, 0.2, H * 0.12, C(v.roofColor), { ry: 0.77, seg: 4 });
    g.cyl(0, 0.3 + H * 1.0, 0, 0.012, 0.5, C(K.GLOW), { layer: 'glow' });
    g.anim('beacon', 0, 0.3 + H * 1.0 + 0.52, 0, { ph: g.rnd() });
  },
  off_2x2_1(g, v, W, D, H) {
    pad(g, W, D, PLOT.offices);
    blk(g, v, -0.45, -0.45, 0.85, 0.8, H);
    blk(g, v, 0.5, -0.3, 0.7, 1.1, H * 0.8);
    parking(g, -0.45, 0.5, 0.85, 0.55, 5);
    g.tree(0.5, 0.65, 0.7);
  },
  off_2x2_2(g, v, W, D, H) {
    pad(g, W, D, PLOT.offices);
    towerGlass(g, v, -0.45, -0.4, 0.75, 0.75, H, { crown: 0.15 });
    towerGlass(g, v, 0.45, 0.2, 0.7, 0.7, H * 0.8);
    g.box(0, H * 0.55, -0.1, 0.5, 0.16, 0.22, C(K.GLASS), { ry: -0.6 });
    trees(g, 3, -0.8, 0.3, -0.1, 0.85, 0.7);
    walkers(g, 2, loopPath(-0.85, 0.2, -0.1, 0.85), { y: 0.03 });
  },
  off_2x2_3(g, v, W, D, H) {
    pad(g, W, D, PLOT.offices);
    g.box(0, 0, 0, W - 0.12, 0.42, D - 0.12, C('#b7c3d0'));
    g.box(0, 0.03, D / 2 - 0.06, W - 0.4, 0.26, 0.02, C(K.GLASS), { layer: 'lit' });
    towerGlass(g, v, -0.3, -0.3, 0.9, 0.9, H * 0.7);
    towerGlass(g, v, -0.35, -0.35, 0.7, 0.7, H, { crown: 0.6 });
    towerGlass(g, v, 0.55, 0.15, 0.6, 0.6, H * 0.62);
    towerGlass(g, v, 0.2, 0.62, 0.5, 0.4, H * 0.42);
  },
  /* Industrie : cheminées qui fument, engins au travail */
  ind_1(g, v, W, D, H) {
    pad(g, W, D, K.GRAVEL);
    blk(g, v, -0.05, -0.08, 0.76, 0.66, H + 0.12, { win: false });
    g.box(-0.05, 0.03, 0.25, 0.3, 0.22, 0.02, C('#6a6d70'));
    chimney(g, 0.3, -0.3, 0.06, H + 0.6, { smoke: 'smoke', k: 0.8 });
    g.box(0.3, 0.03, 0.36, 0.2, 0.08, 0.12, C(K.WOOD));
  },
  ind_2(g, v, W, D, H) {
    pad(g, W, D, K.GRAVEL);
    blk(g, v, -0.04, -0.1, 0.84, 0.66, H + 0.12, { win: false });
    g.box(-0.2, 0.03, 0.235, 0.26, 0.26, 0.02, C('#6a6d70')); g.box(0.2, 0.03, 0.235, 0.26, 0.26, 0.02, C('#6a6d70'));
    chimney(g, 0.32, -0.33, 0.065, H + 0.9, { smoke: 'smokeDark' }); chimney(g, 0.16, -0.35, 0.05, H + 0.7, { smoke: 'smoke', k: 0.7 });
    g.anim('forklift', 0, 0.03, 0, { path: [[-0.35, 0.36], [0.35, 0.36]], sp: 0.22, dwell: 1.2, ph: g.rnd(), reverse: true }, Math.PI / 2 * 0);
  },
  ind_3(g, v, W, D, H) {
    pad(g, W, D, K.GRAVEL);
    g.box(0, 0, -0.08, 0.86, H, 0.66, C(v.color));
    g.box(0, 0.15, -0.08, 0.88, 0.1, 0.68, C(K.WIN), { layer: lay(g) });
    roofOf(g, v, 0, -0.08, 0.86, 0.66, H, 'flat');
    panelRows(g, 0, -0.08, 0.76, 0.56, 4, H + 0.04, 0.4);
    // convoyeur de colis en façade
    g.box(0, 0.03, 0.36, 0.86, 0.05, 0.08, C(K.DARK));
    for (let k = 0; k < 6; k++) g.anim('beltBox', 0, 0.08, 0, { a: [-0.42, 0, 0.36], b: [0.42, 0, 0.36], n: 6, k, sp: 0.12 });
    g.emit('steamS', 0.3, H + 0.05, -0.3, { k: 0.4, s: 0.7 });
  },
  ind_4(g, v, W, D, H) {
    pad(g, W, D, K.GRAVEL);
    g.box(-0.1, 0, -0.1, 0.7, H, 0.66, C(v.color));
    roofOf(g, v, -0.1, -0.1, 0.7, 0.66, H, 'flat');
    g.box(-0.1, 0.12, -0.1, 0.72, 0.08, 0.68, C(K.GLASS), { layer: lay(g) });
    g.box(0.33, 0.03, 0.3, 0.18, 0.06, 0.18, C('#5a5f66'));
    g.anim('robotArm', 0.33, 0.09, 0.3, { ph: g.rnd() * 6, s: 1.1 });
    containerStack(g, 0.3, -0.26, 1, 2, 2, Math.PI / 2);
    g.anim('agv', 0, 0.03, 0, { path: [[-0.4, 0.33], [0.15, 0.33], [0.15, 0.42], [-0.4, 0.42]], sp: 0.15, ph: g.rnd() });
  },
  ind_5(g, v, W, D, H) {
    pad(g, W, D, '#d3dbe0');
    g.box(0, 0, -0.06, 0.82, H * 0.7, 0.72, C(v.color));
    g.box(0, H * 0.7, -0.06, 0.85, 0.04, 0.75, C(v.roofColor));
    g.hemi(-0.18, H * 0.7, -0.1, 0.18, C(K.WHITE)); g.hemi(0.18, H * 0.7, -0.1, 0.14, C(K.WHITE));
    g.box(0, H * 0.35, 0.3, 0.86, 0.025, 0.02, C(v.roofColor), { layer: 'glow' });
    g.cyl(0.36, 0, 0.36, 0.07, 0.3, C(K.STEEL)); g.cyl(0.22, 0, 0.38, 0.06, 0.26, C(K.STEEL));
    g.emit('steamS', 0.36, 0.32, 0.36, { k: 0.6, s: 0.8 });
  },
  ind_2x1_1(g, v, W, D, H) {
    pad(g, W, D, K.GRAVEL);
    const along = W >= D, L = Math.max(W, D) - 0.15, S = Math.min(W, D) - 0.2;
    if (along) blk(g, v, 0, -0.08, L, S - 0.1, H + 0.15, { win: false }); else blk(g, v, -0.08, 0, S - 0.1, L, H + 0.15, { win: false, roof: 'saw' });
    chimney(g, along ? L / 2 - 0.15 : 0.32, along ? -0.32 : L / 2 - 0.15, 0.07, H + 0.9, { smoke: 'smoke' });
    if (along) g.anim('forklift', 0, 0.03, 0, { path: [[-L / 2 + 0.1, 0.4], [L / 2 - 0.1, 0.4]], sp: 0.25, dwell: 1, ph: g.rnd(), reverse: true });
    else g.anim('forklift', 0, 0.03, 0, { path: [[0.4, -L / 2 + 0.1], [0.4, L / 2 - 0.1]], sp: 0.25, dwell: 1, ph: g.rnd(), reverse: true });
  },
  ind_2x1_2(g, v, W, D, H) {
    pad(g, W, D, K.GRAVEL);
    const along = W >= D, L = Math.max(W, D) - 0.15, S = Math.min(W, D) - 0.22;
    if (along) blk(g, v, -0.2, -0.05, L - 0.4, S, H + 0.15, { win: false }); else blk(g, v, -0.05, -0.2, S, L - 0.4, H + 0.15, { win: false });
    const sx = along ? L / 2 - 0.15 : 0.25, sz = along ? -0.2 : L / 2 - 0.15;
    stack(g, sx, sz, 0.08, H + 1.3, { smoke: 'smokeDark' }); stack(g, along ? sx : -0.2, along ? 0.2 : sz, 0.07, H + 1.1, { smoke: 'smoke' });
    g.cyl(along ? sx - 0.3 : 0.25, 0, along ? 0.25 : sz - 0.3, 0.12, 0.3, C(K.STEEL));
  },
  /* Agriculture : tracteurs, moissonneuse, bêtes au pré */
  agri_1(g, v, W, D, H) {
    pad(g, W, D, '#8a6a45');
    for (let i = 0; i < 6; i++) g.box(-0.1, 0.03, -0.42 + i * 0.15, 0.7, 0.04, 0.07, C(i % 2 ? '#7fb14f' : '#5f9a3a'));
    blk(g, v, 0.33, 0.25, 0.28, 0.4, H + 0.12, { win: false });
    const path = []; for (let i = 0; i < 5; i++) { const z = -0.35 + i * 0.15; path.push(i % 2 ? [0.18, z] : [-0.4, z], i % 2 ? [-0.4, z] : [0.18, z]); }
    g.anim('tractor', 0, 0.03, 0, { path, sp: 0.14, dwell: 0.6, ph: g.rnd(), s: 0.9 });
  },
  agri_pasture(g, v, W, D, H) {
    pad(g, W, D, '#8fc06a');
    fence(g, W, D, 0.06, '#8a6a45');
    blk(g, v, 0.3, -0.28, 0.32, 0.34, H + 0.12, { win: false });
    const sheep = g.rnd() < 0.4;
    for (let i = 0; i < (sheep ? 5 : 4); i++) g.anim(sheep ? 'sheep' : 'cow', 0, 0.03, 0, { m: 'wander', cx: -0.1, cz: 0.12, rx: 0.25, rz: 0.22, sp: 0.06, stop: 0.35, seed: g.rnd() * 40 });
  },
  agri_2(g, v, W, D, H) {
    pad(g, W, D, '#c9b46a');
    for (let i = 0; i < 5; i++) g.box(-0.18, 0.03, -0.4 + i * 0.15, 0.55, 0.035, 0.08, C(i % 2 ? '#d8c15e' : '#bfa94e'));
    blk(g, v, 0.28, 0.2, 0.36, 0.42, H + 0.15, { win: false });
    g.cyl(0.3, 0, -0.25, 0.1, 0.55, C('#d7dbe0')); g.hemi(0.3, 0.55, -0.25, 0.1, C(K.STEEL));
    g.cyl(0.08, 0, -0.32, 0.08, 0.45, C('#d7dbe0')); g.hemi(0.08, 0.45, -0.32, 0.08, C(K.STEEL));
    g.anim('harvester', 0, 0.03, 0, { path: [[-0.42, -0.4], [-0.42, 0.2], [-0.1, 0.2], [-0.1, -0.4]], sp: 0.1, dwell: 0.8, ph: g.rnd(), s: 0.8 });
  },
  agri_3(g, v, W, D, H) {
    pad(g, W, D, '#a9c79a');
    const n = 5, h = H / n;
    for (let i = 0; i < n; i++) {
      g.box(0, i * h, 0, 0.72, h * 0.7, 0.72, C('#bfe3c3'));
      g.box(0, i * h + h * 0.08, 0, 0.6, h * 0.25, 0.6, C('#5fb354'));
      g.box(0, i * h + h * 0.4, 0, 0.73, 0.012, 0.73, C('#d47ff0'), { layer: 'glow' });
      g.box(0, i * h + h * 0.7, 0, 0.76, h * 0.3, 0.76, C(v.color));
    }
    g.gable(0, H, 0, 0.74, 0.22, 0.74, C(v.roofColor));
  },
  /* Extraction : chevalets de pompage, torchères, carrière avec convoyeur */
  ext_1(g, v, W, D, H) {
    pad(g, W, D, '#8f8a80');
    g.box(0, 0.03, 0, 0.56, 0.04, 0.18, C(K.DARK));
    for (const s of [-1, 1]) g.box(-0.02, 0.03, s * 0.05, 0.03, 0.42, 0.025, C(K.DARK), { rx: -s * 0.12 });
    g.box(-0.24, 0.03, 0, 0.12, 0.12, 0.12, C('#55595f'));
    g.anim('pumpBeam', -0.02, 0.45, 0, { ph: g.rnd() * 6, color: v.roofColor });
    g.anim('pumpCrank', -0.24, 0.12, 0, { ph: g.rnd() * 6 });
    g.cyl(0.18, 0.03, 0, 0.035, 0.08, C('#55595f'));
    g.cyl(0.25, 0, -0.3, 0.12, 0.22, C('#c9cdd0'));
  },
  ext_gas(g, v, W, D, H) {
    pad(g, W, D, '#8f8a80');
    lattice(g, -0.12, -0.1, 0.4, 0.1, H, '#6b6f75');
    g.cyl(0.28, 0, 0.25, 0.03, 0.75, C(K.STEEL));
    g.anim('flame', 0.28, 0.76, 0.25, { ph: g.rnd() * 9, s: 1.1 });
    g.emit('smokeDark', 0.28, 0.9, 0.25, { k: 0.6, s: 0.8 });
    g.cyl(0.25, 0, -0.25, 0.1, 0.18, C(v.roofColor));
    g.pool(0.28, 0.25, 0.5, '#ff9a3c');
  },
  ext_2(g, v, W, D, H) {
    pad(g, W, D, '#9b9384');
    for (let i = 0; i < 3; i++) g.box(-0.12, 0.03, -0.12, 0.7 - i * 0.18, 0.08 + i * 0.07, 0.7 - i * 0.18, C(['#a39887', '#8f8371', '#7c705f'][i]));
    g.cone(0.32, 0.03, 0.32, 0.14, 0.2, C('#b9ae97'));
    g.box(0.28, 0.03, -0.28, 0.2, 0.3, 0.2, C(v.roofColor));
    // convoyeur incliné de la fosse au concasseur, cailloux qui défilent
    const A = [-0.12, 0.26, -0.12], B = [0.24, 0.42, -0.24];
    g.tube(A[0], A[1] - 0.02, A[2], B[0], B[1] - 0.02, B[2], 0.025, C(K.DARK));
    for (let k = 0; k < 9; k++) g.anim('beltStone', 0, 0, 0, { a: A, b: B, n: 9, k, sp: 0.22, drop: true });
    for (let k = 0; k < 4; k++) g.anim('beltStone', 0, 0, 0, { a: [0.28, 0.33, -0.18], b: [0.32, 0.03, 0.3], n: 4, k, sp: 0.35, drop: true });
    g.anim('dumper', 0, 0.24, 0, { path: [[-0.25, -0.25], [-0.02, -0.02]], sp: 0.08, dwell: 2, ph: g.rnd(), reverse: true, s: 0.75 });
    g.emit('dust', 0.28, 0.34, -0.28, { k: 0.8 });
  },
  ext_3(g, v, W, D, H) {
    pad(g, W, D, '#8f8a80');
    g.box(0, 0.03, 0, 0.72, 0.12, 0.72, C(v.color));
    lattice(g, 0, 0, 0.42, 0.12, H, '#9aa4ad');
    g.box(0, H * 0.4, 0, 0.46, 0.025, 0.46, C(v.roofColor), { layer: 'glow' });
    g.box(0.28, 0.15, 0.28, 0.16, 0.2, 0.16, C(K.WHITE));
    g.anim('drillPipe', 0, 0.15, 0, { ph: g.rnd() * 6 });
    g.anim('beacon', 0, H + 0.03, 0, { ph: g.rnd() });
  },
  /* Filière bois : grumes sur convoyeur, chariot élévateur, sciure */
  wood_1(g, v, W, D, H) {
    pad(g, W, D, '#a58b68');
    blk(g, v, -0.1, -0.15, 0.62, 0.5, H + 0.1, { win: false });
    // pile de grumes rangée dans l'emprise (axe x), plus de débordement sur la voirie
    for (let k = 0; k < 3; k++) for (let i = 0; i < 4 - k; i++) {
      const z = 0.2 + i * 0.05 + k * 0.025, y = 0.055 + k * 0.045;
      g.tube(-0.4, y, z, -0.02, y, z, 0.024, C(['#8a5f3a', '#9b6c43', '#7a5233'][(i + k) % 3]), { seg: 7 });
    }
    g.box(0.25, 0.03, 0.1, 0.06, 0.05, 0.5, C(K.DARK));
    for (let k = 0; k < 4; k++) g.anim('beltLog', 0.25, 0.08, 0, { a: [0, 0, 0.32], b: [0, 0, -0.1], n: 4, k, sp: 0.18, drop: true });
    g.emit('dust', 0.25, 0.1, -0.12, { k: 0.5, s: 0.6 });
  },
  wood_2(g, v, W, D, H) {
    pad(g, W, D, '#a58b68');
    blk(g, v, -0.05, -0.15, 0.8, 0.52, H + 0.12, { win: false });
    for (let i = 0; i < 5; i++) g.box(-0.2, 0.03 + i * 0.03, 0.3, 0.4, 0.025, 0.18, C(i % 2 ? '#d7b98a' : '#c9a774'));
    g.box(0.28, 0.03, 0.3, 0.2, 0.14, 0.18, C('#b58a58'));
    g.anim('forklift', 0, 0.03, 0, { path: [[-0.35, 0.16], [0.35, 0.16]], sp: 0.2, dwell: 1.5, ph: g.rnd(), reverse: true });
    g.emit('dust', 0.3, H * 0.8, -0.15, { k: 0.4, s: 0.6 });
  },
  wood_3(g, v, W, D, H) {
    pad(g, W, D, '#b8a582');
    g.box(0, 0, -0.08, 0.84, H, 0.6, C(v.color));
    for (let x = -0.36; x <= 0.37; x += 0.12) g.box(x, 0, 0.22, 0.03, H, 0.02, C('#8a6440'));
    roofOf(g, v, 0, -0.08, 0.84, 0.6, H, 'flat');
    panelRows(g, 0, -0.08, 0.74, 0.5, 3, H + 0.04, 0.4);
    for (let i = 0; i < 3; i++) g.box(0.25, 0.03 + i * 0.06, 0.38, 0.3, 0.055, 0.12, C('#d8b88a'));
    g.anim('forklift', 0, 0.03, 0, { path: [[-0.38, 0.38], [0.05, 0.38]], sp: 0.2, dwell: 1.5, ph: g.rnd(), reverse: true });
  },
  /* Énergie */
  power_gas(g, v, W, D, H, b) {
    pad(g, W, D, PLOT.energy);
    g.box(-0.3, 0, -0.3, 1.9, 1.0, 1.0, C(v.color)); g.box(-0.3, 1.0, -0.3, 1.94, 0.05, 1.04, C(v.roofColor));
    bands(g, -0.3, -0.3, 1.9, 1.0, 0, 0.6, false);
    g.box(0.85, 0, -0.5, 0.5, 1.3, 0.6, C('#9aa0a6'));
    // fumées : filtres → vapeur blanche légère ; hydrogène → presque plus de fumée
    const clean = hasUp(b, 'gas_hydrogen') ? { smoke: 'steamS', k: 0.5 } : hasUp(b, 'gas_scrubbers') ? { smoke: 'steamS', k: 0.9 } : { smoke: 'smokeLight', k: 1.2 };
    stack(g, 1.05, 0.5, 0.17, 3.0, clean); stack(g, 0.55, 0.65, 0.15, 2.6, clean);
    if (hasUp(b, 'gas_combined')) { // chaudière de récupération et troisième cheminée
      g.box(-0.1, 0, 0.75, 0.9, 1.1, 0.45, C('#b7bcc2')); bands(g, -0.1, 0.75, 0.9, 0.45, 0, 1.1, false);
      stack(g, -0.75, 0.85, 0.13, 2.3, clean);
    } else { g.cyl(-1.0, 0, 0.75, 0.3, 0.45, C(K.WHITE)); g.cyl(-0.3, 0, 0.8, 0.26, 0.4, C(K.WHITE)); }
    if (hasUp(b, 'gas_turbines')) for (let i = 0; i < 3; i++) g.box(-0.9 + i * 0.6, 0.55, 0.205, 0.4, 0.04, 0.02, C(K.GLOW), { layer: 'glow' });
    if (hasUp(b, 'gas_hydrogen')) { for (let i = 0; i < 2; i++) { g.sphere(-1.15 + i * 0.4, 0.3, -1.1, 0.2, C('#e9f3fb')); g.cyl(-1.15 + i * 0.4, 0, -1.1, 0.05, 0.12, C(K.STEEL)); g.torus(-1.15 + i * 0.4, 0.3, -1.1, 0.205, 0.08, C('#62e6f7'), { layer: 'glow', sy: 0.02 }); } }
    fence(g, W, D);
    g.pool(-0.3, 0.5, 0.6, '#ffe2b0');
  },
  power_solar(g, v, W, D, H, b) {
    const col = hasUp(b, 'solar_perovskite') ? '#3a2f63' : K.SOLAR;
    pad(g, W, D, hasUp(b, 'solar_bifacial') ? '#e6e3da' : '#a7b39a');
    if (hasUp(b, 'solar_trackers')) {
      for (let i = 0; i < 5; i++) { const z = -0.1 - (D - 0.45) / 2 + (i + 0.5) * ((D - 0.45) / 5); g.box(0, 0.03, z, 0.04, 0.12, 0.04, C(K.STEEL)); g.anim('tracker', 0, 0.16, z, { len: W - 0.25, ph: i * 0.05, color: col }); }
    } else panelRows(g, 0, -0.1, W - 0.25, D - 0.45, 5, 0.03, 0.5, col);
    if (hasUp(b, 'solar_perovskite')) for (let i = 0; i < 5; i++) g.box(0, 0.035, -0.1 - (D - 0.45) / 2 + (i + 0.5) * ((D - 0.45) / 5) + 0.06, W - 0.3, 0.006, 0.012, C('#c58bff'), { layer: 'glow' });
    g.box(0.7, 0.03, 0.75, 0.25, 0.18, 0.18, C(K.WHITE));
    fence(g, W, D, 0.06);
  },
  power_wind(g, v, W, D, H, b) {
    const R = hasUp(b, 'wind_nextgen') ? 1.4 : hasUp(b, 'wind_ai') ? 1.2 : hasUp(b, 'wind_large') ? 1.08 : 0.9;
    const Ht = H * (hasUp(b, 'wind_nextgen') ? 1.15 : 1);
    g.cyl(0, 0, 0, 0.11, 0.08, C(K.CONC));
    g.cyl(0, 0, 0, 0.07, Ht, C(v.color), { k: 0.5 });
    g.box(0, Ht - 0.02, 0.02, 0.1, 0.1, 0.24, C(v.color));
    if (hasUp(b, 'wind_ai')) g.box(0, Ht + 0.08, -0.06, 0.03, 0.03, 0.03, C(K.GLOW), { layer: 'glow' });
    g.anim('rotor', 0, Ht + 0.03, 0.15, { R, sp: 1.4 + (hasUp(b, 'wind_ai') ? 0.4 : 0), ph: g.rnd() * 6 });
    g.anim('beacon', 0, Ht + 0.1, 0.02, { ph: g.rnd() });
  },
  power_battery(g, v, W, D, H, b) {
    pad(g, W, D, PLOT.energy);
    const rows = hasUp(b, 'battery_cells') ? [-0.3, -0.05, 0.2] : [-0.25, 0.05];
    for (const z of rows) { g.box(0, 0.03, z, 0.78, 0.2, 0.2, C(v.color)); g.box(0, 0.23, z, 0.78, 0.03, 0.2, C(v.roofColor)); g.box(0, 0.12, z + 0.101, 0.6, 0.015, 0.004, C('#7fffb0'), { layer: 'glow' }); }
    if (!hasUp(b, 'battery_cells')) { g.box(-0.2, 0.03, 0.34, 0.2, 0.18, 0.14, C(K.STEEL)); g.box(0.2, 0.03, 0.34, 0.14, 0.12, 0.14, C('#6e7880')); }
  },
  power_line(g, v, W, D, H) {
    lattice(g, 0, 0, 0.36, 0.1, H, v.color);
    for (const y of [H * 0.7, H * 0.92]) { g.box(0, y, 0, 0.75, 0.03, 0.03, C(v.color)); g.box(0.34, y - 0.08, 0, 0.02, 0.08, 0.02, C('#d8d4c8')); g.box(-0.34, y - 0.08, 0, 0.02, 0.08, 0.02, C('#d8d4c8')); }
  },
  data_center(g, v, W, D, H, b) {
    pad(g, W, D, PLOT.energy);
    const L = Math.max(W, D) - 0.25, S = Math.min(W, D) - 0.3, along = W >= D;
    const w = along ? L : S, d = along ? S : L;
    g.box(0, 0, 0, w, H, d, C(v.color));
    g.box(0, H, 0, w + 0.03, 0.04, d + 0.03, C('#c3cbd2'));
    g.box(0, H * 0.45, 0, w + 0.02, 0.04, d + 0.02, C(v.roofColor), { layer: 'glow' });
    const nx = Math.round(w / 0.32), nz = Math.round(d / 0.32);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = -w / 2 + (i + 0.5) * (w / nx), z = -d / 2 + (j + 0.5) * (d / nz);
      g.cyl(x, H + 0.04, z, 0.1, 0.05, C(K.DARK), { k: 1, seg: 10 });
      g.anim('fan', x, H + 0.095, z, { r: 0.085, sp: 6 + g.rnd() * 3, ph: g.rnd() * 6 });
    }
    if (hasUp(b, 'dc_cooling')) { // refroidissement liquide : tuyauteries bleues et aéroréfrigérants
      for (const s of [-1, 1]) g.tube(-w / 2 + 0.05, 0.25, s * (d / 2 + 0.04), w / 2 - 0.05, 0.25, s * (d / 2 + 0.04), 0.025, C('#3f8fc0'), { seg: 6 });
    } else g.emit('steamS', 0, H + 0.12, 0, { k: 0.5, s: 0.9, col: '#e7ecef' });
  },
  power_hydro(g, v, W, D, H, b) {
    pad(g, W, D, PLOT.energy);
    g.box(-0.2, 0, -0.2, 1.2, H, 1.0, C(v.color)); g.box(-0.2, H, -0.2, 1.24, 0.04, 1.04, C(v.roofColor));
    bands(g, -0.2, -0.2, 1.2, 1.0, 0, H, false);
    const ws = b.waterLocal;
    if (ws) {
      const [wx, wz] = ws;
      g.box(wx * 1.25, -0.55, wz * 1.25, wz ? 1.9 : 0.35, 0.95, wx ? 1.9 : 0.35, C('#bcc3c7'));
      for (let i = -1; i <= 1; i++) {
        const ox = wz ? i * 0.35 : 0, oz = wx ? i * 0.35 : 0;
        g.tube(wx * 0.6 + ox, 0.12, wz * 0.6 + oz, wx * 1.1 + ox, 0.12, wz * 1.1 + oz, 0.07, C(K.STEEL));
        g.emit('foam', wx * 1.55 + ox, WATER_Y + 0.02, wz * 1.55 + oz, { k: hasUp(b, 'hydro_kaplan') ? 1.4 : 1 });
      }
    }
    if (hasUp(b, 'hydro_kaplan')) g.box(-0.2, H * 0.5, 0.31, 1.0, 0.04, 0.02, C(K.GLOW), { layer: 'glow' });
    if (hasUp(b, 'hydro_pumped')) { g.box(-0.55, 0.03, 0.6, 0.6, 0.18, 0.5, C('#9aa3ab')); g.box(-0.55, 0.05, 0.6, 0.52, 0.17, 0.42, C('#3f8fc0'), { layer: 'litc' }); }
  },
  power_nuclear(g, v, W, D, H, b) {
    pad(g, W, D, '#b8b9b0');
    fence(g, W, D, 0.12);
    for (const x of [-1.9, 0.0]) { g.cyl(x, 0, -0.6, 0.85, 1.7, C(v.color), { seg: 20 }); g.hemi(x, 1.7, -0.6, 0.85, C(v.roofColor)); g.box(x, 0, 0.35, 0.5, 0.9, 0.5, C('#cdd1d4')); }
    g.box(-0.95, 0, 1.3, 3.8, 1.15, 1.2, C('#e3e5e6')); g.box(-0.95, 1.15, 1.3, 3.84, 0.06, 1.24, C('#9aa3aa'));
    bands(g, -0.95, 1.3, 3.8, 1.2, 0, 1.15, false);
    const k = hasUp(b, 'nuclear_uprate') ? 1.5 : 1;
    for (let i = 0; i < 4; i++) {
      const z = -2.9 + i * 1.95;
      g.cooling(2.55, 0, z, 0.95, 3.6, C('#d9dbdc'));
      g.emit('steam', 2.55, 3.55, z, { k, s: 1, l: 1.1 });
      g.anim('beacon', 2.55 + 0.6, 3.62, z, { ph: i * 0.3 });
    }
    g.box(-1.5, 0, 3.1, 2.4, 0.5, 0.9, C('#cfd4d8')); bands(g, -1.5, 3.1, 2.4, 0.9, 0, 0.5, false);
    for (let i = 0; i < 6; i++) g.box(-3.3 + i * 0.25, 0, -3.0, 0.04, 0.8, 0.04, C(K.STEEL));
    parking(g, 1.0, 3.2, 1.6, 0.8, 8);
    chimney(g, -3.2, 2.6, 0.06, 2.4, { col: '#d9d6cf', band: K.RED, smoke: false });
    if (hasUp(b, 'nuclear_safety')) for (let i = 0; i < 3; i++) { g.cyl(-3.0 + i * 0.5, 0, -1.6, 0.18, 0.7, C('#e8ecef')); g.hemi(-3.0 + i * 0.5, 0.7, -1.6, 0.18, C('#d6403a')); }
    if (hasUp(b, 'nuclear_fuel')) for (const x of [-1.9, 0.0]) glowRing(g, x, 1.2, -0.6, 0.87, '#5bc8ff', 0.02);
    g.pool(-0.95, 2.05, 1.2, '#ffe2b0');
  },
  power_nuclear_legacy(g, v, W, D, H, b) {
    pad(g, W, D, '#b8b9b0');
    fence(g, W, D, 0.1);
    g.cyl(-0.8, 0, -0.6, 0.6, 1.3, C(v.color), { seg: 18 }); g.hemi(-0.8, 1.3, -0.6, 0.6, C(v.roofColor));
    g.box(-0.6, 0, 0.9, 2.0, 0.9, 0.9, C('#e3e5e6')); bands(g, -0.6, 0.9, 2.0, 0.9, 0, 0.9, false);
    const k = hasUp(b, 'nuclear_uprate') ? 1.5 : 1;
    for (const z of [-0.9, 0.75]) { g.cooling(1.0, 0, z, 0.7, 2.5, C('#d9dbdc')); g.emit('steam', 1.0, 2.45, z, { k, s: 0.75 }); g.anim('beacon', 1.45, 2.52, z, { ph: z }); }
    if (hasUp(b, 'nuclear_safety')) for (let i = 0; i < 2; i++) { g.cyl(-1.6 + i * 0.4, 0, 0.2, 0.15, 0.55, C('#e8ecef')); g.hemi(-1.6 + i * 0.4, 0.55, 0.2, 0.15, C('#d6403a')); }
    if (hasUp(b, 'nuclear_fuel')) glowRing(g, -0.8, 0.9, -0.6, 0.62, '#5bc8ff', 0.02);
  },
  power_fusion(g, v, W, D, H, b) {
    pad(g, W, D, '#c7ced6');
    fence(g, W, D, 0.12);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.box(Math.cos(a) * 2.0 - 0.6, 0, Math.sin(a) * 2.0 - 0.4, 0.25, 0.9, 0.25, C('#9aa4ad')); }
    g.torus(-0.6, 1.25, -0.4, 2.0, 0.36, C('#e3e9f0'));
    glowRing(g, -0.6, 1.25, -0.4, 2.36, v.roofColor, 0.045);
    glowRing(g, -0.6, 1.25, -0.4, 1.64, v.roofColor, 0.04);
    g.anim('holoRing', -0.6, 1.25, -0.4, { r: 2.0, spin: 2.4, color: '#b8f3ff', tilt: 0 });
    if (hasUp(b, 'fusion_magnets')) for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.box(-0.6 + Math.cos(a) * 2.0, 0.8, -0.4 + Math.sin(a) * 2.0, 0.22, 0.9, 0.85, C('#5a6b7d'), { ry: -a }); }
    g.cyl(-0.6, 0, -0.4, 0.9, 1.2, C('#e9eef4'), { seg: 20 }); g.hemi(-0.6, 1.2, -0.4, 0.9, C(v.color));
    glowRing(g, -0.6, 2.25, -0.4, 0.5, v.roofColor, 0.05);
    if (hasUp(b, 'fusion_ai')) g.anim('holoBars', -0.6, 2.2, -0.4, { ph: 1 });
    for (let i = 0; i < 3; i++) { g.cyl(2.6, 0, -2.6 + i * 1.0, 0.35, 1.2, C(K.WHITE)); g.hemi(2.6, 1.2, -2.6 + i * 1.0, 0.35, C(K.WHITE)); }
    g.box(1.2, 0, 2.6, 3.2, 0.8, 1.2, C('#eef2f6')); bands(g, 1.2, 2.6, 3.2, 1.2, 0, 0.8, true);
    g.box(1.2, 0.3, 3.21, 3.0, 0.03, 0.02, C(v.roofColor), { layer: 'glow' });
    parking(g, -2.4, 3.1, 2.2, 0.8, 9);
    g.pool(-0.6, -0.4, 2.6, '#8fdcf5');
  },
  power_fusion_legacy(g, v, W, D, H, b) {
    pad(g, W, D, '#c7ced6');
    g.torus(-0.2, 0.75, -0.2, 0.85, 0.22, C('#e3e9f0'));
    glowRing(g, -0.2, 0.75, -0.2, 1.07, v.roofColor, 0.035);
    g.anim('holoRing', -0.2, 0.75, -0.2, { r: 0.85, spin: 2.6, color: '#b8f3ff' });
    g.cyl(-0.2, 0, -0.2, 0.42, 0.7, C(K.WHITE)); g.hemi(-0.2, 0.7, -0.2, 0.42, C(v.color));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.box(-0.2 + Math.cos(a) * 0.85, 0, -0.2 + Math.sin(a) * 0.85, 0.14, 0.55, 0.14, C('#9aa4ad')); }
    g.box(0.9, 0, 1.0, 0.9, 0.5, 0.7, C('#eef2f6'));
    if (hasUp(b, 'fusion_ai')) g.anim('holoBars', -0.2, 1.2, -0.2, { ph: 2 });
  },
  /* Eau */
  water_pump(g, v, W, D, H, b) {
    pad(g, W, D, PLOT.water);
    g.box(0, 0, -0.05, 0.5, H * 0.6, 0.5, C(v.color));
    g.hemi(0, H * 0.6, -0.05, 0.25, C(v.roofColor));
    const ws = b.waterLocal;
    if (ws) { g.tube(ws[0] * 0.2, 0.1, ws[1] * 0.2, ws[0] * 0.75, -0.2, ws[1] * 0.75, 0.045, C(K.STEEL)); g.emit('foam', ws[0] * 0.8, WATER_Y + 0.02, ws[1] * 0.8, { k: 0.4, s: 0.6 }); }
    door(g, 0, 0.2);
  },
  water_tower(g, v, W, D, H) {
    pad(g, W, D, PLOT.water);
    g.cyl(0, 0, 0, 0.1, H * 0.7, C(v.color));
    g.cyl(0, H * 0.7, 0, 0.32, 0.3, C(v.roofColor), { k: 1.1 });
    g.cone(0, H * 0.7 + 0.3, 0, 0.36, 0.12, C(v.color));
    g.cyl(0, H * 0.7 - 0.1, 0, 0.26, 0.1, C(v.color), { k: 1.25 });
    g.box(0.3, 0, 0.3, 0.25, 0.2, 0.22, C(K.CONC));
    g.anim('beacon', 0, H * 0.7 + 0.44, 0, { ph: g.rnd() });
  },
  sewage_plant(g, v, W, D, H, b) {
    pad(g, W, D, PLOT.water);
    const reuse = hasTech('water_reuse');
    for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45]]) {
      g.cyl(x, 0, z, 0.42, 0.16, C(v.color), { seg: 18 }); g.cyl(x, 0.02, z, 0.37, 0.15, C(reuse ? '#5f9a5a' : v.roofColor), { seg: 18 });
      g.anim('clarifier', x, 0.175, z, { r: 0.37, ph: g.rnd() * 6 });
    }
    g.box(-0.3, 0, 0.5, 0.9, 0.12, 0.6, C(v.color)); g.box(-0.3, 0.02, 0.5, 0.82, 0.11, 0.52, C(reuse ? '#6faa55' : '#5f8d74'));
    if (reuse) for (let i = 0; i < 6; i++) g.sphere(-0.62 + i * 0.12, 0.14, 0.5 + (i % 2 ? 0.12 : -0.12), 0.05, C('#4f9a43'), { low: true });
    else g.emit('foam', -0.3, 0.14, 0.5, { k: 0.5, s: 0.6 });
    g.box(0.55, 0, 0.5, 0.5, H * 1.8, 0.5, C(K.CONC)); roofOf(g, v, 0.55, 0.5, 0.5, 0.5, H * 1.8, 'flat');
  },
  water_plant(g, v, W, D, H) {
    pad(g, W, D, PLOT.water);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      g.box(-0.85 + i * 0.75, 0, -0.75 + j * 0.65, 0.7, 0.14, 0.58, C('#cfd6d9'));
      g.box(-0.85 + i * 0.75, 0.02, -0.75 + j * 0.65, 0.62, 0.13, 0.5, C(v.roofColor), { layer: 'litc' });
      if ((i + j) % 2 === 0) g.emit('foam', -0.85 + i * 0.75, 0.16, -0.75 + j * 0.65, { k: 0.4, s: 0.7 });
    }
    g.box(0, 0, 0.85, 2.4, H * 1.6, 0.8, C(v.color)); roofOf(g, v, 0, 0.85, 2.4, 0.8, H * 1.6, 'flat');
    bands(g, 0, 0.85, 2.4, 0.8, 0, H * 1.6, false);
  },
  sewage_big(g, v, W, D, H) {
    pad(g, W, D, PLOT.water);
    const reuse = hasTech('water_reuse');
    for (const [x, z] of [[-0.75, -0.75], [0.4, -0.75], [-0.75, 0.35]]) {
      g.cyl(x, 0, z, 0.5, 0.18, C(v.color), { seg: 20 }); g.cyl(x, 0.02, z, 0.45, 0.17, C(reuse ? '#5f9a5a' : v.roofColor), { seg: 20 });
      g.anim('clarifier', x, 0.195, z, { r: 0.45, ph: g.rnd() * 6 });
    }
    for (const x of [0.25, 0.75]) g.sphere(x, 0.55, 0.45, 0.3, C('#bfc5c9'), { sy: 0.55 });
    g.box(0.5, 0, 1.05, 1.0, 0.45, 0.5, C(K.CONC)); bands(g, 0.5, 1.05, 1.0, 0.5, 0, 0.45, false);
  },
  desalination(g, v, W, D, H, b) {
    pad(g, W, D, PLOT.water);
    g.box(-0.3, 0, -0.3, 1.0, H * 1.4, 0.8, C(v.color)); roofOf(g, v, -0.3, -0.3, 1.0, 0.8, H * 1.4, 'flat'); bands(g, -0.3, -0.3, 1.0, 0.8, 0, H * 1.4, false);
    for (let i = 0; i < 4; i++) g.tube(-0.75 + i * 0.3, 0.12, 0.45, -0.75 + i * 0.3, 0.12, 0.85, 0.1, C(K.WHITE), { seg: 10 });
    const ws = b.waterLocal;
    if (ws) { g.tube(ws[0] * 0.5, 0.06, ws[1] * 0.5, ws[0] * 1.3, -0.2, ws[1] * 1.3, 0.06, C(K.STEEL)); g.emit('foam', ws[0] * 1.35, WATER_Y + 0.02, ws[1] * 1.35, { k: 0.6, s: 0.8 }); }
  },
  /* Parcs et loisirs : promeneurs, jeux, sport, fontaines */
  park_small(g, v, W, D) {
    pad(g, W, D, v.color);
    g.box(0, 0.03, 0, 0.12, 0.012, D - 0.06, C(K.SAND)); g.box(0, 0.03, 0, W - 0.06, 0.012, 0.12, C(K.SAND));
    g.tree(-0.25, -0.25, 1, 0); g.tree(0.27, 0.25, 0.9, 3); g.tree(0.28, -0.27, 0.8, 2);
    g.box(-0.25, 0.03, 0.2, 0.2, 0.05, 0.06, C(K.WOOD));
    walkers(g, 2, [[0, -0.45], [0, 0], [0.45, 0], [0, 0], [0, 0.45], [0, 0], [-0.45, 0], [0, 0]], { y: 0.03, sp: 0.07 });
    standing(g, [[-0.25, 0.16, Math.PI]], { y: 0.03 });
  },
  park(g, v, W, D) {
    pad(g, W, D, v.color);
    g.cyl(0.2, 0.02, 0.15, 0.42, 0.03, C(K.WATER), { seg: 18, layer: 'litc' });
    g.box(-0.5, 0.03, 0, 0.12, 0.012, D - 0.08, C(K.SAND)); g.box(0, 0.03, -0.55, W - 0.08, 0.012, 0.12, C(K.SAND));
    trees(g, 4, -0.9, -0.9, -0.6, 0.9); trees(g, 3, 0.0, -0.9, 0.9, -0.7, 1, 3); trees(g, 2, 0.6, 0.6, 0.9, 0.9, 1, 2);
    g.cyl(-0.65, 0.03, 0.6, 0.18, 0.22, C(K.WHITE), { seg: 8 }); g.cone(-0.65, 0.25, 0.6, 0.24, 0.14, C(v.roofColor), { seg: 8 });
    g.anim('jet', 0.2, 0.05, 0.15, { pattern: 'pulse', h: 0.35, ph: g.rnd() * 6 });
    g.anim('splash', 0.2, 0.05, 0.15, { r: 0.06 });
    for (let i = 0; i < 3; i++) g.anim('duck', 0, 0.05, 0, { cx: 0.2, cz: 0.15, rx: 0.28, rz: 0.26, sp: 0.06, seed: g.rnd() * 30 });
    walkers(g, 4, [[-0.5, -0.9], [-0.5, 0.9], [-0.5, -0.55], [0.9, -0.55], [-0.5, -0.55]], { y: 0.03, sp: 0.08 });
    crowd(g, 2, -0.3, 0.55, 0.15, 0.25, { m: 'kid', s: 0.75, y: 0.03, sp: 0.35 });
    g.pool(-0.5, 0, 0.5); g.pool(0, -0.55, 0.5);
  },
  forest_urban(g, v, W, D) {
    pad(g, W, D, v.roofColor);
    g.box(0, 0.03, 0, 0.12, 0.012, D - 0.08, C(K.SAND), { ry: 0.4 });
    for (let i = 0; i < 34; i++) { const x = (g.rnd() - 0.5) * (W - 0.3), z = (g.rnd() - 0.5) * (D - 0.3); if (Math.abs(x * 0.93 - z * 0.39) > 0.15) g.tree(x, z, 0.9 + g.rnd() * 0.5, [0, 1, 2, 3, 0, 1][(g.rnd() * 6) | 0]); }
    const L = (D - 0.2) / 2, s = Math.sin(0.4), c = Math.cos(0.4);
    walkers(g, 3, [[-L * s, -L * c], [L * s, L * c]], { y: 0.03, sp: 0.12 });
  },
  plaza(g, v, W, D) {
    pad(g, W, D, v.color);
    for (let i = 0; i < 4; i++) g.box(-0.36 + i * 0.24, 0.031, 0, 0.012, 0.01, D - 0.08, C(v.roofColor));
    fountain(g, 0, 0, 0.24, ['wave', 'dance', 'arc', 'tiers'][(g.rnd() * 4) | 0], { h: 0.22 });
    g.tree(-0.33, -0.33, 0.7, 2); g.tree(0.33, 0.33, 0.7, 0);
    walkers(g, 3, loopPath(-0.4, -0.4, 0.4, 0.4), { y: 0.03, sp: 0.08 });
    standing(g, [[0.32, -0.3, -2.3]], { y: 0.03 });
  },
  playground(g, v, W, D) {
    pad(g, W, D, v.color);
    g.box(-0.1, 0.03, 0.05, 0.55, 0.015, 0.5, C(K.SAND));
    g.box(-0.2, 0.03, -0.05, 0.14, 0.2, 0.14, C(K.RED)); g.box(-0.04, 0.05, -0.05, 0.05, 0.02, 0.28, C(K.YELLOW), { rx: -0.6 });
    // portique et deux balançoires
    for (const x of [0.1, 0.36]) { g.box(x, 0.03, 0.22, 0.015, 0.2, 0.015, C(K.BLUE)); }
    g.box(0.23, 0.22, 0.22, 0.28, 0.015, 0.015, C(K.BLUE));
    g.anim('swing', 0.17, 0.22, 0.22, { ph: 0 }); g.anim('swing', 0.29, 0.22, 0.22, { ph: 1.7 });
    g.anim('carousel', -0.2, 0.045, 0.28, { ph: g.rnd() * 6 });
    crowd(g, 4, -0.1, 0.05, 0.2, 0.18, { m: 'kid', s: 0.7, y: 0.045, sp: 0.45 });
    standing(g, [[0.36, -0.3, 2.6], [0.28, -0.36, 2.3]], { y: 0.03 });
    g.tree(0.33, -0.33, 0.8, 3);
  },
  sports_field(g, v, W, D) {
    pad(g, W, D, '#c7b49a');
    g.box(0, 0.03, 0, W - 0.3, 0.015, D - 0.45, C(v.color));
    for (let i = 0; i < 4; i++) g.box(0, 0.031, -D / 2 + 0.3 + i * 0.4, W - 0.36, 0.012, 0.36, C(i % 2 ? '#5fae4f' : '#57a447'));
    g.box(0, 0.046, 0, W - 0.34, 0.006, 0.02, C(K.WHITE)); g.cyl(0, 0.046, 0, 0.17, 0.004, C(K.WHITE), { k: 1 });
    for (const s of [-1, 1]) g.box(s * (W / 2 - 0.2), 0.03, 0, 0.03, 0.08, 0.3, C(K.WHITE));
    g.box(0, 0.03, D / 2 - 0.12, W - 0.3, 0.12, 0.14, C('#9aa3ab'), { rx: 0.3 });
    const f = { rx: (W - 0.4) / 2, rz: (D - 0.55) / 2, seed: g.rnd() * 9 };
    for (let i = 0; i < 10; i++) {
      const team = i < 5 ? -1 : 1, k = i % 5;
      g.anim('person', 0, 0.045, 0, { m: 'player', f, hx: team * (0.15 + 0.15 * (k % 3)) * f.rx * 2, hz: ((k % 3) - 1) * f.rz * 0.6, seed: i * 1.7, lag: 0.2 + k * 0.1, keeper: k === 4, color: team < 0 ? '#d64a3a' : '#2f6fb0' });
    }
    g.anim('ball', 0, 0.045, 0, { f });
    for (const s of [-1, 1]) { g.cyl(s * (W / 2 - 0.12), 0, -D / 2 + 0.12, 0.015, 0.7, C(K.STEEL)); g.box(s * (W / 2 - 0.12), 0.7, -D / 2 + 0.12, 0.1, 0.05, 0.03, C('#fff6c8'), { layer: 'lit' }); }
    g.pool(0, 0, 0.9, '#f4f8ff');
  },
  statue(g, v, W, D) {
    pad(g, W, D, v.color);
    g.cyl(0, 0.03, 0, 0.3, 0.03, C(v.roofColor), { seg: 16 });
    g.box(0, 0.06, 0, 0.16, 0.22, 0.16, C('#bfb4a0'));
    g.cyl(0, 0.28, 0, 0.045, 0.2, C('#7d6a44'), { k: 0.7 }); g.sphere(0, 0.52, 0, 0.04, C('#7d6a44'));
    g.box(0.06, 0.4, 0, 0.12, 0.03, 0.03, C('#7d6a44'), { rz: 0.7 });
    g.tree(-0.33, 0.33, 0.6, 2); g.tree(0.33, -0.33, 0.6, 2);
    standing(g, [[0.2, 0.32, Math.PI + 0.5], [-0.25, -0.28, 0.6]], { y: 0.03 });
    g.pool(0, 0, 0.4, '#fff1c4');
  },
  marina(g, v, W, D, H, b) {
    pad(g, W, D, v.color);
    g.box(-0.3, 0, -0.3, 0.7, 0.32, 0.6, C(K.WHITE)); g.box(-0.3, 0.32, -0.3, 0.74, 0.04, 0.64, C('#3f6fb0'));
    frontWins(g, -0.3, -0.3, 0.7, 0.6, 0.15, 3);
    const [wx, wz] = b.waterLocal || [1, 0];
    // pontons au ras de l'eau ; bateaux à quai et bateaux qui sortent faire un tour sur le fleuve
    for (let i = -1; i <= 1; i++) {
      const ox = wz ? i * 0.55 : 0, oz = wx ? i * 0.55 : 0;
      g.box(wx * 1.3 + ox, WATER_Y - 0.01, wz * 1.3 + oz, wx ? 0.9 : 0.1, 0.04, wz ? 0.9 : 0.1, C(K.WOOD));
    }
    standing(g, [[0.4, 0.4, 1.5], [0.3, -0.5, 2]], { y: 0.03 });
    if (g.sink) g.sink.marina = { b };
  },
  mayor_house(g, v, W, D, H) {
    pad(g, W, D, K.LAWN);
    const wh = blk(g, v, 0, -0.35, 1.3, 0.7, H + 0.2, { win: false });
    frontWins(g, 0, -0.35, 1.3, 0.7, wh * 0.3, 5); frontWins(g, 0, -0.35, 1.3, 0.7, wh * 0.68, 5);
    door(g, 0, 0.0, '#5a3b2a', 0.14, 0.22);
    g.box(0, 0.03, 0.45, 0.14, 0.012, 0.9, C(K.SAND));
    fountain(g, 0, 0.45, 0.18, 'tiers', { h: 0.18 });
    trees(g, 3, -0.9, 0.2, -0.3, 0.9, 1, 2); trees(g, 3, 0.3, 0.2, 0.9, 0.9, 1, 2);
    g.pool(0, 0.1, 0.5, '#fff1c4');
  },
  museum(g, v, W, D, H, b) {
    pad(g, W, D, '#d8cfb8');
    g.box(0, 0, -0.1, 1.6, 0.06, 1.3, C('#e6dcc4')); g.box(0, 0.06, -0.1, 1.5, 0.05, 1.2, C('#ebe2cc'));
    g.box(0, 0.11, -0.25, 1.4, H - 0.3, 0.9, C(v.color));
    for (let i = 0; i < 7; i++) g.cyl(-0.6 + i * 0.2, 0.11, 0.38, 0.045, H - 0.3, C('#f4efe2'), { seg: 8 });
    g.box(0, H - 0.19, 0.0, 1.45, 0.08, 1.0, C(v.color));
    g.gable(0, H - 0.11, 0.0, 1.5, 0.3, 1.05, C(v.roofColor));
    const n = hasUp(b, 'culture_program') ? 7 : 3;
    crowd(g, n, 0, 0.72, 0.6, 0.12, { y: 0.03, sp: 0.15, stop: 0.4 });
    g.pool(-0.5, 0.75, 0.5, '#fff1c4'); g.pool(0.5, 0.75, 0.5, '#fff1c4');
  },
  zoo(g, v, W, D) {
    pad(g, W, D, v.color);
    g.cyl(-0.6, 0.02, 0.6, 0.45, 0.03, C(K.WATER), { seg: 16, layer: 'litc' });
    const pens = [[-0.75, -0.75, 'elephant', 2], [0.5, -0.7, 'giraffe', 2], [0.6, 0.5, 'zebra', 3]];
    for (const [x, z, kind, n] of pens) {
      g.box(x, 0.03, z, 0.85, 0.015, 0.75, C('#b9a676'));
      g.box(x, 0.03, z - 0.37, 0.85, 0.08, 0.015, C(K.WOOD)); g.box(x, 0.03, z + 0.37, 0.85, 0.08, 0.015, C(K.WOOD));
      g.box(x - 0.42, 0.03, z, 0.015, 0.08, 0.75, C(K.WOOD)); g.box(x + 0.42, 0.03, z, 0.015, 0.08, 0.75, C(K.WOOD));
      for (let i = 0; i < n; i++) g.anim(kind, 0, 0.045, 0, { m: 'wander', cx: x, cz: z, rx: 0.28, rz: 0.24, sp: 0.07, stop: 0.3, seed: g.rnd() * 40 });
    }
    for (let i = 0; i < 3; i++) g.anim('duck', 0, 0.05, 0, { cx: -0.6, cz: 0.6, rx: 0.3, rz: 0.3, sp: 0.05, seed: g.rnd() * 30 });
    trees(g, 8, -1.3, -1.3, 1.3, 1.3, 0.8, 0);
    g.box(0, 0.03, 1.25, 0.6, 0.22, 0.2, C('#c99e5c'));
    walkers(g, 5, [[0, 1.1], [0, -0.1], [-0.2, -0.1], [-0.2, 0.1], [0.1, 0.1], [0.1, 1.1]], { y: 0.03, sp: 0.06 });
  },
  stadium(g, v, W, D, H, b) {
    pad(g, W, D, '#bfc4c8');
    g.box(0, 0.03, 0, 1.6, 0.03, 1.1, C(v.roofColor));
    g.box(0, 0.06, 0, 1.4, 0.006, 0.02, C(K.WHITE)); g.cyl(0, 0.06, 0, 0.14, 0.004, C(K.WHITE));
    g.prim(TPL.torus(0.32), 0, H * 0.55, 0, 1.12, H * 1.0, 0.95, C(v.color));
    g.prim(TPL.torus(0.12), 0, H * 0.98, 0, 1.1, 0.6, 0.94, C('#e8ecef'));
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) { g.cyl(x, 0, z, 0.03, 1.4, C(K.STEEL)); g.box(x, 1.4, z, 0.22, 0.1, 0.05, C('#fff6c8'), { layer: 'glow', ry: Math.atan2(x, z) }); g.lamp(x, 1.45, z, 1, '#fff6d8'); }
    // match en cours : 22 joueurs, un ballon
    const f = { rx: 0.7, rz: 0.45, seed: g.rnd() * 9 };
    for (let i = 0; i < 22; i++) {
      const team = i < 11 ? -1 : 1, k = i % 11;
      const hx = k === 0 ? team * 0.66 : team * (0.12 + 0.18 * Math.floor((k - 1) / 4)), hz = k === 0 ? 0 : (((k - 1) % 4) - 1.5) * 0.22;
      g.anim('person', 0, 0.06, 0, { m: 'player', f, hx, hz, seed: i * 2.3, lag: 0.15 + (k % 4) * 0.12, keeper: k === 0, s: 0.8, color: team < 0 ? '#d64a3a' : '#f2f2f2' });
    }
    g.anim('ball', 0, 0.06, 0, { f });
    if (hasUp(b, 'stadium_screens')) {
      g.prim(TPL.torus(0.2), 0, H * 1.15, 0, 1.0, 0.25, 0.78, C('#d9dde2'));
      for (const s of [-1, 1]) { g.box(s * 1.05, H * 0.9, 0, 0.04, 0.32, 0.55, C('#1d2a3a'), { ry: 0 }); g.box(s * 1.03, H * 0.92, 0, 0.01, 0.27, 0.5, C('#62e6f7'), { layer: 'glow' }); }
    }
    g.pool(0, 0, 1.0, '#f4f8ff');
  },
  vertical_garden(g, v, W, D, H) {
    pad(g, W, D, '#9cc480');
    g.box(0, 0, 0, 0.56, H, 0.56, C('#a0a8a6'));
    bands(g, 0, 0, 0.56, 0.56, 0, H, false);
    for (let i = 0; i < 46; i++) {
      const side = (g.rnd() * 4) | 0, t = (g.rnd() - 0.5) * 0.5, y = g.rnd() * (H - 0.1);
      const x = side === 0 ? 0.29 : side === 1 ? -0.29 : t, z = side === 2 ? 0.29 : side === 3 ? -0.29 : t;
      g.box(x, y, z, side < 2 ? 0.07 : 0.16, 0.12, side < 2 ? 0.16 : 0.07, C(g.rnd() < 0.5 ? '#5f9e46' : '#7dbb5f'));
    }
    g.box(0, H, 0, 0.6, 0.05, 0.6, C(v.roofColor)); g.tree(0, 0, 0.6, 0, H + 0.05);
  },
  holo_park(g, v, W, D) {
    pad(g, W, D, v.color);
    g.box(0, 0.031, 0, 0.1, 0.01, D - 0.1, C('#7ff0e8'), { layer: 'glow' }); g.box(0, 0.031, 0, W - 0.1, 0.01, 0.1, C('#7ff0e8'), { layer: 'glow' });
    g.anim('holoRing', 0.45, 0.4, -0.45, { r: 0.25, spin: 1.2, tilt: 1.3, color: '#7ff0e8' });
    g.anim('holoRing', -0.45, 0.3, 0.45, { r: 0.18, spin: -0.9, tilt: 0.4, color: '#c58bff' });
    g.cyl(-0.45, 0.03, -0.45, 0.02, 0.6, C('#7ff0e8'), { layer: 'glow' }); g.sphere(-0.45, 0.66, -0.45, 0.08, C('#c58bff'), { layer: 'glow' });
    trees(g, 4, 0.2, 0.2, 0.85, 0.85, 0.8, 3); trees(g, 2, -0.9, -0.2, -0.6, 0.1, 0.8);
    crowd(g, 4, 0, 0, 0.6, 0.6, { y: 0.03, sp: 0.12, stop: 0.5 });
  },
  /* Services publics */
  city_hall(g, v, W, D, H, b) {
    pad(g, W, D, '#ddd3bd');
    g.box(0, 0, -0.25, 1.6, 0.06, 1.1, C('#e3d9c2'));
    g.box(0, 0.06, -0.3, 1.5, H * 0.55, 0.9, C(v.color));
    frontWins(g, 0, -0.3, 1.5, 0.9, H * 0.2, 7); frontWins(g, 0, -0.3, 1.5, 0.9, H * 0.42, 7);
    g.box(0, 0.06 + H * 0.55, -0.3, 1.54, 0.05, 0.94, C('#cfc3a8'));
    g.box(0, 0.06, -0.3, 0.55, H * 0.8, 0.6, C(v.color));
    g.hemi(0, 0.06 + H * 0.8, -0.3, 0.27, C(v.roofColor));
    g.cyl(0, 0.06 + H * 0.8 + 0.27, -0.3, 0.012, 0.15, C(K.STEEL));
    for (let i = 0; i < 4; i++) g.cyl(-0.2 + i * 0.133, 0.06, 0.17, 0.035, H * 0.5, C('#f4efe2'), { seg: 8 });
    g.box(0, 0.06 + H * 0.5, 0.15, 0.6, 0.05, 0.1, C('#efe6d1'));
    g.cyl(0.6, 0, 0.6, 0.012, 0.75, C(K.STEEL));
    for (const [i, col] of [[0, '#2f4fa8'], [1, '#f4f4f4'], [2, '#d6403a']]) g.box(0.6 + 0.04 + i * 0.07, 0.6, 0.6, 0.07, 0.13, 0.01, C(col));
    g.box(0, 0.03, 0.55, 1.2, 0.012, 0.6, C('#d6cdb8'));
    fountain(g, -0.45, 0.6, 0.16, 'dance', { h: 0.16 });
    crowd(g, 4, 0.1, 0.6, 0.45, 0.2, { y: 0.03, sp: 0.15, stop: 0.6 });
    g.pool(0, 0.4, 0.7, '#fff1c4');
    if (hasTech('municipal_copilot')) g.anim('holoBars', 0, 0.06 + H * 0.8 + 0.45, -0.3, { ph: 0 });
  },
  police(g, v, W, D, H) {
    pad(g, W, D, PLOT.services);
    g.box(0, 0, -0.35, 1.5, H, 0.9, C(v.color)); roofOf(g, v, 0, -0.35, 1.5, 0.9, H, 'flat');
    bands(g, 0, -0.35, 1.5, 0.9, 0, H, false);
    g.box(0, H * 0.8, -0.35, 1.52, 0.06, 0.92, C(v.roofColor));
    g.box(-0.3, H + 0.04, -0.2, 0.1, 0.06, 0.06, C('#4f8dff'), { layer: 'glow' }); g.box(-0.18, H + 0.04, -0.2, 0.1, 0.06, 0.06, C('#ff4f4f'), { layer: 'glow' });
    parking(g, 0, 0.55, 1.6, 0.5, 5);
    car(g, -0.6, 0.55, 0, '#f2f4f6'); car(g, 0.6, 0.55, 0, '#f2f4f6');
  },
  police_post(g, v, W, D, H) {
    pad(g, W, D, PLOT.services);
    g.box(0, 0, -0.08, 0.66, H, 0.56, C(v.color)); roofOf(g, v, 0, -0.08, 0.66, 0.56, H, 'flat');
    g.box(0, H * 0.7, -0.08, 0.68, 0.05, 0.58, C(v.roofColor)); frontWins(g, 0, -0.08, 0.66, 0.56, H * 0.4, 2);
    door(g, 0, 0.2); g.box(0, H + 0.04, 0, 0.08, 0.05, 0.05, C('#4f8dff'), { layer: 'glow' });
    car(g, 0.33, 0.36, Math.PI / 2, '#f2f4f6');
  },
  fire(g, v, W, D, H) {
    pad(g, W, D, '#cfc6b8');
    g.box(-0.15, 0, -0.25, 1.4, H, 1.1, C(v.color)); roofOf(g, v, -0.15, -0.25, 1.4, 1.1, H, 'flat');
    for (let i = 0; i < 3; i++) g.box(-0.6 + i * 0.42, 0.02, 0.305, 0.32, 0.36, 0.02, C(v.roofColor));
    bands(g, -0.15, -0.25, 1.4, 1.1, 0.42, H, false);
    g.box(0.72, 0, -0.55, 0.3, H + 0.7, 0.3, C(v.color)); g.box(0.72, H + 0.7, -0.55, 0.34, 0.05, 0.34, C(v.roofColor));
    truck(g, -0.6, 0.6, 0, '#c8392f'); truck(g, -0.18, 0.6, 0, '#c8392f');
    g.pool(-0.2, 0.55, 0.6, '#fff1c4');
  },
  fire_post(g, v, W, D, H) {
    pad(g, W, D, '#cfc6b8');
    g.box(-0.08, 0, -0.08, 0.6, H, 0.6, C(v.color)); roofOf(g, v, -0.08, -0.08, 0.6, 0.6, H, 'flat');
    g.box(-0.08, 0.02, 0.225, 0.3, 0.32, 0.02, C(v.roofColor));
    g.box(0.3, 0, -0.3, 0.18, H + 0.3, 0.18, C(v.color));
    truck(g, -0.08, 0.2, 0, '#c8392f', 0.26);
  },
  clinic(g, v, W, D, H) {
    pad(g, W, D, PLOT.services);
    g.box(0, 0, -0.06, 0.72, H, 0.62, C(v.color)); roofOf(g, v, 0, -0.06, 0.72, 0.62, H, 'flat');
    bands(g, 0, -0.06, 0.72, 0.62, 0, H, false);
    g.box(0, H * 0.45, 0.255, 0.18, 0.06, 0.02, C(v.roofColor), { layer: 'glow' }); g.box(0, H * 0.45 - 0.06, 0.255, 0.06, 0.18, 0.02, C(v.roofColor), { layer: 'glow' });
    truck(g, 0.2, 0.38, Math.PI / 2, K.WHITE, 0.24);
  },
  hospital(g, v, W, D, H) {
    pad(g, W, D, PLOT.services);
    g.box(0, 0, -0.45, 2.3, H * 0.4, 1.5, C(v.color)); bands(g, 0, -0.45, 2.3, 1.5, 0, H * 0.4, false);
    g.box(-0.25, 0, -0.55, 1.4, H, 0.9, C(v.color)); bands(g, -0.25, -0.55, 1.4, 0.9, 0, H, false);
    g.box(-0.25, H, -0.55, 1.44, 0.05, 0.94, C('#d8dde2'));
    g.cyl(-0.25, H + 0.05, -0.55, 0.36, 0.03, C('#3a4048'), { seg: 16 });
    g.box(-0.35, H + 0.081, -0.55, 0.04, 0.005, 0.3, C(K.WHITE)); g.box(-0.15, H + 0.081, -0.55, 0.04, 0.005, 0.3, C(K.WHITE));
    g.box(-0.25, H + 0.081, -0.55, 0.24, 0.005, 0.04, C(K.WHITE));
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.box(-0.25 + Math.cos(a) * 0.33, H + 0.085, -0.55 + Math.sin(a) * 0.33, 0.03, 0.02, 0.03, C('#3dff7a'), { layer: 'glow' }); }
    g.box(-0.25, H * 0.7, -0.09, 0.25, 0.08, 0.02, C(v.roofColor), { layer: 'glow' }); g.box(-0.25, H * 0.7 - 0.085, -0.09, 0.08, 0.25, 0.02, C(v.roofColor), { layer: 'glow' });
    g.box(0.75, 0, 0.55, 0.7, 0.32, 0.5, C(v.color)); g.box(0.75, 0.32, 0.75, 0.8, 0.03, 0.3, C(v.roofColor));
    truck(g, 0.55, 1.15, Math.PI / 2, K.WHITE, 0.26); truck(g, 1.0, 1.15, Math.PI / 2, K.WHITE, 0.26);
    parking(g, -0.65, 1.05, 1.1, 0.5, 5);
    crowd(g, 3, -0.3, 0.55, 0.4, 0.08, { y: 0.03, sp: 0.15 });
    g.anim('beacon', 0.3, H + 0.08, -0.95, { ph: g.rnd() });
  },
  school(g, v, W, D, H) {
    pad(g, W, D, '#c9c1ad');
    const wh = blk(g, v, -0.2, -0.45, 1.3, 0.62, H + 0.2, { win: false });
    frontWins(g, -0.2, -0.45, 1.3, 0.62, wh * 0.45, 6);
    blk(g, v, 0.6, 0.05, 0.5, 0.75, H + 0.15, { win: false });
    g.box(-0.3, 0.03, 0.45, 0.9, 0.015, 0.6, C('#d26b4e'));
    g.box(-0.3, 0.046, 0.45, 0.85, 0.004, 0.02, C(K.WHITE));
    for (const s of [-1, 1]) g.box(-0.3 + s * 0.4, 0.03, 0.45, 0.02, 0.18, 0.02, C(K.WHITE));
    crowd(g, 6, -0.3, 0.45, 0.38, 0.22, { m: 'kid', s: 0.7, y: 0.045, sp: 0.5 });
    g.tree(0.75, 0.75, 0.8);
  },
  high_school(g, v, W, D, H) {
    pad(g, W, D, '#c9c1ad');
    blk(g, v, -0.1, -0.4, 1.5, 0.8, H + 0.25, { roof: 'gable' });
    g.box(-0.1, 0.02, 0.0, 0.3, 0.2, 0.02, C(K.DARK));
    g.box(0, 0.03, 0.55, 1.5, 0.015, 0.6, C('#3f7fb8'));
    g.box(0, 0.046, 0.55, 1.4, 0.004, 0.02, C(K.WHITE));
    for (const s of [-1, 1]) g.box(s * 0.62, 0.03, 0.55, 0.02, 0.2, 0.12, C(K.WHITE));
    const f = { rx: 0.6, rz: 0.22, seed: g.rnd() * 9 };
    for (let i = 0; i < 8; i++) g.anim('person', 0, 0.045, 0.55, { m: 'player', f, hx: (i < 4 ? -1 : 1) * (0.15 + 0.12 * (i % 4)), hz: ((i % 3) - 1) * 0.12, seed: i * 1.9, lag: 0.2 + (i % 4) * 0.1, s: 0.8, color: i < 4 ? '#e2b13c' : '#3f9a5a' });
    g.anim('ball', 0, 0.045, 0.55, { f });
  },
  university(g, v, W, D, H) {
    pad(g, W, D, '#cfc6b1');
    g.box(0, 0, 1.0, 2.6, 0.015, 0.9, C(K.LAWN));
    g.box(0, 0, -0.75, 1.4, H * 0.75, 1.0, C(v.color)); bands(g, 0, -0.75, 1.4, 1.0, 0, H * 0.75, false);
    for (let i = 0; i < 6; i++) g.cyl(-0.5 + i * 0.2, 0, -0.22, 0.04, H * 0.6, C('#f4efe2'), { seg: 8 });
    g.gable(0, H * 0.75, -0.2, 1.2, 0.25, 0.15, C(v.color));
    g.cyl(0, H * 0.75, -0.8, 0.4, 0.25, C(v.color), { seg: 16 }); g.hemi(0, H * 0.75 + 0.25, -0.8, 0.4, C(v.roofColor));
    for (const s of [-1, 1]) { g.box(s * 1.05, 0, -0.2, 0.6, H * 0.55, 2.0, C(v.color)); bands(g, s * 1.05, -0.2, 0.6, 2.0, 0, H * 0.55, false); g.box(s * 1.05, H * 0.55, -0.2, 0.64, 0.04, 2.04, C(v.roofColor)); }
    trees(g, 6, -0.6, 0.6, 0.6, 1.3, 0.9, 2);
    walkers(g, 5, loopPath(-0.65, 0.55, 0.65, 1.3), { y: 0.03, sp: 0.08 });
    crowd(g, 3, 0, 1.0, 0.5, 0.2, { y: 0.03, sp: 0.1, stop: 0.6 });
  },
  library(g, v, W, D, H) {
    pad(g, W, D, '#d8cfb8');
    g.box(0, 0, -0.05, 0.74, 0.05, 0.66, C('#e3d9c2'));
    g.box(0, 0.05, -0.12, 0.62, H * 0.62, 0.46, C(v.color));
    for (let i = 0; i < 4; i++) g.cyl(-0.24 + i * 0.16, 0.05, 0.19, 0.03, H * 0.62, C('#f4efe2'), { seg: 8 });
    g.box(0, 0.05 + H * 0.62, -0.05, 0.66, 0.04, 0.6, C(v.color));
    g.gable(0, 0.09 + H * 0.62, -0.05, 0.68, 0.18, 0.62, C(v.roofColor));
    standing(g, [[-0.3, 0.38, 0], [0.32, 0.4, 0.4]], { y: 0.03 });
  },
  fire_drone(g, v, W, D, H) {
    pad(g, W, D, '#cfc6b8');
    g.box(0, 0, -0.2, 1.5, H, 1.2, C(v.color)); bands(g, 0, -0.2, 1.5, 1.2, 0.4, H, false);
    for (let i = 0; i < 3; i++) g.box(-0.5 + i * 0.5, 0.02, 0.405, 0.36, 0.34, 0.02, C(v.roofColor));
    g.box(0, H, -0.2, 1.54, 0.04, 1.24, C('#3a4048'));
    for (const x of [-0.4, 0.4]) g.cyl(x, H + 0.04, -0.2, 0.3, 0.012, C(v.roofColor));
    const c = g.world(0, H, -0.2);
    for (let k = 0; k < 2; k++) g.sink && g.sink.world.push({ kind: 'drone', d: { m: 'patrol', c: [c.x, c.y, c.z], r: 1.4 + k * 0.6, ph: k * 3 } });
  },
  health_ai(g, v, W, D, H) {
    pad(g, W, D, '#d9e6ea');
    g.cyl(-0.2, 0, -0.2, 0.62, H, C(v.color), { seg: 20 });
    for (let y = 0.15; y < H - 0.1; y += 0.26) g.cyl(-0.2, y, -0.2, 0.63, 0.16, C('#5c9fc4'), { seg: 20, layer: lay(g) });
    g.cyl(-0.2, H, -0.2, 0.65, 0.04, C(v.roofColor), { seg: 20 });
    g.anim('holoRing', -0.2, H + 0.15, -0.2, { r: 0.4, spin: 0.7, color: v.roofColor });
    g.box(-0.2, H + 0.22, -0.2, 0.22, 0.06, 0.06, C(v.roofColor), { layer: 'glow' }); g.box(-0.2, H + 0.14, -0.2, 0.06, 0.22, 0.06, C(v.roofColor), { layer: 'glow' });
    g.box(0.55, 0, 0.45, 0.6, 0.4, 0.6, C(K.WHITE)); g.box(0.55, 0.4, 0.45, 0.64, 0.03, 0.64, C(v.roofColor));
  },
  /* Logistique */
  warehouse(g, v, W, D, H) {
    pad(g, W, D, PLOT.logistics);
    g.box(0, 0, -0.35, W - 0.2, H, 1.0, C(v.color)); g.gable(0, H, -0.35, W - 0.15, 0.12, 1.05, C(v.roofColor));
    for (let i = 0; i < 4; i++) g.box(-0.6 + i * 0.4, 0.03, 0.155, 0.26, 0.24, 0.02, C('#6a6d70'));
    g.anim('lorry', 0, 0.03, 0, { path: [[-0.6, 0.85], [-0.6, 0.42]], sp: 0.12, dwell: 4, ph: g.rnd(), reverse: true, color: '#e6e8ea' }, 0);
    g.anim('lorry', 0, 0.03, 0, { path: [[0.2, 0.85], [0.2, 0.42]], sp: 0.12, dwell: 5, ph: g.rnd(), reverse: true, color: '#3f6fb0' }, 0);
    g.anim('forklift', 0, 0.03, 0, { path: [[-0.2, 0.3], [0.6, 0.3]], sp: 0.2, dwell: 1, ph: g.rnd(), reverse: true });
    g.pool(-0.2, 0.55, 0.6);
  },
  warehouse_auto(g, v, W, D, H) {
    pad(g, W, D, '#c7ccd0');
    g.box(0, 0, -0.3, W - 0.2, H, 1.1, C(v.color)); roofOf(g, v, 0, -0.3, W - 0.2, 1.1, H, 'flat');
    g.box(0, H * 0.4, -0.3, W - 0.18, 0.03, 1.12, C(v.roofColor), { layer: 'glow' });
    for (let i = 0; i < 3; i++) g.box(-0.5 + i * 0.5, 0.03, 0.255, 0.32, 0.26, 0.02, C('#6a6d70'));
    g.box(0.65, 0.03, 0.6, 0.16, 0.05, 0.16, C('#5a5f66'));
    g.anim('robotArm', 0.65, 0.08, 0.6, { ph: g.rnd() * 6, s: 1.2, color: v.roofColor });
    for (let i = 0; i < 4; i++) g.anim('agv', 0, 0.03, 0, { path: loopPath(-0.75, 0.4, 0.4, 0.8), sp: 0.2, ph: i / 4, color: v.roofColor });
  },
  micro_hub(g, v, W, D, H) {
    pad(g, W, D, PLOT.logistics);
    g.box(0, 0, -0.1, 0.7, H, 0.55, C(v.color)); roofOf(g, v, 0, -0.1, 0.7, 0.55, H, 'flat');
    g.box(0, 0.02, 0.18, 0.4, 0.26, 0.02, C('#6a6d70'));
    for (let i = 0; i < 6; i++) g.box(-0.3 + (i % 3) * 0.1, 0.03 + ((i / 3) | 0) * 0.08, 0.36, 0.09, 0.075, 0.09, C(v.roofColor));
    g.box(0.3, 0.03, 0.36, 0.06, 0.1, 0.18, C('#3f9a5a'));
    const h = g.world(0, H + 0.08, -0.1);
    for (let k = 0; k < 2; k++) g.sink && g.sink.world.push({ kind: 'drone', d: { h: [h.x, h.y, h.z], k: k + 7, ph: k * 0.5 + g.rnd() * 0.2, far: true } });
  },
  robot_depot(g, v, W, D, H) {
    pad(g, W, D, PLOT.logistics);
    g.box(0, 0, -0.12, 0.7, H, 0.55, C(v.color)); roofOf(g, v, 0, -0.12, 0.7, 0.55, H, 'flat');
    g.box(0, 0.02, 0.16, 0.5, 0.18, 0.02, C('#3a4048'));
    for (let i = 0; i < 5; i++) { const x = -0.3 + i * 0.15, z = 0.32 + (i % 2) * 0.07; g.box(x, 0.03, z, 0.08, 0.07, 0.1, C(K.WHITE)); g.box(x, 0.07, z + 0.05, 0.05, 0.015, 0.005, C('#7fffb0'), { layer: 'glow' }); }
  },
  drone_hub(g, v, W, D, H) {
    pad(g, W, D, PLOT.logistics);
    g.box(0, 0, 0, 0.66, H, 0.66, C(v.color)); bands(g, 0, 0, 0.66, 0.66, 0, H, false);
    g.box(0, H, 0, 0.74, 0.04, 0.74, C('#3a4048')); g.cyl(0, H + 0.04, 0, 0.3, 0.01, C(v.roofColor));
    for (let k = 0; k < 4; k++) g.box(Math.cos(k * 1.57) * 0.3, H + 0.045, Math.sin(k * 1.57) * 0.3, 0.03, 0.01, 0.03, C('#62e6f7'), { layer: 'glow' });
    const h = g.world(0, H + 0.1, 0);
    for (let k = 0; k < 5; k++) g.sink && g.sink.world.push({ kind: 'drone', d: { h: [h.x, h.y, h.z], k, ph: k / 5 + g.rnd() * 0.05, far: true } });
  },
  /* Déchets */
  waste_depot(g, v, W, D, H, b) {
    pad(g, W, D, PLOT.waste);
    g.box(0, 0, -0.35, 1.5, H, 0.9, C(v.color)); roofOf(g, v, 0, -0.35, 1.5, 0.9, H, 'flat');
    for (let i = 0; i < 3; i++) g.box(-0.5 + i * 0.5, 0.02, 0.105, 0.36, 0.3, 0.02, C('#6a6d70'));
    const n = hasUp(b, 'waste_trucks') ? 3 : 2, col = hasUp(b, 'waste_electric') ? '#7fd6a0' : '#3f8a4c';
    for (let i = 0; i < n; i++) g.anim('lorry', 0, 0.03, 0, { path: [[-0.5 + i * 0.5, 0.85], [-0.5 + i * 0.5, 0.36]], sp: 0.1, dwell: 3 + i, ph: i * 0.3, reverse: true, color: col });
    if (hasUp(b, 'waste_electric')) for (let i = 0; i < 3; i++) { g.box(-0.5 + i * 0.5, 0.03, 0.2, 0.04, 0.12, 0.04, C('#3a4048')); g.box(-0.5 + i * 0.5, 0.15, 0.2, 0.05, 0.02, 0.05, C('#62e6f7'), { layer: 'glow' }); }
  },
  landfill(g, v, W, D, H, b) {
    pad(g, W, D, '#8d7a55');
    fence(g, W, D, 0.1, '#6d6a62');
    g.box(0, 0.03, D / 2 - 0.15, 0.4, 0.015, 0.2, C('#6e6658'));
    g.box(0.75, 0.03, D / 2 - 0.25, 0.4, 0.2, 0.25, C('#d9dccf')); g.box(0.75, 0.23, D / 2 - 0.25, 0.44, 0.03, 0.29, C('#4f8a4c'));
    const lf = { b, base: g.base.clone(), W, D };
    if (g.sink) g.sink.landfills.push(lf);
    b.fill ??= 0.35;
    g.anim('bulldozer', 0, 0, 0, { path: [[-0.5, -0.35], [0.35, 0.15]], sp: 0.12, dwell: 1, ph: g.rnd(), reverse: true, lf });
    const nt = hasUp(b, 'waste_trucks') ? 3 : 2;
    for (let i = 0; i < nt; i++) g.anim('lorry', 0, 0, 0, { path: [[0.05 * i, D / 2 - 0.12], [0.05 * i, 0.3], [-0.25 + 0.2 * i, -0.1]], sp: 0.14, dwell: 2.5, ph: i * 0.37, reverse: false, lf, color: '#3f8a4c' });
    for (let i = 0; i < (hasUp(b, 'landfill_gas') ? 3 : 7); i++) g.anim('gull', 0, 0, 0, { cx: -0.1, cz: -0.1, r: 0.35 + g.rnd() * 0.5, y: 1.0 + g.rnd() * 0.6, sp: 0.5 + g.rnd() * 0.4, ph: g.rnd() * 6 });
    if (hasUp(b, 'landfill_gas')) { // captage du biogaz : torchère
      g.cyl(-1.15, 0, D / 2 - 0.25, 0.04, 0.7, C(K.STEEL));
      g.anim('flame', -1.15, 0.71, D / 2 - 0.25, { ph: 3, s: 1 });
      g.tube(-1.15, 0.08, D / 2 - 0.25, -0.4, 0.08, D / 2 - 0.25, 0.02, C('#e2b13c'));
    }
  },
  incinerator(g, v, W, D, H, b) {
    pad(g, W, D, PLOT.waste);
    g.box(-0.2, 0, -0.2, 1.2, H, 1.1, C(v.color)); roofOf(g, v, -0.2, -0.2, 1.2, 1.1, H, 'flat');
    g.box(0.15, 0, -0.2, 0.5, H + 0.35, 0.7, C('#b5b0a7'));
    const filt = hasUp(b, 'incinerator_filters');
    if (filt) { g.cyl(0.62, 0, -0.1, 0.12, 1.2, C('#d9dde2')); g.hemi(0.62, 1.2, -0.1, 0.12, C('#9aa3ab')); }
    stack(g, 0.6, -0.6, 0.12, 2.4, { col: '#d9d6cf', band: '#7b6f62', smoke: filt ? 'steamS' : 'smoke', k: filt ? 0.8 : 1.3 });
    g.box(-0.4, 0.02, 0.355, 0.4, 0.3, 0.02, C('#6a6d70'));
    g.anim('lorry', 0, 0.03, 0, { path: [[-0.4, 0.85], [-0.4, 0.5]], sp: 0.1, dwell: 4, ph: g.rnd(), reverse: true, color: '#3f8a4c' });
    if (hasUp(b, 'incinerator_heat')) { g.tube(-0.75, 0.35, 0.45, -0.75, 0.35, 0.95, 0.04, C('#c8463a'), { seg: 6 }); g.tube(-0.62, 0.35, 0.45, -0.62, 0.35, 0.95, 0.04, C('#3f6fb0'), { seg: 6 }); }
  },
  recycling(g, v, W, D, H, b) {
    pad(g, W, D, PLOT.waste);
    g.box(-0.4, 0, -0.6, 2.0, H, 1.4, C(v.color)); roofOf(g, v, -0.4, -0.6, 2.0, 1.4, H, 'flat');
    g.box(-0.4, H * 0.6, 0.11, 1.6, 0.12, 0.02, C(v.roofColor));
    g.tube(1.05, 0.03, 0.2, 1.05, 0.5, -0.8, 0.04, C(K.DARK));
    for (let k = 0; k < 6; k++) g.anim('beltBox', 0, 0, 0, { a: [1.05, 0.06, 0.2], b: [1.05, 0.52, -0.8], n: 6, k, sp: 0.15, drop: true });
    const cols = ['#3f9a5a', '#2f6fb0', '#e2b13c', '#c8463a', '#9a9a9a'];
    for (let i = 0; i < 10; i++) g.box(-1.1 + (i % 5) * 0.3, 0.03 + ((i / 5) | 0) * 0.15, 0.85, 0.24, 0.14, 0.24, C(cols[i % 5]));
    for (let i = 0; i < 3; i++) g.box(0.6 + i * 0.32, 0.03, 0.85, 0.26, 0.18, 0.4, C(cols[i]));
    if (hasUp(b, 'recycling_optical')) { g.box(1.05, 0.35, -0.3, 0.3, 0.03, 0.06, C(K.DARK)); g.box(1.05, 0.33, -0.3, 0.2, 0.01, 0.04, C('#62e6f7'), { layer: 'glow' }); }
    if (hasTech('robot_sorting')) for (let i = 0; i < 2; i++) g.anim('robotArm', 0.82, 0.03, -0.1 - i * 0.4, { ph: i * 2, sp: 1.6, color: '#48c7a8' });
    g.anim('forklift', 0, 0.03, 0, { path: [[-1.1, 0.6], [0.3, 0.6]], sp: 0.22, dwell: 1, ph: g.rnd(), reverse: true });
  },
  biogas(g, v, W, D, H) {
    pad(g, W, D, PLOT.waste);
    for (const x of [-0.45, 0.3]) { g.cyl(x, 0, -0.35, 0.36, 0.35, C('#c9cdb8')); g.hemi(x, 0.35, -0.35, 0.36, C(v.roofColor)); }
    g.hemi(0.5, 0, 0.45, 0.3, C('#e8e4d6'));
    g.box(-0.4, 0, 0.45, 0.7, 0.4, 0.5, C(v.color)); roofOf(g, v, -0.4, 0.45, 0.7, 0.5, 0.4, 'flat');
    g.tube(-0.45, 0.25, -0.35, 0.3, 0.25, -0.35, 0.03, C(K.STEEL));
    g.cyl(0.85, 0, -0.8, 0.03, 0.55, C(K.STEEL)); g.anim('flame', 0.85, 0.56, -0.8, { ph: 1.3, s: 0.8 });
  },
  valorisation(g, v, W, D, H) {
    pad(g, W, D, '#d6e2e4');
    g.box(-0.45, 0, -0.5, 1.8, H * 0.6, 1.5, C(v.color)); g.box(-0.45, H * 0.6, -0.5, 1.84, 0.04, 1.54, C(v.roofColor));
    g.box(-0.45, H * 0.3, -0.5, 1.82, 0.04, 1.52, C(v.roofColor), { layer: 'glow' });
    g.cyl(0.5, 0, -0.5, 0.42, H, C(K.WHITE), { seg: 18 }); g.hemi(0.5, H, -0.5, 0.42, C(v.roofColor));
    glowRing(g, 0.5, H * 0.7, -0.5, 0.43, v.roofColor, 0.03);
    for (let i = 0; i < 4; i++) g.box(-1.0 + i * 0.4, 0.03, 0.85, 0.3, 0.2, 0.3, C(['#3f9a5a', '#2f6fb0', '#e2b13c', '#c8463a'][i]));
    if (hasTech('molecular_recycling')) for (let i = 0; i < 3; i++) { g.cyl(-1.0 + i * 0.35, 0, 0.45, 0.1, 0.9, C('#e9f3fb')); g.anim('holoRing', -1.0 + i * 0.35, 0.6, 0.45, { r: 0.12, spin: 2, color: '#c58bff' }); }
    if (hasTech('robot_sorting')) g.anim('robotArm', 0.9, 0.03, 0.85, { ph: 1, sp: 1.5, color: '#48c7a8' });
    g.anim('lorry', 0, 0.03, 0, { path: [[1.2, 1.3], [1.2, 0.6]], sp: 0.1, dwell: 4, ph: g.rnd(), reverse: true, color: '#48c7a8' });
  },
  /* Transports */
  bus_stop(g, v, W, D, H, b) {
    pad(g, W, D, '#c8c3b8');
    g.box(0, 0.03, 0.25, 0.5, 0.18, 0.02, C('#a9cfe0'), { layer: 'lit' });
    for (const s of [-1, 1]) g.box(s * 0.24, 0.03, 0.32, 0.02, 0.2, 0.02, C(K.STEEL));
    g.box(0, 0.23, 0.32, 0.56, 0.025, 0.18, C(v.roofColor));
    g.box(0, 0.03, 0.3, 0.3, 0.05, 0.06, C(K.WOOD));
    g.cyl(0.36, 0.03, 0.42, 0.012, 0.28, C(K.STEEL)); g.box(0.36, 0.28, 0.42, 0.08, 0.08, 0.01, C(K.YELLOW));
    standing(g, [[-0.15, 0.36, 0.2], [0.05, 0.4, -0.3], [0.18, 0.35, 0.5]], { y: 0.03 });
    g.tree(-0.3, -0.25, 0.8, 3); g.tree(0.25, -0.3, 0.7, 0);
    g.pool(0, 0.35, 0.3, '#f4f8ff');
  },
  bus_depot(g, v, W, D, H, b) {
    pad(g, W, D, PLOT.transport);
    g.box(0, 0, -0.45, 1.7, H, 0.85, C(v.color)); roofOf(g, v, 0, -0.45, 1.7, 0.85, H, 'flat');
    for (let i = 0; i < 4; i++) g.box(-0.6 + i * 0.4, 0.02, -0.015, 0.3, 0.3, 0.02, C('#6a6d70'));
    const n = hasUp(b, 'bus_fleet') ? 4 : 2, shuttle = hasTech('autonomous_shuttles');
    for (let i = 0; i < n; i++) {
      const x = -0.6 + i * 0.4;
      g.box(x, 0.03, 0.5, 0.16, 0.18, shuttle ? 0.4 : 0.6, C(shuttle ? '#f4f6f8' : (i % 2 ? K.YELLOW : K.WHITE)));
      g.box(x, 0.12, 0.5, 0.165, 0.05, shuttle ? 0.36 : 0.56, C(K.GLASS), { layer: 'lit' });
      if (shuttle) g.box(x, 0.21, 0.5, 0.12, 0.012, 0.3, C('#62e6f7'), { layer: 'glow' });
    }
  },
  metro_station(g, v, W, D, H, b) {
    pad(g, W, D, '#c9c3b5');
    g.box(0, 0, -0.1, 0.6, H, 0.5, C(v.color)); g.box(0, H, -0.1, 0.66, 0.04, 0.56, C(v.roofColor));
    g.box(0, 0.03, 0.16, 0.5, 0.25, 0.02, C(K.GLASS), { layer: 'lit' });
    g.cyl(0.33, 0.03, 0.35, 0.015, 0.4, C(K.STEEL)); g.box(0.33, 0.43, 0.35, 0.13, 0.13, 0.02, C(v.roofColor), { layer: 'glow' });
    g.box(-0.2, 0.03, 0.35, 0.28, 0.01, 0.22, C('#4a4f56'), { rx: 0.15 });
    for (let i = 0; i < 4; i++) g.anim('person', 0, 0.03, 0, { m: 'commute', path: [[(i % 2 ? 0.45 : -0.45), 0.46], [-0.2, 0.42], [-0.2, 0.22]], sp: 0.1, ph: i / 4, cyc: 9, seed: i * 3 });
    if (hasUp(b, 'metro_long')) g.box(0, H + 0.04, 0.3, 0.6, 0.02, 0.35, C(v.roofColor));
    g.pool(0, 0.35, 0.35, '#f4f8ff');
  },
  tram_stop(g, v, W, D) {
    pad(g, W, D, '#c8c3b8');
    g.box(0, 0.03, 0.22, W - 0.1, 0.06, 0.24, C('#d9d5cc'));
    for (const s of [-1, 1]) g.box(s * 0.26, 0.09, 0.2, 0.02, 0.2, 0.02, C(K.STEEL));
    g.box(0, 0.29, 0.22, 0.6, 0.025, 0.22, C(v.roofColor));
    g.box(0, 0.09, 0.12, 0.55, 0.16, 0.015, C('#a9cfe0'), { layer: 'lit' });
    standing(g, [[-0.2, 0.26, 0], [0.1, 0.28, 0.4]], { y: 0.09 });
    g.tree(-0.3, -0.25, 0.8, 2); g.tree(0.3, -0.25, 0.8, 2);
  },
  tram_depot(g, v, W, D, H) {
    pad(g, W, D, PLOT.transport);
    const along = W >= D, L = Math.max(W, D) - 0.2;
    const hall = (x, z, w, d) => { g.box(x, 0, z, w, H, d, C(v.color)); g.gable(x, H, z, w + 0.04, 0.22, d + 0.04, C(v.roofColor)); };
    if (along) hall(0, -0.35, L, 1.0); else hall(-0.35, 0, 1.0, L);
    for (let i = 0; i < 2; i++) {
      const o = 0.25 + i * 0.28;
      g.box(along ? 0 : o, 0.03, along ? o : 0, along ? L : 0.14, 0.012, along ? 0.14 : L, C('#5a5a58'));
      g.box(along ? -0.3 + i * 0.5 : o, 0.045, along ? o : -0.3 + i * 0.5, along ? 1.2 : 0.13, 0.16, along ? 0.13 : 1.2, C(i ? '#2fae6a' : K.WHITE));
      g.box(along ? -0.3 + i * 0.5 : o, 0.11, along ? o : -0.3 + i * 0.5, along ? 1.15 : 0.135, 0.05, along ? 0.135 : 1.15, C(K.GLASS), { layer: 'lit' });
    }
  },
  train_station(g, v, W, D, H, b) {
    pad(g, W, D, '#cfc6b3');
    const along = W >= D, L = Math.max(W, D);
    g.box(0, 0, -0.25, along ? L - 0.5 : 0.9, H * 0.9, along ? 0.9 : L - 0.5, C(v.color));
    g.gable(0, H * 0.9, -0.25, along ? L - 0.45 : 0.95, 0.3, along ? 0.95 : L - 0.45, C(v.roofColor));
    frontWins(g, 0, -0.25, along ? L - 0.5 : 0.9, along ? 0.9 : L - 0.5, H * 0.35, 6);
    g.box(0, 0, -0.25, 0.4, H * 1.6, 0.4, C(v.color)); g.gable(0, H * 1.6, -0.25, 0.44, 0.2, 0.44, C(v.roofColor));
    g.cyl(0, H * 1.25, -0.04, 0.08, 0.02, C(K.WHITE), { rx: Math.PI / 2, layer: 'lit' });
    // quai le long des voies, marquise
    g.box(0, 0.03, D / 2 - 0.2, L - 0.1, 0.07, 0.38, C('#d9d5cc'));
    g.box(0, 0.08, D / 2 - 0.03, L - 0.12, 0.004, 0.03, C('#f2d24b'));
    g.box(0, 0.32, D / 2 - 0.2, L - 0.2, 0.03, 0.34, C('#6b6f75'));
    for (let i = 0; i < 4; i++) g.box(-L / 2 + 0.3 + i * ((L - 0.6) / 3), 0.1, D / 2 - 0.32, 0.025, 0.22, 0.025, C(K.STEEL));
    if (hasUp(b, 'train_platform')) { g.box(0, 0.32, D / 2 - 0.2, L - 0.2, 0.012, 0.34, C('#62e6f7'), { layer: 'glow' }); }
    if (hasUp(b, 'train_parkride')) { g.box(-L / 2 + 0.4, 0.03, -D / 2 + 0.2, 0.6, 0.01, 0.3, C(K.ASPH)); for (let i = 0; i < 6; i++) g.box(-L / 2 + 0.15 + i * 0.1, 0.035, -D / 2 + 0.2, 0.05, 0.05, 0.13, C(['#c8463a', '#3f6fb0', '#e6e8ea'][i % 3])); for (let i = 0; i < 5; i++) g.box(L / 2 - 0.15 - i * 0.07, 0.03, -D / 2 + 0.15, 0.01, 0.06, 0.08, C('#2fae6a')); }
    for (let i = 0; i < 4; i++) g.lamp(-L / 2 + 0.3 + i * ((L - 0.6) / 3), 0.3, D / 2 - 0.2, 0.5);
    for (let i = 0; i < 4; i++) g.pool(-L / 2 + 0.3 + i * ((L - 0.6) / 3), D / 2 - 0.2, 0.5);
    // voyageurs : config de la gare (repère local du bâtiment)
    if (g.sink) {
      // le train longe la façade (axe x local) ; portes des voitures à l'arrêt, dans le repère de la gare
      const stopL = L / 2 + 0.4;
      const doors = [1, 2, 3, 4].map((k) => stopL - k * 0.72 + 0.1);
      g.sink.station = { b, x0: -L / 2 + 0.25, x1: L / 2 - 0.25, pz: D / 2 - 0.2, dz: D / 2 + 0.33, entry: [0, -0.25 + 0.47], doors, stopL, railLocal: D / 2 + 0.5, base: g.base.clone(), faceTrain: 0 };
      const n = hasUp(b, 'train_platform') ? 30 : 22;
      for (let k = 0; k < n; k++) g.anim('person', 0, 0.1, 0, { m: 'passenger', k, seed: k * 1.3 });
    }
  },
  hyperloop(g, v, W, D, H) {
    pad(g, W, D, '#d6dde3');
    const along = W >= D, L = Math.max(W, D);
    g.box(0, 0, -0.2, along ? L - 0.4 : 1.1, H * 0.6, along ? 1.1 : L - 0.4, C(v.color));
    bands(g, 0, -0.2, along ? L - 0.4 : 1.1, along ? 1.1 : L - 0.4, 0, H * 0.6, true);
    const ty = H * 0.6 + 0.2;
    if (along) g.tube(-L / 2 + 0.05, ty, -0.2, L / 2 - 0.05, ty, -0.2, 0.2, C('#e8eef3'), { seg: 14 });
    else g.tube(0, ty, -L / 2 + 0.05, 0, ty, L / 2 - 0.05, 0.2, C('#e8eef3'), { seg: 14 });
    g.box(0, ty + 0.2, -0.2, along ? L - 0.1 : 0.03, 0.02, along ? 0.03 : L - 0.1, C(v.roofColor), { layer: 'glow' });
    for (let i = -1; i <= 1; i++) g.box(along ? i * 1.0 : 0, 0, along ? -0.2 : i * 1.0, 0.12, H * 0.6, 0.12, C(K.STEEL));
    g.anim('agv', 0, ty + 0.05, 0, { path: along ? [[-L / 2 + 0.2, -0.2], [L / 2 - 0.2, -0.2]] : [[0, -L / 2 + 0.2], [0, L / 2 - 0.2]], closed: false, sp: 0.8, color: '#62e6f7' });
  },
  seaport(g, v, W, D, H, b) {
    pad(g, W, D, '#a9adb0');
    const ws = b.waterLocal || [1, 0];
    const [wx, wz] = ws;
    const L = wx ? D : W;
    g.box(wx * (W / 2 - 0.1), -0.5, wz * (D / 2 - 0.1), wx ? 0.25 : L, 0.55, wz ? 0.25 : L, C('#8d9196'));
    for (let i = 0; i < 2; i++) {
      const t = -L / 2 + 1.05 + i * (L - 1.7);
      const cx = wx ? wx * (W / 2 - 0.3) : t, cz = wz ? wz * (D / 2 - 0.3) : t;
      for (const s of [-1, 1]) g.box(cx + (wz ? s * 0.16 : 0), 0, cz + (wx ? s * 0.16 : 0), 0.045, 0.95, 0.045, C('#c8463a'));
      g.box(cx + wx * 0.4, 0.95, cz + wz * 0.4, wx ? 1.2 : 0.36, 0.08, wz ? 1.2 : 0.36, C('#c8463a'));
      g.box(cx - wx * 0.1, 0.95, cz - wz * 0.1, wx ? 0.25 : 0.3, 0.14, wz ? 0.25 : 0.3, C('#d9dcdd'));
      // chariot et conteneur qui vont du navire au quai quand le navire est à quai (axe local +x → vers l'intérieur)
      const ry = Math.atan2(-wz, -wx) - Math.PI / 2 + Math.PI / 2;
      g.anim('craneTrolley', cx, 0.93, cz, { ph: i * 0.37 }, Math.atan2(wz, -wx) * 0 + (wx ? (wx > 0 ? Math.PI : 0) : (wz > 0 ? Math.PI / 2 : -Math.PI / 2)));
      g.anim('craneBox', cx, 0.93, cz, { ph: i * 0.37 }, (wx ? (wx > 0 ? Math.PI : 0) : (wz > 0 ? Math.PI / 2 : -Math.PI / 2)));
      g.anim('beacon', cx + wx * 0.95, 1.05, cz + wz * 0.95, { ph: i * 0.4 });
      void ry;
    }
    containerStack(g, -wx * 0.15, -wz * 0.15, wx ? 2 : 4, wx ? 5 : 3, 3, 0);
    g.box(-wx * 0.75 + (wz ? 0.5 : 0), 0, -wz * 0.68 + (wx ? 0.6 : 0), 0.6, 0.45, 0.6, C(v.color)); // bureaux du port, dans l'emprise
    g.anim('lorry', 0, 0.03, 0, { path: wx ? [[-0.6, -1.2], [-0.6, 1.2]] : [[-1.2, -0.6], [1.2, -0.6]], sp: 0.18, dwell: 3, ph: g.rnd(), color: '#2f6fb0' });
    if (g.sink && b.water >= 0) {
      const berth = g.world(wx * (W / 2 + 0.47), 0, wz * (D / 2 + 0.47)), [WX, WZ] = DIR4[b.water];
      g.sink.port = { bx: berth.x, bz: berth.z, wx: WX, wz: WZ, reach: 14 };
    }
    for (let i = 0; i < 3; i++) g.anim('gull', 0, 0, 0, { cx: wx * 1.2, cz: wz * 1.2, r: 0.5 + g.rnd() * 0.5, y: 1.1 + g.rnd() * 0.4, sp: 0.5 + g.rnd() * 0.3, ph: g.rnd() * 6 });
  },
  airport(g, v, W, D, H) {
    pad(g, W, D, '#9fb58a');
    g.box(0, 0.03, -1.3, W - 0.2, 0.015, 0.7, C(v.roofColor));
    for (let i = 0; i < 9; i++) g.box(-1.6 + i * 0.4, 0.046, -1.3, 0.22, 0.004, 0.035, C(K.WHITE));
    for (let i = 0; i < 12; i++) { const x = -1.85 + i * 0.335; for (const s of [-1, 1]) g.box(x, 0.046, -1.3 + s * 0.33, 0.03, 0.01, 0.03, C(i < 2 ? '#3dff7a' : '#fff1c4'), { layer: 'lit' }); }
    g.box(0, 0.03, -0.45, W - 0.6, 0.015, 0.9, C('#7d8288'));
    g.box(0.2, 0, 1.15, 2.6, 0.4, 0.7, C(v.color)); bands(g, 0.2, 1.15, 2.6, 0.7, 0, 0.4, true);
    g.box(0.2, 0.4, 1.15, 2.7, 0.05, 0.8, C(K.WHITE));
    g.cyl(-1.55, 0, 1.2, 0.1, 1.1, C(K.WHITE)); g.cyl(-1.55, 1.1, 1.2, 0.2, 0.18, C(K.GLASS), { layer: 'lit', k: 1.15 }); g.cyl(-1.55, 1.28, 1.2, 0.23, 0.03, C(K.DARK));
    g.anim('beacon', -1.55, 1.34, 1.2, { ph: 0.2 });
    g.anim('plane', 0, 0.03, 0, { sx: -1.05, ph: 0, far: true, color: '#2f6fb0' });
    g.anim('plane', 0, 0.03, 0, { sx: 1.05, ph: 0.775, far: true, color: '#c8463a' }); // créneaux de piste décalés : jamais deux avions sur la piste
    parking(g, 0.6, 1.75, 1.8, 0.35, 9);
    crowd(g, 4, 0.2, 1.6, 1.0, 0.06, { y: 0.03, sp: 0.15 });
    g.pool(0.2, 1.65, 0.9, '#fff1c4'); g.pool(-1.0, -0.45, 0.8, '#fff1c4'); g.pool(0.6, -0.45, 0.8, '#fff1c4');
  },
};

/* ---------- repli par type de toit et détail ---------- */
function genericModel(g, v, W, D, H, def) {
  pad(g, W, D, PLOT[def.cat] || K.PAVE);
  blk(g, v, 0, 0, W - 0.2, D - 0.2, Math.max(0.2, H), { glass: v.detail === 'glass' });
}

function buildModel(g, def, W, D, b) {
  const v = def.v, H = H_OF(v);
  const f = BY_ID[def.id];
  if (f) f(g, v, W, D, H, b); else genericModel(g, v, W, D, H, def);
  if (typeof upgradeVisuals === 'function') upgradeVisuals(g, def, v, W, D, H, b);
}



/* ---------- 4 bis. améliorations visibles ---------- */
const TECH_REBUILD = new Set(['water_reuse', 'robot_sorting', 'molecular_recycling', 'municipal_copilot', 'autonomous_shuttles', 'superconducting_grid']);

/* points d'ancrage libres : toit (x, y, z) et cour (x, z), en repère local */
const ANCHOR = {
  police: { roof: [0.45, 1, -0.55], yard: [0.75, 0.25] },
  police_post: { roof: [-0.15, 1, -0.2], yard: [-0.38, 0.38] },
  fire: { roof: [-0.45, 1, -0.55], yard: [0.6, 0.5] },
  fire_drone: { roof: [0.6, 1, -0.6], yard: [0.55, 0.55] },
  clinic: { roof: [-0.1, 1, -0.15], yard: [-0.38, 0.4] },
  hospital: { roof: [0.65, 'base', -0.85], yard: [-1.2, 0.6] },
  health_ai: { roof: [0.55, 0.43, 0.45], yard: [0.75, -0.75] },
  school: { roof: [0.6, 0.9, 0.05], yard: [0.55, 0.62], ext: [0.55, 0.62, 0.32, 0.28] },
  high_school: { roof: [0.5, 1.2, -0.4], yard: [0.8, -0.4], ext: [0.8, -0.4, 0.26, 0.7] },
  university: { roof: [1.05, 0.75, -0.6], yard: [0, 0.2], ext: [0, 0.18, 1.0, 0.28] },
  library: { roof: [0, 0.67, -0.05], yard: [0.36, -0.36] },
  city_hall: { roof: [0.5, 0.95, -0.4], yard: [0.6, 0.35] },
  water_pump: { roof: [0, 0.45, -0.05], yard: [-0.32, 0.32], deep: [-0.3, -0.33] },
  water_tower: { roof: [0, 1.6, 0], yard: [-0.3, -0.3] },
  desalination: { roof: [-0.3, 0.8, -0.3], yard: [0.6, -0.6], deep: [0.55, 0.6] },
  water_plant: { roof: [0, 0.75, 0.85], yard: [1.2, -1.25], deep: [-1.3, -1.3] },
  sewage_plant: { roof: [0.55, 0.5, 0.5], yard: [0.82, 0.05] },
  sewage_big: { roof: [0.5, 0.5, 1.05], yard: [1.15, -0.2] },
  bus_stop: { roof: [0, 0.26, 0.32], yard: [-0.3, 0.05] },
  museum: { roof: [0, 1, 0], yard: [0.75, 0.75] },
  zoo: { yard: [1.2, 1.2] },
  marina: { roof: [-0.3, 0.36, -0.3], yard: [0.4, 0.4] },
};

function upgradeVisuals(g, def, v, W, D, H, b) {
  const id = def.id, has = (u) => hasUp(b, u), A = ANCHOR[id] || {};
  const ry = A.roof && A.roof[1];
  const R = A.roof ? [A.roof[0], ry === 1 ? H + 0.05 : ry === 'base' ? H * 0.4 + 0.05 : ry, A.roof[2]] : [0, H + 0.05, 0];
  const Y = A.yard || [W / 2 - 0.2, D / 2 - 0.2];

  /* Sécurité */
  if (has('police_patrols')) { // îlotiers à pied autour de la parcelle
    const p = loopPath(-W / 2 + 0.08, -D / 2 + 0.08, W / 2 - 0.08, D / 2 - 0.08);
    walkers(g, 2, p, { y: 0.03, sp: 0.06, color: '#1f3a6e' });
    g.box(Y[0], 0.03, Y[1], 0.2, 0.06, 0.04, C('#2f4f8a'));
  }
  if (has('police_video')) for (const [x, z] of [[-W / 2 + 0.06, D / 2 - 0.06], [W / 2 - 0.06, D / 2 - 0.06]]) {
    g.box(x, 0.03, z, 0.02, 0.42, 0.02, C('#5d636b')); g.box(x, 0.43, z - 0.02, 0.04, 0.03, 0.06, C('#2b2f33'));
    g.anim('beacon', x, 0.47, z, { ph: x });
  }
  if (has('police_predictive')) { g.box(R[0], R[1], R[2], 0.02, 0.35, 0.02, C(K.STEEL)); g.anim('holoRing', R[0], R[1] + 0.25, R[2], { r: 0.12, spin: 1.5, color: '#4f8dff' }); }
  if (has('fire_ladder')) { // camion grande échelle, échelle déployée
    const [x, z] = Y; g.box(x, 0.03, z, 0.15, 0.16, 0.42, C('#c8392f')); g.box(x, 0.19, z - 0.05, 0.06, 0.03, 0.55, C('#d9dcdd'), { rx: -0.55 });
  }
  if (has('fire_sensors')) for (let i = 0; i < 3; i++) g.anim('sensor', R[0] - 0.15 + i * 0.15, R[1], R[2], { ph: i * 0.3 });
  /* Santé */
  if (has('health_imaging')) { g.box(R[0], R[1], R[2], 0.34, 0.16, 0.28, C('#f4f6f8')); g.tube(R[0] - 0.1, R[1] + 0.08, R[2], R[0] + 0.1, R[1] + 0.08, R[2], 0.07, C('#d8dde2'), { seg: 12 }); g.box(R[0], R[1] + 0.165, R[2], 0.3, 0.012, 0.24, C('#3fc1c9'), { layer: 'glow' }); }
  if (has('health_telemed')) { const x = R[0] + (has('health_imaging') ? 0.25 : 0); g.box(x, R[1], R[2], 0.02, 0.18, 0.02, C(K.STEEL)); g.hemi(x, R[1] + 0.2, R[2], 0.09, C('#eef1f3'), { rx: 2.3, sy: 0.04 }); g.anim('beacon', x, R[1] + 0.2, R[2], { ph: 0.5 }); }
  /* Éducation */
  if (has('edu_digital')) { g.box(R[0], R[1], R[2], 0.015, 0.3, 0.015, C(K.STEEL)); for (let k = 0; k < 3; k++) g.torus(R[0], R[1] + 0.3, R[2], 0.04 + k * 0.035, 0.12, C('#62e6f7'), { layer: 'glow', rx: Math.PI / 2, sy: 0.04 + k * 0.035 }); }
  if (has('edu_extension') && A.ext) { // bâtiment modulaire supplémentaire
    const [x, z, w, d] = A.ext;
    g.box(x, 0, z, w, 0.28, d, C('#e9e2cf')); g.box(x, 0.28, z, w + 0.03, 0.03, d + 0.03, C('#3fa07a'));
    frontWins(g, x, z, w, d, 0.12, Math.max(2, Math.round(w / 0.12)));
  }
  if (has('edu_ai_tutor')) g.anim('holoRing', R[0], R[1] + 0.35, R[2], { r: 0.18, spin: 1.1, color: '#c58bff' });
  if (['school', 'high_school', 'university', 'library'].includes(id)) {
    g.anim('holoRing', R[0] - 0.2, R[1] + 0.5, R[2], { r: 0.15, spin: 0.7, need: 'adaptive_learning', color: '#7ff0b0' });
    g.anim('holoRing', R[0] - 0.2, R[1] + 0.7, R[2], { r: 0.25, spin: -0.5, tilt: 0.4, need: 'immersive_campus', color: '#62e6f7' });
  }
  if (has('hall_eservices')) { const [x, z] = Y; g.box(x, 0.03, z, 0.05, 0.4, 0.05, C('#3a4048')); g.box(x, 0.3, z + 0.03, 0.34, 0.2, 0.02, C('#62e6f7'), { layer: 'glow' }); standing(g, [[x - 0.1, z + 0.18, Math.PI], [x + 0.1, z + 0.2, Math.PI]], { y: 0.03 }); }
  /* Eau */
  if (has('pump_efficient')) { const [x, z] = Y; g.box(x, 0.03, z, 0.2, 0.14, 0.2, C('#d6e6ef')); g.tube(x - 0.1, 0.1, z, x + 0.1, 0.1, z, 0.03, C('#2f6fc0'), { seg: 6 }); g.box(x, 0.17, z, 0.12, 0.012, 0.12, C('#62e6f7'), { layer: 'glow' }); }
  if (has('pump_deep')) { const [x, z] = A.deep || Y; lattice(g, x, z, 0.16, 0.05, 0.6, '#2f6fc0'); }
  if (['water_pump', 'water_tower', 'desalination', 'water_plant', 'sewage_plant', 'sewage_big'].includes(id)) {
    g.anim('sensor', Y[0] * -1, 0.03, Y[1], { need: 'smart_water', ph: Y[0] });
    g.anim('holoRing', R[0], R[1] + 0.12, R[2], { r: 0.16, spin: 0.9, need: 'smart_water', color: '#5bc8ff' });
  }
  if (has('sewage_membrane')) { const [x, z] = Y; for (let i = 0; i < 4; i++) g.tube(x - 0.12, 0.08 + (i % 2) * 0.08, z - 0.15 + i * 0.1, x + 0.12, 0.08 + (i % 2) * 0.08, z - 0.15 + i * 0.1, 0.035, C('#e9f3fb'), { seg: 8 }); }
  if (has('sewage_bio')) { const [x, z] = id === 'sewage_big' ? [-0.7, 1.15] : [-0.85, 0.08]; for (let i = 0; i < 2; i++) { g.cyl(x + i * 0.3, 0.03, z, 0.11, 0.35, C('#bfe3c3')); g.cyl(x + i * 0.3, 0.38, z, 0.112, 0.02, C('#3fa07a')); g.cyl(x + i * 0.3, 0.12, z, 0.113, 0.03, C('#7fffb0'), { layer: 'glow' }); } }
  /* Transports */
  if (has('bus_shelter')) { g.box(0, 0.03, 0.26, 0.2, 0.15, 0.012, C('#62e6f7'), { layer: 'glow' }); g.box(0, 0.25, 0.32, 0.5, 0.008, 0.14, C('#ffcf8a'), { layer: 'lit' }); }
  if (['metro_station', 'train_station', 'tram_stop', 'bus_depot', 'hyperloop'].includes(id)) {
    const [x, z] = id === 'train_station' ? [W / 2 - 0.35, -D / 2 + 0.2] : [-W / 2 + 0.18, -D / 2 + 0.18];
    g.anim('bikes', x, 0.03, z, { need: 'maas' });
  }
  /* Parcs, culture */
  if (has('park_care')) { // massifs fleuris, jardinier, davantage de promeneurs
    const fl = ['#e8577a', '#f2c94c', '#bb6bd9', '#f2994a', '#ffffff'];
    for (let i = 0; i < 6; i++) {
      const x = (g.rnd() - 0.5) * (W - 0.3), z = (g.rnd() - 0.5) * (D - 0.3);
      if (Math.abs(x) < 0.1 || Math.abs(z) < 0.1) continue;
      g.cyl(x, 0.03, z, 0.07, 0.03, C('#6b4a2b'), { seg: 8 });
      for (let k = 0; k < 4; k++) g.sphere(x + (g.rnd() - 0.5) * 0.08, 0.07, z + (g.rnd() - 0.5) * 0.08, 0.025, C(fl[(g.rnd() * fl.length) | 0]), { low: true });
    }
    crowd(g, 1, 0, 0, W * 0.35, D * 0.35, { y: 0.03, sp: 0.08, stop: 0.7, color: '#3f9a5a' });
    crowd(g, 2, 0, 0, W * 0.3, D * 0.3, { y: 0.03, sp: 0.15 });
  }
  if (has('culture_program')) {
    const [x, z] = Y;
    for (let i = 0; i < 3; i++) { g.box(x - 0.15 + i * 0.15, 0.03, z, 0.012, 0.45, 0.012, C(K.STEEL)); g.box(x - 0.15 + i * 0.15 + 0.035, 0.28, z, 0.06, 0.16, 0.006, C(['#e8577a', '#62e6f7', '#f2c94c'][i]), { layer: 'glow' }); }
    if (id !== 'museum') crowd(g, 4, x - 0.3, z - 0.2, 0.25, 0.15, { y: 0.03, sp: 0.12, stop: 0.5 });
    g.pool(x, z, 0.5, '#ffd0f0');
  }
  /* Technologies visibles sans reconstruction (affichées si la technologie est active) */
  if (id === 'warehouse') {
    for (let i = 0; i < 3; i++) g.anim('agv', 0, 0.03, 0, { path: loopPath(-0.8, 0.22, 0.7, 0.42), sp: 0.22, ph: i / 3, need: 'automated_warehouses', color: '#3fa0b8' });
    g.anim('robotArm', 0.75, 0.03, -0.9, { need: 'automated_warehouses', ph: 1, s: 1.1, color: '#3fa0b8' });
  }
  if (id === 'robot_depot') for (let i = 0; i < 3; i++) g.anim('agv', 0, 0.03, 0, { path: loopPath(-0.4, 0.28, 0.4, 0.44), sp: 0.15, ph: i / 3, need: 'ground_robots', color: '#e9eef2' });
}

/* ---------- genres supplémentaires utilisés par les améliorations */
kind('bikes', (g) => {
  g.box(0, 0, 0, 0.3, 0.008, 0.08, C('#5d636b'), { tint: false });
  for (let i = 0; i < 4; i++) {
    const x = -0.11 + i * 0.075;
    g.tube(x, 0.02, -0.03, x, 0.02, 0.03, 0.018, C('#2b2f33'), { tint: false, seg: 6 });
    g.box(x, 0.02, 0, 0.006, 0.03, 0.05, C('#2fae6a'));
  }
  g.box(0.16, 0, 0, 0.012, 0.12, 0.012, C('#5d636b'), { tint: false }); g.box(0.16, 0.12, 0, 0.03, 0.04, 0.008, C('#7fffb0'), { layer: 'glow', tint: false });
}, (d, t, o) => {}, { palette: ['#2fae6a'] });



/* ---------- 5. circulation ---------- */
const DIRV = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // 0 sud (+z), 1 est (+x), 2 nord (−z), 3 ouest (−x)
const VMAX = [0, 0.9, 1.3, 2.0, 1.5, 2.2];
const RANKW = [0, 1, 1.6, 1.8, 2.0, 1.8];
const CAR_COLS = ['#d64a3a', '#e8eaec', '#2f3439', '#3f6fb0', '#d7b23c', '#8a9aa6', '#f2f2f2', '#2f8f6a', '#c6c9cc', '#7a2f2a', '#1f2a44'];

function vehGeo(type) {
  return animGeo((g) => {
    const lamp = (z, col, w = 0.03) => { g.box(-0.04, 0.045, z, w, 0.016, 0.006, C(col), { layer: 'glow', tint: false }); g.box(0.04, 0.045, z, w, 0.016, 0.006, C(col), { layer: 'glow', tint: false }); };
    const wheels = (zs, w) => { for (const z of zs) g.tube(-w / 2, 0.022, z, w / 2, 0.022, z, 0.022, C('#1d2024'), { tint: false, seg: 7 }); };
    if (type === 'car' || type === 'av' || type === 'getaway') {
      g.box(0, 0.02, 0, 0.12, 0.05, 0.24, C('#ffffff'));
      g.box(0, 0.068, -0.015, 0.104, 0.042, 0.13, C('#2a3440'), { tint: false, layer: 'lit' });
      g.box(0, 0.11, -0.015, 0.1, 0.006, 0.11, C('#ffffff'));
      wheels([-0.075, 0.075], 0.125);
      lamp(0.121, '#fffbe8'); lamp(-0.121, '#ff3b30', 0.025);
      if (type === 'av') { g.cyl(0, 0.115, -0.01, 0.02, 0.02, C('#3a3f45'), { tint: false, seg: 8 }); g.cyl(0, 0.118, -0.01, 0.021, 0.008, C('#62e6f7'), { layer: 'glow', tint: false, seg: 8 }); g.box(0, 0.04, 0.12, 0.09, 0.006, 0.004, C('#62e6f7'), { layer: 'glow', tint: false }); }
    } else if (type === 'van') {
      g.box(0, 0.02, -0.02, 0.13, 0.11, 0.24, C('#ffffff'));
      g.box(0, 0.02, 0.11, 0.13, 0.07, 0.06, C('#ffffff'));
      g.box(0, 0.08, 0.1, 0.12, 0.035, 0.04, C('#2a3440'), { tint: false, layer: 'lit', rx: -0.4 });
      wheels([-0.09, 0.09], 0.135); lamp(0.141, '#fffbe8'); lamp(-0.141, '#ff3b30', 0.025);
    } else if (type === 'truck' || type === 'garbage') {
      g.box(0, 0.025, 0.15, 0.14, 0.13, 0.11, C(type === 'garbage' ? '#3f8a4c' : '#e6e8ea'), { tint: type === 'garbage' });
      g.box(0, 0.09, 0.204, 0.12, 0.045, 0.004, C('#2a3440'), { tint: false, layer: 'lit' });
      if (type === 'garbage') { g.box(0, 0.025, -0.06, 0.14, 0.15, 0.3, C('#ffffff')); g.box(0, 0.06, -0.212, 0.13, 0.1, 0.02, C('#5a5f66'), { tint: false }); }
      else g.box(0, 0.025, -0.07, 0.14, 0.17, 0.3, C('#ffffff'));
      wheels([0.15, -0.1, -0.17], 0.145); lamp(0.207, '#fffbe8'); lamp(-0.212, '#ff3b30', 0.03);
      if (type === 'garbage') { g.box(0, 0.155, 0.15, 0.05, 0.02, 0.03, C('#ff9a1e'), { layer: 'glow', tint: false }); g.box(0, 0.09, -0.212, 0.1, 0.012, 0.004, C('#ff9a1e'), { layer: 'glow', tint: false }); }
    } else if (type === 'firetruck') {
      g.box(0, 0.025, 0.15, 0.15, 0.13, 0.11, C('#c8392f'), { tint: false });
      g.box(0, 0.025, -0.07, 0.15, 0.15, 0.32, C('#c8392f'), { tint: false });
      g.box(0, 0.09, 0.204, 0.12, 0.045, 0.004, C('#2a3440'), { tint: false, layer: 'lit' });
      g.box(0, 0.18, -0.06, 0.05, 0.025, 0.36, C('#d9dcdd'), { tint: false });
      g.box(-0.035, 0.16, 0.16, 0.04, 0.02, 0.03, C('#3d7bff'), { layer: 'glow', tint: false }); g.box(0.035, 0.16, 0.16, 0.04, 0.02, 0.03, C('#ff3b30'), { layer: 'glow', tint: false });
      wheels([0.15, -0.12], 0.155); lamp(0.207, '#fffbe8');
    } else if (type === 'police') {
      g.box(0, 0.02, -0.02, 0.14, 0.12, 0.26, C('#f2f4f6'), { tint: false }); g.box(0, 0.02, 0.12, 0.14, 0.08, 0.06, C('#f2f4f6'), { tint: false });
      g.box(0, 0.06, -0.02, 0.142, 0.03, 0.26, C('#2f4fa8'), { tint: false }); g.box(0, 0.09, 0.11, 0.12, 0.035, 0.04, C('#2a3440'), { tint: false, rx: -0.4, layer: 'lit' });
      g.box(-0.03, 0.145, 0.02, 0.04, 0.02, 0.03, C('#3d7bff'), { layer: 'glow', tint: false }); g.box(0.03, 0.145, 0.02, 0.04, 0.02, 0.03, C('#ff3b30'), { layer: 'glow', tint: false });
      wheels([0.1, -0.1], 0.145); lamp(0.151, '#fffbe8');
    } else if (type === 'bus') {
      g.box(0, 0.02, 0, 0.15, 0.16, 0.46, C('#ffffff'));
      g.box(0, 0.09, 0, 0.152, 0.05, 0.42, C('#2a3440'), { tint: false, layer: 'lit' });
      g.box(0, 0.09, 0.231, 0.13, 0.06, 0.004, C('#2a3440'), { tint: false, layer: 'lit' });
      g.box(0, 0.15, 0.231, 0.08, 0.02, 0.004, C('#ffb020'), { layer: 'glow', tint: false });
      wheels([0.15, -0.14], 0.155); lamp(0.232, '#fffbe8'); lamp(-0.232, '#ff3b30', 0.03);
    } else if (type === 'shuttle') {
      g.box(0, 0.02, 0, 0.14, 0.14, 0.3, C('#ffffff'));
      g.box(0, 0.07, 0, 0.142, 0.06, 0.26, C('#2a3440'), { tint: false, layer: 'lit' });
      g.box(0, 0.162, 0, 0.1, 0.008, 0.22, C('#62e6f7'), { layer: 'glow', tint: false });
      wheels([0.1, -0.1], 0.145); lamp(0.151, '#e8fbff'); lamp(-0.151, '#ff3b30', 0.03);
    }
  });
}
const VTYPES = {
  car: { len: 0.24, sp: 1, palette: CAR_COLS },
  av: { len: 0.24, sp: 1.05, palette: ['#f2f4f6', '#d9dde2', '#2f3439', '#3f6fb0'] },
  van: { len: 0.28, sp: 0.95, palette: ['#f2f2f2', '#e8eaec', '#d7b23c', '#3f6fb0'] },
  truck: { len: 0.42, sp: 0.8, palette: ['#c8463a', '#2f6fb0', '#e8eaec', '#3f9a5a', '#e2b13c'] },
  bus: { len: 0.46, sp: 0.85, palette: ['#e2b13c'] },
  shuttle: { len: 0.3, sp: 0.9, palette: ['#f4f6f8'] },
  garbage: { len: 0.42, sp: 0.75, palette: ['#3f8a4c', '#4f9a5a'] },
  firetruck: { len: 0.42, sp: 1.25, palette: ['#c8392f'] },
  police: { len: 0.3, sp: 1.35, palette: ['#f2f4f6'] },
  getaway: { len: 0.24, sp: 1.5, palette: ['#1d2024'] },
};

const TRAFFIC = {
  init(map, catalog, scene) {
    this.dispose();
    this.map = map; this.scene = scene; this.catalog = catalog;
    const { W, H, road, idx, inside, terr } = map;
    this.W = W; this.H = H;
    const N = W * H;
    this.nb = new Int32Array(N * 4).fill(-1); this.out = new Uint8Array(N * 4); this.inter = new Uint8Array(N); this.width = new Float32Array(N);
    this.tiles = [];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const i = idx(x, z), t = road[i];
      if (!t) continue;
      this.tiles.push(i); this.width[i] = catalog.roads[t - 1].v.width;
      let n = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRV[d][0], nz = z + DIRV[d][1];
        if (!inside(nx, nz)) { this.out[i * 4 + d] = 1; continue; }
        const j = idx(nx, nz);
        if (road[j]) { this.nb[i * 4 + d] = j; n++; }
      }
      this.inter[i] = n >= 3 ? 1 : 0;
    }
    this.entries = []; // (tuile de bord, direction entrante)
    for (const i of this.tiles) for (let d = 0; d < 4; d++) if (this.out[i * 4 + d] && this.nb[i * 4 + (d + 2) % 4] >= 0) this.entries.push([i, (d + 2) % 4]);
    this.interList = this.tiles.filter((i) => this.inter[i]);
    this.I = new Map(this.interList.map((i) => [i, { inside: [0, 0], last: [-9, -9], wait: [0, 0], q: [0, 0], near: [0, 0], ped: [0, 0], em: [0, 0], pedArm: [0, 0, 0, 0], armBusy: [0, 0, 0, 0], nearArm: [0, 0, 0, 0], inArm: [0, 0, 0, 0], leftIn: [0, 0, 0, 0], rear: [9, 9, 9, 9], rearT: [9, 9, 9, 9], turn: 0, g: Math.random() < 0.5 ? 0 : 1, amber: 0, red: 0, tg: Math.random() * 6 }]));
    // trottoirs (rues, avenues, boulevards) pour les piétons
    this.pedOk = new Uint8Array(N);
    for (const i of this.tiles) if (road[i] === 1 || road[i] === 2 || road[i] === 4) this.pedOk[i] = 1;
    this.score = new Float32Array(N).fill(1); this.sum = new Float32Array(N); this.cnt = new Float32Array(N);
    this.lanes = new Map(); this.closed = new Set(); this.closedBy = {};
    this.meshes = {}; this.veh = []; this.peds = []; this.t = 0;
    this.mat = LIFE.mats.anim;
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: '#fff1c8', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -4 });
    this.target ??= { cars: 200, people: 200 };
    this.initSignals(); this.initOverlay(); this.pickRoadworks();
    this.respawn();
  },
  /** Case d'apparition : tirée selon le trafic de la partie sur chaque tronçon. */
  pickTile() {
    const cum = this.cum;
    if (!cum || !cum.total || cum.w.length !== this.tiles.length) return this.tiles[(Math.random() * this.tiles.length) | 0];
    const r = Math.random() * cum.total; let lo = 0, hi = cum.w.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum.w[m] < r) lo = m + 1; else hi = m; }
    return this.tiles[lo];
  },
  /** Volumes et congestion de la partie : nombre de véhicules, tronçons fréquentés, lenteurs. */
  setFlows(flow, congestion, pop) {
    const n = this.map.W * this.map.H;
    this.slow = new Float32Array(n).fill(1);
    this.flowW = new Float32Array(n).fill(1);
    let total = 0, ftot = 0;
    const w = new Float32Array(this.tiles.length);
    // densité visible sur chaque tronçon = voies × charge de la partie : quelques voitures quand c'est fluide,
    // des files serrées quand c'est saturé (la congestion se lit à l'œil)
    this.tiles.forEach((i, k) => {
      const f = flow ? flow[i] || 0 : 1, c = congestion ? congestion[i] || 0 : 0;
      const lanes = this.lanesOf(i) * 2, busy = f > 0.5 ? 0.05 + 0.85 * Math.min(1.3, c) : 0.015;
      total += lanes * busy; ftot += f; w[k] = total;
      this.slow[i] = c > 1.1 ? 0.35 : c > 0.85 ? 0.55 : c > 0.6 ? 0.8 : 1;
    });
    const avg = this.tiles.length ? ftot / this.tiles.length : 0;
    if (avg > 0) this.tiles.forEach((i) => { this.flowW[i] = 0.35 + Math.min(2.5, (flow[i] || 0) / avg); });
    this.cum = { w, total };
    const cars = Math.round(Math.max(this.tiles.length ? Math.min(12, this.tiles.length) : 0, Math.min(1600, total, this.tiles.length * 2.2)));
    const people = Math.round(Math.max(40, Math.min(1100, (pop || 0) / 30)));
    const prev = this.target;
    this.target = { cars, people };
    return !prev || Math.abs(prev.cars - cars) > Math.max(40, prev.cars * 0.25);
  },
  lanesOf(i) { const t = this.map.road[i]; return t === 1 ? 1 : 2; },
  cw(i) { return Math.min(this.width[i] / 2 + 0.1, 0.47); }, // position du passage piéton depuis le centre du carrefour

  /* ---------- composition du trafic selon le niveau d'affluence et les technologies */
  respawn() {
    for (const m of Object.values(this.meshes)) { this.scene.remove(m); m.dispose(); }
    this.meshes = {}; this.veh = []; this.lanes.clear();
    const L = this.target, av = hasTech('autonomous_vehicles'), maas = hasTech('maas');
    // véhicules autonomes : plus de déplacements ; MaaS : report vers vélos et transports ; optimisation IA : pointes lissées
    let total = Math.round(L.cars * (av ? 1.12 : 1) * (maas ? 0.9 : 1) * (hasTech('ai_mobility_optimization') ? 0.88 : 1));
    const fleets = this.map.buildings.filter((b) => b.def.id === 'bus_depot');
    const busN = Math.round((8 + fleets.filter((b) => hasUp(b, 'bus_fleet')).length * 5) * (hasTech('autonomous_shuttles') ? 1.6 : 1));
    const depots = this.map.buildings.filter((b) => b.def.id === 'waste_depot' && !b.state);
    const garbN = Math.round((10 + depots.filter((b) => hasUp(b, 'waste_trucks')).length * 4 + depots.filter((b) => hasUp(b, 'waste_electric')).length * 2) * (hasTech('ai_waste') ? 1.8 : 1));
    void busN; // les bus et navettes suivent les vraies lignes de la partie (Lines3D)
    const counts = { bus: 0, shuttle: 0, garbage: garbN, truck: Math.round(total * 0.08), van: Math.round(total * 0.12) };
    const rest = total - counts.truck - counts.van;
    counts.av = av ? Math.round(rest * 0.45) : 0; counts.car = rest - counts.av;
    const col = new THREE.Color();
    for (const [type, n] of Object.entries(counts)) {
      if (!n) continue;
      const VT = VTYPES[type];
      VT.geo ??= vehGeo(type);
      const mesh = new THREE.InstancedMesh(VT.geo, this.mat, n);
      mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let k = 0; k < n; k++) mesh.setColorAt(k, col.set(VT.palette[Math.floor(Math.random() * VT.palette.length)]));
      this.scene.add(mesh); this.meshes[type] = mesh;
      for (let k = 0; k < n; k++) {
        const v = { type, k, len: VT.len, vf: VT.sp, spd: 0, granted: false, inI: -1, inAxis: -1, wait: 0, init: true, av: type === 'av' || type === 'shuttle' };
        if (!this.place(v, true)) continue;
        this.veh.push(v);
      }
    }
    // véhicules d'urgence : instances réservées, attribuées à la demande
    this.emer = {};
    for (const type of ['firetruck', 'police', 'getaway']) {
      const VT = VTYPES[type]; VT.geo ??= vehGeo(type);
      const NE = { firetruck: 14, police: 12, getaway: 6 }[type];
      const mesh = new THREE.InstancedMesh(VT.geo, this.mat, NE);
      mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let k = 0; k < NE; k++) { mesh.setMatrixAt(k, new THREE.Matrix4().makeScale(0, 0, 0)); if (type === 'getaway') mesh.setColorAt(k, new THREE.Color(['#1d2024', '#2a2f36', '#3b2a2a'][k % 3])); }
      this.scene.add(mesh); this.meshes[type] = mesh; this.emer[type] = Array.from({ length: NE }, (_, k) => NE - 1 - k);
    }
    const nb = this.veh.length + 40;
    if (this.beams) { this.scene.remove(this.beams); this.beams.dispose(); }
    const bg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.beams = new THREE.InstancedMesh(bg, this.beamMat, Math.max(1, nb)); this.beams.frustumCulled = false; this.beams.visible = STATE.night; this.beams.renderOrder = 2;
    this.scene.add(this.beams);
    this.respawnPeds();
  },
  /* place un véhicule sur une voie libre (au hasard, ou à une entrée de la carte) */
  place(v, anywhere) {
    for (let tries = 0; tries < 40; tries++) {
      let from, dir, t;
      if (anywhere) { from = this.pickTile(); const ds = [0, 1, 2, 3].filter((d) => this.nb[from * 4 + d] >= 0); if (!ds.length) continue; dir = ds[(Math.random() * ds.length) | 0]; t = Math.random() * 0.8; }
      else { const e = this.entries[(Math.random() * this.entries.length) | 0]; from = e[0]; dir = e[1]; t = 0; }
      if (this.closed.has(from) || this.closed.has(this.nb[from * 4 + dir])) continue;
      { // jamais posé sur un passage piéton ni au-delà d'une ligne d'arrêt
        const to = this.nb[from * 4 + dir];
        if (to >= 0 && this.inter[to]) t = Math.min(t, 1 - (this.cw(to) + 0.11) - v.len / 2 - 0.05);
        if (this.inter[from]) t = Math.max(t, this.cw(from) + 0.1 + v.len / 2);
        if (t < 0 || t > 1) continue;
      }
      const lane = this.lanesOf(from) === 2 ? (Math.random() < 0.5 ? 0 : 1) : 0;
      const key = (from * 4 + dir) * 2 + lane;
      if (!this.laneFree(key, t, v.len)) continue;
      Object.assign(v, { from, dir, lane, t, spd: anywhere ? 0.5 : 0.6, granted: false, inI: -1, init: true, pdir: null, pend: null });
      this.pickNext(v);
      let k2 = key;
      if (this.lanesOf(from) === 2 && v.next >= 0) { // voie cohérente avec le mouvement : droite → voie de droite, gauche → voie de gauche
        const want = v.next === (dir + 3) % 4 ? 0 : v.next === (dir + 1) % 4 ? 1 : lane, kk = (from * 4 + dir) * 2 + want;
        if (want !== lane && this.laneFree(kk, t, v.len)) { v.lane = want; k2 = kk; }
      }
      const arr = this.lanes.get(k2); if (arr) arr.push(v); else this.lanes.set(k2, [v]);
      return true;
    }
    return false;
  },
  laneFree(key, t, len) { const arr = this.lanes.get(key); if (!arr) return true; for (const o of arr) if (Math.abs(o.t - t) < (len + o.len) / 2 + 0.12) return false; return true; },
  pickNext(v) {
    const to = this.nb[v.from * 4 + v.dir];
    if (v.route) { // véhicule d'urgence : suit son itinéraire
      const j = v.ri + 1;
      v.next = j + 1 < v.route.length ? this.dirTo(to, v.route[j + 1]) : v.dir; v.nextLane = 0; v.exit = false;
      if (v.next < 0) v.next = v.dir;
      return;
    }
    if (to < 0) { v.next = -1; v.exit = true; return; }
    v.exit = false;
    const P = v.pend; v.pend = null;
    let pick = P && P.from === v.from && P.dir === v.dir && this.okDir(to, P.d) ? P.d : this.choose(v.from, v.dir, v.lane);
    if (pick < 0) { v.next = (v.dir + 2) % 4; v.nextLane = 0; return; }
    v.next = pick;
    if (this.nb[to * 4 + pick] < 0 || this.lanesOf(to) !== 2) { v.nextLane = 0; return; }
    // décision du carrefour suivant prise dès maintenant : on s'engage sur la bonne voie
    const d2 = this.choose(to, pick);
    v.pend = { from: to, dir: pick, d: d2 };
    v.nextLane = d2 === (pick + 3) % 4 ? 0 : d2 === (pick + 1) % 4 ? 1 : (pick === v.dir ? v.lane : (Math.random() < 0.5 ? 0 : 1));
  },
  okDir(to, d) { const j = this.nb[to * 4 + d]; return d >= 0 && (j >= 0 ? !this.closed.has(j) : !!this.out[to * 4 + d]); },
  choose(from, dir, lane = -1, strict = true) {
    const to = this.nb[from * 4 + dir];
    if (to < 0) return -1;
    const opts = [], mob = hasTech('ai_mobility_optimization');
    const ban = strict && lane >= 0 && this.lanesOf(from) === 2 ? (lane === 0 ? (dir + 1) % 4 : (dir + 3) % 4) : -1; // pas de tourne-à-gauche depuis la voie de droite (et inversement)
    for (let d = 0; d < 4; d++) {
      if (d === (dir + 2) % 4 || d === ban) continue;
      const j = this.nb[to * 4 + d];
      let w;
      if (j >= 0) {
        w = (d === dir ? (this.map.road[to] === 1 ? 2.2 : 3.5) : 1) * RANKW[this.map.road[j]] * (this.flowW ? this.flowW[j] : 1);
        if (mob) w *= 0.7 + 0.3 * this.score[j]; // contourne légèrement les tronçons chargés
        if (this.works.has(j)) w *= mob ? 0.15 : 0.6;
        if (this.closed.has(j)) w *= 0.002;
      } else if (this.out[to * 4 + d]) w = 1.6;
      else continue;
      opts.push([d, w]);
    }
    if (!opts.length) return ban >= 0 ? this.choose(from, dir, lane, false) : -1;
    let r = Math.random() * opts.reduce((s, o) => s + o[1], 0);
    let pick = opts[0][0];
    for (const [d, w] of opts) { r -= w; if (r <= 0) { pick = d; break; } }
    return pick;
  },

  /* ---------- feux (technologie « Feux de circulation prédictifs ») */
  initSignals() {
    const poles = [], heads = [];
    for (const I of this.interList) {
      const x = I % this.W, z = (I / this.W) | 0, w = this.width[I];
      for (let d = 0; d < 4; d++) {
        if (this.nb[I * 4 + (d + 2) % 4] < 0) continue; // pas de voie qui arrive dans ce sens
        const [dx, dz] = DIRV[d], rx = -dz, rz = dx;
        const px = x + 0.5 - dx * (w / 2 + 0.1) + rx * (w / 2 + 0.07), pz = z + 0.5 - dz * (w / 2 + 0.1) + rz * (w / 2 + 0.07);
        poles.push({ x: px, z: pz, ry: Math.atan2(-dx, -dz) });
        heads.push({ I, axis: d % 2, x: px, z: pz, ry: Math.atan2(-dx, -dz) });
      }
    }
    const pg = animGeo((g) => { g.box(0, 0, 0, 0.022, 0.36, 0.022, C('#4a4f56'), { tint: false }); g.box(0, 0.3, 0.005, 0.05, 0.12, 0.035, C('#22262b'), { tint: false }); });
    const bg = animGeo((g) => g.box(0, 0, 0, 0.036, 0.036, 0.012, C('#ffffff'), { layer: 'tglow' }));
    this.poleMesh = new THREE.InstancedMesh(pg, this.mat, poles.length);
    this.bulbMesh = new THREE.InstancedMesh(bg, this.mat, heads.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    poles.forEach((o, k) => { q.setFromAxisAngle(up, o.ry); this.poleMesh.setMatrixAt(k, m.compose(p.set(o.x, 0.012, o.z), q, s)); });
    heads.forEach((o, k) => { q.setFromAxisAngle(up, o.ry); this.bulbMesh.setMatrixAt(k, m.compose(p.set(o.x, 0.34, o.z).addScaledVector(new THREE.Vector3(Math.sin(o.ry), 0, Math.cos(o.ry)), 0.024), q, s)); this.bulbMesh.setColorAt(k, new THREE.Color('#ff3b30')); });
    for (const mm of [this.poleMesh, this.bulbMesh]) { mm.frustumCulled = false; this.scene.add(mm); }
    this.heads = heads;
  },
  /* ---------- carte de congestion */
  initOverlay() {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, toneMapped: false });
    this.ov = new THREE.InstancedMesh(g, mat, this.tiles.length);
    const m = new THREE.Matrix4(), c = new THREE.Color('#3fbf6a');
    this.tiles.forEach((i, k) => { const w = this.width[i]; m.makeScale(1, 1, 1).setPosition((i % this.W) + 0.5, 0.045, ((i / this.W) | 0) + 0.5); this.ov.setMatrixAt(k, m); this.ov.setColorAt(k, c); });
    this.ov.visible = false; this.ov.frustumCulled = false; this.ov.renderOrder = 4;
    this.scene.add(this.ov);
    this.ovT = 0;
  },
  refreshOverlay() {
    const c = new THREE.Color(), G = new THREE.Color('#2fbf62'), Y = new THREE.Color('#f2c94c'), O = new THREE.Color('#f2994a'), R = new THREE.Color('#e5383b');
    this.tiles.forEach((i, k) => {
      const s = this.score[i];
      if (s > 0.75) c.copy(Y).lerp(G, (s - 0.75) / 0.25); else if (s > 0.45) c.copy(O).lerp(Y, (s - 0.45) / 0.3); else c.copy(R).lerp(O, s / 0.45);
      this.ov.setColorAt(k, c);
    });
    this.ov.instanceColor.needsUpdate = true;
  },
  /* ---------- chantiers de voirie (moins nombreux avec la maintenance prédictive) */
  pickRoadworks() {
    const cand = this.tiles.filter((i) => {
      const t = this.map.road[i], x = i % this.W, z = (i / this.W) | 0;
      if (!(t === 1 || t === 2) || this.inter[i] || this.map.terr[i] === T_WATER || x < 3 || z < 3 || x > this.W - 4 || z > this.H - 4) return false;
      const ns = this.nb[i * 4] >= 0 && this.nb[i * 4 + 2] >= 0, ew = this.nb[i * 4 + 1] >= 0 && this.nb[i * 4 + 3] >= 0;
      return (ns && !ew) || (ew && !ns);
    }).sort((a, b) => hash2(a, 3, 91) - hash2(b, 3, 91));
    const picked = [];
    for (const i of cand) { if (picked.every((j) => Math.abs((j % this.W) - (i % this.W)) + Math.abs(((j / this.W) | 0) - ((i / this.W) | 0)) > 14)) picked.push(i); if (picked.length >= 6) break; }
    this.workSites = picked;
    this.works = new Set(); // la partie n'a pas de chantiers de voirie : aucun n'est inventé
  },
  globalAnims() {
    const out = [], M = (x, y, z, ry = 0) => new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    for (const i of this.works) {
      const x = (i % this.W) + 0.5, z = ((i / this.W) | 0) + 0.5, ns = this.nb[i * 4] >= 0, w = this.width[i];
      const ry = ns ? 0 : Math.PI / 2, side = w * 0.22;
      const loc = (lx, lz) => ns ? [x + lx, z + lz] : [x + lz, z + lx];
      for (let k = 0; k < 6; k++) { const [cx, cz] = loc(side - 0.1 + (k % 2) * 0.2, -0.45 + k * 0.18); out.push({ kind: 'cone', base: M(cx, 0.03, cz), d: {} }); }
      const [ex, ez] = loc(side, 0); out.push({ kind: 'digger', base: M(ex, 0.03, ez, ry), d: { ph: hash2(i, 1, 1) * 6 } });
      for (let k = 0; k < 2; k++) out.push({ kind: 'person', base: M(x, 0.03, z, ry), d: { m: 'wander', cx: side, cz: 0, rx: 0.06, rz: 0.3, sp: 0.15, stop: 0.6, seed: k * 7 + i, color: '#ff8a1e' } });
    }
    // capteurs de la maintenance prédictive, le long des rues
    this.tiles.forEach((i, k) => {
      if (k % 9 || this.inter[i] || !this.pedOk[i]) return;
      const x = (i % this.W) + 0.5, z = ((i / this.W) | 0) + 0.5, w = this.width[i], ns = this.nb[i * 4] >= 0;
      out.push({ kind: 'sensor', base: M(ns ? x - w / 2 - 0.12 : x, 0.03, ns ? z : z - w / 2 - 0.12), d: { need: 'predictive_maintenance', ph: k * 0.13 } });
    });
    return out;
  },

  /* ---------- piétons, cyclistes, robots de livraison */
  respawnPeds() {
    for (const k of ['ped', 'bike', 'robot']) if (this.meshes[k]) { this.scene.remove(this.meshes[k]); this.meshes[k].dispose(); delete this.meshes[k]; }
    this.peds = [];
    const cells = this.tiles.filter((i) => this.pedOk[i]);
    const depots = this.map.buildings.filter((b) => b.def.id === 'robot_depot');
    const near = depots.length ? cells.filter((i) => depots.some((b) => Math.abs((i % this.W) - b.x) + Math.abs(((i / this.W) | 0) - b.z) < 10)) : cells;
    const L = this.target;
    const spec = [['ped', L.people, cells], ['bike', hasTech('maas') ? Math.round(L.people * 0.22) : 0, cells], ['robot', hasTech('ground_robots') ? 70 : 0, near]];
    const col = new THREE.Color();
    for (const [type, n, pool] of spec) {
      if (!n || !pool.length) continue;
      const geo = PEDGEO[type] ??= pedGeo(type);
      const mesh = new THREE.InstancedMesh(geo, this.mat, n);
      mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let k = 0; k < n; k++) {
        mesh.setColorAt(k, col.set(type === 'robot' ? '#e9eef2' : type === 'bike' ? '#2fae6a' : SHIRTS[(Math.random() * SHIRTS.length) | 0]));
        const tile = pool[(Math.random() * pool.length) | 0];
        const axes = [0, 1, 2, 3].filter((d) => this.nb[tile * 4 + d] >= 0 || this.out[tile * 4 + d]); // dans l'axe de la rue
        if (!axes.length) continue;
        const p = { type, k, tile, d: axes[(Math.random() * axes.length) | 0], s: Math.random() < 0.5 ? -1 : 1, u: 0, sp: type === 'bike' ? 0.5 + Math.random() * 0.2 : type === 'robot' ? 0.2 : 0.15 + Math.random() * 0.1, ph: Math.random() * 6, wait: 0 };
        this.choosePed(p); p.u = Math.random() * p.L;
        this.peds.push(p);
      }
      this.scene.add(mesh); this.meshes[type] = mesh;
    }
  },

  /* ---------- simulation */
  update(dt, t) {
    this.t = t;
    dt = Math.min(dt, 0.05);
    const { road } = this.map, lights = hasTech('ai_traffic_lights'), avTech = hasTech('autonomous_vehicles');
    this.mob = hasTech('ai_mobility_optimization');
    // regroupe les véhicules par voie, triés par position
    for (const arr of this.lanes.values()) arr.length = 0;
    for (const v of this.veh) { const key = (v.from * 4 + v.dir) * 2 + v.lane; const arr = this.lanes.get(key); if (arr) arr.push(v); else this.lanes.set(key, [v]); }
    for (const arr of this.lanes.values()) if (arr.length > 1) arr.sort((a, b) => a.t - b.t);
    // occupation des carrefours
    for (const S of this.I.values()) { S.inside[0] = S.inside[1] = 0; S.wait[0] = S.wait[1] = 0; S.q[0] = S.q[1] = 0; S.near[0] = S.near[1] = 0; S.em[0] = S.em[1] = 0; S.armBusy.fill(0); S.nearArm.fill(0); S.inArm.fill(0); S.leftIn.fill(0); S.rear.fill(9); S.rearT.fill(9); }
    for (const v of this.veh) {
      const to = this.nb[v.from * 4 + v.dir];
      if (to >= 0 && this.inter[to]) {
        const S = this.I.get(to), ax = v.dir % 2;
        if (v.granted) { S.inside[ax]++; S.armBusy[(v.dir + 2) % 4]++; if (v.next >= 0) S.armBusy[v.next]++; S.inArm[(v.dir + 2) % 4]++; if (v.next === (v.dir + 1) % 4) S.leftIn[(v.dir + 2) % 4]++; }
        else if (v.t > 0.45 && v.spd > 0.15) S.nearArm[(v.dir + 2) % 4]++;
        else if (v.t > (lights ? 0 : 0.3)) { S.q[ax]++; if (v.wait > S.wait[ax]) S.wait[ax] = v.wait; }
        if (!v.granted && v.t > 0.45 && v.spd > 0.15) S.near[ax]++;
        if (v.emergency && !v.granted && v.t > 0.2) S.em[ax]++;
      }
      if (v.inI >= 0) { const S = this.I.get(v.inI); if (S && v.t < this.cw(v.inI) + 0.07 + v.len / 2) { S.inside[v.inAxis]++; if (v.dir % 2 !== v.inAxis) S.inside[v.dir % 2]++; S.armBusy[v.dir]++; S.inArm[v.inE]++; if (v.inLeft) S.leftIn[v.inE]++; if (v.dir % 2 !== v.inAxis) S.rearT[v.inE] = Math.min(S.rearT[v.inE], v.t - v.len / 2); else S.rear[v.inE] = Math.min(S.rear[v.inE], v.t - v.len / 2); } else v.inI = -1; }
    }
    if (lights) this.updateSignals(dt);
    // les véhicules se rangent devant un véhicule d'urgence
    for (const e of this.veh) {
      if (!e.emergency) continue;
      const arr = this.lanes.get((e.from * 4 + e.dir) * 2 + e.lane) || [];
      for (const c of arr) if (!c.emergency && c.t > e.t && c.t < e.t + 1.3) c.yieldT = 1.2;
      const to = this.nb[e.from * 4 + e.dir];
      if (to >= 0 && e.t > 0.4) for (const ln of [0, 1]) for (const c of this.lanes.get((to * 4 + e.next) * 2 + ln) || []) if (!c.emergency && c.t < e.t - 0.4) c.yieldT = 1.2;
    }
    // vitesses
    for (const arr of this.lanes.values()) {
      for (let k = 0; k < arr.length; k++) {
        const v = arr[k];
        const to = this.nb[v.from * 4 + v.dir];
        const rt = road[to >= 0 ? to : v.from];
        let vmax = VMAX[rt] * v.vf;
        if (this.works.has(v.from) || (to >= 0 && this.works.has(to))) vmax *= 0.32;
        if (this.slow) vmax *= this.slow[to >= 0 ? to : v.from];
        const minGap = (v.av && avTech ? 0.05 : 0.09) * (lights ? 0.9 : 1);
        let free = 9;
        let jl = k + 1;
        while (v.emergency && arr[jl] && arr[jl].yieldT > 0) jl++;
        const lead = arr[jl];
        if (lead) free = lead.t - v.t - (lead.len + v.len) / 2 - minGap;
        else if (to >= 0 && v.next >= 0 && this.nb[to * 4 + v.next] >= 0) {
          const nArr = this.lanes.get((to * 4 + v.next) * 2 + v.nextLane);
          const nl = nArr && (v.emergency ? nArr.find((c) => !(c.yieldT > 0)) : nArr[0]);
          if (nl) free = 1 - v.t + nl.t - (nl.len + v.len) / 2 - minGap;
          if (v.nextLane !== v.lane && this.lanesOf(to) === 2) { // changement de voie : on ménage aussi la voie actuelle
            const n2 = this.lanes.get((to * 4 + v.next) * 2 + v.lane), l2 = n2 && n2[0];
            if (l2 && !v.emergency) free = Math.min(free, 1 - v.t + l2.t - (l2.len + v.len) / 2 - minGap);
          }
        }
        // insertion : un véhicule de l'autre voie, devant, vise la même voie du tronçon suivant
        if (to >= 0 && v.next >= 0 && !v.emergency) {
          const oArr = this.lanes.get((v.from * 4 + v.dir) * 2 + (1 - v.lane));
          if (oArr) {
            const changing = v.nextLane !== v.lane;
            for (const c of oArr) {
              if (c.emergency) continue;
              // je change de voie : je reste derrière ceux de la voie visée, et j'attends qu'un voisin à ma hauteur soit passé
              if (changing && v.t > 0.55 && v.t < 0.8 && Math.abs(v.t - c.t) < (c.len + v.len) / 2 + minGap + 0.06) { if (this.lanesOf(to) === 2) { v.nextLane = v.lane; v.pend = null; break; } free = Math.min(free, 0.79 - v.t); } // voisin à ma hauteur : je renonce à changer de voie (ou j'attends, si la voie se rétrécit)
              // un voisin s'insère devant moi (engagé) ou je m'insère derrière lui
              if (c.t > v.t && ((c.next === v.next && c.nextLane === v.nextLane && (changing || c.t > 0.8)) || (c.t > 0.8 && c.nextLane !== c.lane && c.nextLane === v.lane))) { free = Math.min(free, c.t - v.t - (c.len + v.len) / 2 - minGap); break; }
            }
          }
        }
        // véhicule de la même file qui vient de tourner au carrefour : on ne le rattrape pas au centre
        if (to >= 0 && this.inter[to]) { const S0 = this.I.get(to), rr = S0.rear[(v.dir + 2) % 4], rt = S0.rearT[(v.dir + 2) % 4];
          if (rr < 0.45) free = Math.min(free, (1 - v.t - v.len / 2) + Math.max(0, rr) - minGap);
          if (rt < 0.47) free = Math.min(free, 0.62 - v.t - v.len / 2); } // le précédent a tourné : il dégage d'abord le coin du carrefour
        // tronçon fermé (émeute, crue) : arrêt avant
        if (to >= 0 && this.closed.has(to) && !v.emergency) free = Math.min(free, 1 - v.t - v.len / 2 - 0.08);
        // ligne d'arrêt au carrefour
        if (to >= 0 && this.inter[to] && !v.granted) {
          const stopT = 1 - (this.cw(to) + 0.11) - v.len / 2, dStop = stopT - v.t; // arrêt avant le passage piéton
          if (dStop < 0.95) {
            const S = this.I.get(to), ax = v.dir % 2, ot = 1 - ax;
            let ok;
            const pedFree = S.pedArm[(v.dir + 2) % 4] === 0 && (v.next < 0 || S.pedArm[v.next] === 0);
            // tourne-à-gauche : seulement si personne n'est engagé en face ; et on n'entre pas pendant qu'un véhicule d'en face tourne à gauche
            const e = (v.dir + 2) % 4, opp = (e + 2) % 4, left = v.next === (v.dir + 1) % 4;
            const crossFree = left ? S.inArm[opp] === 0 : S.leftIn[opp] === 0;
            if (v.emergency) ok = S.inside[ot] === 0 && pedFree && crossFree;                       // urgence : passe dès que le carrefour est libre
            else if (lights) ok = (S.g === ax && !S.red && (!S.amber || dStop < 0.1)) && S.inside[ot] === 0 && pedFree && crossFree && S.em[ot] === 0 && free > 0.02;
            else ok = S.inside[ot] === 0 && pedFree && crossFree && S.em[ot] === 0 && t - S.last[ot] > 0.35 && (S.q[ot] === 0 || S.turn === ax) && free > 0.1; // priorité : un véhicule de chaque axe à tour de rôle, piétons d'abord
            if (ok && dStop < 0.12) { v.granted = true; v.inE = e; v.inLeft = left; S.inArm[e]++; if (left) S.leftIn[e]++; S.inside[ax]++; S.armBusy[(v.dir + 2) % 4]++; if (v.next >= 0) S.armBusy[v.next]++; S.last[ax] = t; if (S.q[ot] > 0) S.turn = ot; }
            if (!v.granted) free = Math.min(free, dStop);
          }
        }
        // benne : s'arrête pour vider les bacs de la rue
        let halt = false;
        if (v.type === 'garbage') {
          if (v.hold > 0) { v.hold -= dt; halt = true; if (v.hold <= 0) { FX.collectBins(v.from); HOOKS.sound('bins', v.rx, v.rz); } }
          else if (v.coll !== v.from && v.t > 0.3 && v.t < 0.7 && FX.binsNeed(v.from)) { v.hold = 1.6; v.coll = v.from; halt = true; }
        }
        if (v.yieldT > 0) { v.yieldT -= dt; halt = true; }
        const target = halt ? 0 : Math.min(vmax * Math.max(0, Math.min(1, free / 0.4)), Math.sqrt(2 * 3.2 * Math.max(0, free))); // freinage selon la distance d'arrêt
        v.spd += Math.max(-4 * dt, Math.min((v.av && avTech ? 2.2 : this.mob ? 1.7 : 1.4) * dt, target - v.spd));
        if (v.spd < 0.02) v.wait += dt; else if (v.spd > 0.2) v.wait = 0;
        if (v.wait > 30 && !v.emergency && !v.route) { v.wait = 0; this.place(v, true); continue; } // anti-blocage : un véhicule coincé trop longtemps quitte la carte
        const ratio = vmax > 0 ? v.spd / vmax : 1;
        this.sum[v.from] += ratio; this.cnt[v.from]++;
      }
    }
    // avance
    for (const v of this.veh) {
      v.t += v.spd * dt;
      if (v.t >= 1) {
        const to = this.nb[v.from * 4 + v.dir];
        if (to < 0) { if (!this.place(v, false)) this.place(v, true); continue; }   // sortie de carte → réapparaît à une entrée
        if (v.next < 0 || this.nb[to * 4 + v.next] < 0 && !this.out[to * 4 + v.next]) { this.place(v, true); continue; }
        if (this.inter[to]) { v.inI = to; v.inAxis = v.dir % 2; }
        v.pfrom = v.from; v.pdir = v.dir; v.plane = v.lane;
        v.t -= 1; v.from = to; v.dir = v.next; v.lane = this.nb[to * 4 + v.dir] >= 0 ? v.nextLane : 0; v.granted = false;
        if (v.route) { v.ri++; if (v.from === v.route[v.route.length - 1]) { v.t = Math.min(v.t, 0.4); v.dead = true; continue; } }
        this.pickNext(v);
      }
    }
    // véhicules d'urgence arrivés : ils deviennent des véhicules garés gérés par l'événement
    if (this.veh.some((v) => v.dead)) {
      for (const v of this.veh) if (v.dead) { if (v.cb) v.cb(v); this.meshes[v.type].setMatrixAt(v.k, new THREE.Matrix4().makeScale(0, 0, 0)); this.emer[v.type].push(v.k); }
      this.veh = this.veh.filter((v) => !v.dead);
    }
    // congestion par tuile (moyenne glissante)
    const a = Math.min(1, dt * 0.7);
    for (const i of this.tiles) { this.score[i] += a * ((this.cnt[i] ? this.sum[i] / this.cnt[i] : 1) - this.score[i]); this.sum[i] = 0; this.cnt[i] = 0; }
    this.render(dt);
    this.updatePeds(dt, t);
    this.ovT += dt;
    if (this.ov.visible && this.ovT > 0.3) { this.ovT = 0; this.refreshOverlay(); }
    this.statsT = (this.statsT || 0) + dt;
    if (this.statsT > 0.5) {
      this.statsT = 0;
      let r = 0, stop = 0;
      for (const v of this.veh) { const rt = this.map.road[v.from]; const vm = VMAX[rt] * v.vf * ((this.works.has(v.from)) ? 0.32 : 1); r += Math.min(1, v.spd / vm); if (v.spd < 0.05) stop++; }
      const n = this.veh.length || 1;
      this.stats = { n: this.veh.length, flow: r / n, stopped: stop / n, peds: this.peds.length, works: this.works.size };
    }
  },
  updateSignals(dt) {
    let k = 0;
    for (const [I, S] of this.I) {
      S.tg += dt;
      const ax = S.g, ot = 1 - ax;
      if (S.amber) { if (S.tg > 1.4) { S.amber = 0; S.red = 1; S.tg = 0; } }
      else if (S.red) { if (S.tg > 0.7 && S.inside[ax] === 0) { S.red = 0; S.g = ot; S.tg = 0; } }
      else {
        // feux prédictifs : le vert dure tant que des véhicules arrivent et que l'autre axe n'attend pas trop
        const dO = S.q[ot], dT = S.q[ax] + S.inside[ax];
        if (dO > 0 && dT === 0 && S.tg > 0.8) { S.red = 1; S.tg = 0.35; }          // personne n'arrive : bascule immédiate
        else if ((S.tg > 3 && dO > 0 && (S.tg > 10 || dO > 2 * dT + 2)) || S.tg > 20) { S.amber = 1; S.tg = 0; }
      }
    }
    const G = this._G || (this._G = [new THREE.Color('#3dff7a'), new THREE.Color('#ffb020'), new THREE.Color('#ff3b30')]);
    for (const h of this.heads) {
      const S = this.I.get(h.I);
      const c = S.g === h.axis && !S.red ? (S.amber ? G[1] : G[0]) : G[2];
      this.bulbMesh.setColorAt(k++, c);
    }
    this.bulbMesh.instanceColor.needsUpdate = true;
  },
  _m: new THREE.Matrix4(), _q: new THREE.Quaternion(), _p: new THREE.Vector3(), _s: new THREE.Vector3(1, 1, 1), _up: new THREE.Vector3(0, 1, 0),
  /* position exacte sur une arête : centre de la tuile de départ + avancée + décalage de voie */
  laneOff(from, to, lane) {
    const ref = to >= 0 && this.inter[from] && !this.inter[to] ? to : from, w = this.width[ref];
    return this.lanesOf(ref) === 1 ? w * 0.24 : (lane === 0 ? w * 0.36 : w * 0.15);
  },
  edgePos(from, dir, lane, t, extra, out) {
    const [dx, dz] = DIRV[dir], to = this.nb[from * 4 + dir], off = this.laneOff(from, to, lane) + extra;
    out[0] = (from % this.W) + 0.5 + dx * t - dz * off; out[1] = ((from / this.W) | 0) + 0.5 + dz * t + dx * off;
    return out;
  },
  render(dt) {
    const night = STATE.night, r = 0.3, A = [0, 0], B = [0, 0];
    let bi = 0;
    for (const v of this.veh) {
      const extra = v.emergency ? -0.06 : v.yieldT > 0 ? Math.max(0, Math.min(0.07, Math.min(this.width[v.from] / 2 + 0.1, 0.47) - 0.05 - this.laneOff(v.from, this.nb[v.from * 4 + v.dir], v.lane) - 0.075)) : 0;
      const to = this.nb[v.from * 4 + v.dir];
      let x, z, ry;
      // virage : courbe de Bézier entre l'arête d'arrivée et l'arête de sortie
      let P0 = null, P2 = null, u = 0, D, N;
      if (to >= 0 && v.next >= 0 && v.next !== v.dir && v.next !== (v.dir + 2) % 4 && v.t > 1 - r && this.nb[to * 4 + v.next] >= 0) {
        P0 = this.edgePos(v.from, v.dir, v.lane, 1 - r, 0, A); P2 = this.edgePos(to, v.next, v.nextLane, r, 0, B); u = (v.t - (1 - r)) / (2 * r); D = DIRV[v.dir]; N = DIRV[v.next];
      } else if (v.pdir != null && v.pdir !== v.dir && v.pdir !== (v.dir + 2) % 4 && v.t < r && this.nb[v.pfrom * 4 + v.pdir] === v.from) {
        P0 = this.edgePos(v.pfrom, v.pdir, v.plane, 1 - r, 0, A); P2 = this.edgePos(v.from, v.dir, v.lane, r, 0, B); u = 0.5 + v.t / (2 * r); D = DIRV[v.pdir]; N = DIRV[v.dir];
      }
      if (P0) {
        const k = (P2[0] - P0[0]) * D[0] + (P2[1] - P0[1]) * D[1], c1x = P0[0] + D[0] * k, c1z = P0[1] + D[1] * k, w = 1 - u;
        x = w * w * P0[0] + 2 * w * u * c1x + u * u * P2[0]; z = w * w * P0[1] + 2 * w * u * c1z + u * u * P2[1];
        const tx = 2 * w * (c1x - P0[0]) + 2 * u * (P2[0] - c1x), tz = 2 * w * (c1z - P0[1]) + 2 * u * (P2[1] - c1z);
        ry = Math.atan2(tx, tz);
      } else {
        let lx = extra, yaw = 0;
        if (v.next === v.dir && to >= 0 && v.nextLane !== v.lane && v.t > 0.8 && this.nb[to * 4 + v.next] >= 0) { // changement de voie progressif
          const u2 = (v.t - 0.8) / 0.2, sm = u2 * u2 * (3 - 2 * u2), d = this.laneOff(to, this.nb[to * 4 + v.next], v.nextLane) - this.laneOff(v.from, to, v.lane);
          lx += d * sm; yaw = Math.atan2(d * 6 * u2 * (1 - u2) / 0.2, 1) * 0.6;
        }
        this.edgePos(v.from, v.dir, v.lane, v.t, lx, A); x = A[0]; z = A[1]; ry = Math.atan2(DIRV[v.dir][0], DIRV[v.dir][1]) - yaw;
      }
      v.rx = x; v.rz = z; v.ry = ry; v.init = false;
      this._q.setFromAxisAngle(this._up, ry);
      this._m.compose(this._p.set(x, 0.024, z), this._q, this._s);
      this.meshes[v.type].setMatrixAt(v.k, this._m);
      if (night) {
        const sx = Math.sin(ry), sz = Math.cos(ry);
        this._m.compose(this._p.set(x + sx * v.len / 2, 0.03, z + sz * v.len / 2), this._q, this._s.set(0.24, 1, 0.75));
        this.beams.setMatrixAt(bi++, this._m); this._s.set(1, 1, 1);
      }
    }
    for (const m of Object.values(this.meshes)) m.instanceMatrix.needsUpdate = true;
    this.beams.count = bi; this.beams.instanceMatrix.needsUpdate = true; this.beams.visible = night;
  },
  /* Piétons : ils restent sur leur trottoir, tournent au coin sans traverser, et ne traversent une rue
   * qu'au carrefour, quand aucune voiture n'y entre (feu vert pour leur axe, ou trou dans la circulation).
   * Pendant leur traversée, les voitures de la rue traversée attendent. */
  pedOff(p) { return Math.min(this.width[p.tile] / 2 + (p.type === 'bike' ? 0.06 : 0.1), 0.47); },
  pedValid(j) { return j >= 0 && this.pedOk[j] && !(this.closedBy.flood && this.closedBy.flood.has(j)); },
  choosePed(p) {
    const i = p.tile, sd = p.s > 0 ? (p.d + 3) % 4 : (p.d + 1) % 4, opts = [];
    if (this.pedValid(this.nb[i * 4 + p.d])) opts.push([p.d, 3]);
    if (this.pedValid(this.nb[i * 4 + sd])) opts.push([sd, 1.5]);
    let nd = (p.d + 2) % 4;
    if (opts.length) { let r = Math.random() * opts.reduce((a, o) => a + o[1], 0); for (const [d, w] of opts) { r -= w; if (r <= 0) { nd = d; break; } } }
    p.nd = nd;
    const o = this.pedOff(p);
    // demi-tour : avant le bord du trottoir si l'on est dans un carrefour
    p.half = this.inter[i] ? Math.max(0.05, 0.5 - this.width[i] / 2 - 0.1) : 0.5;
    p.L = nd === p.d ? 1 : nd === (p.d + 2) % 4 ? 2 * p.half : Math.max(0.02, 2 * (0.5 - o));
    p.cross = null; p.ok = false; p.wait = 0;
    if (nd === p.d && this.inter[i] && this.nb[i * 4 + sd] >= 0) { // traversée de la rue perpendiculaire, sur le passage piéton
      const w = this.width[i];
      p.cross = [0.5 - w / 2 - 0.05, 0.5 + w / 2 + 0.05, 1 - (p.d % 2), sd];
    }
  },
  updatePeds(dt, t) {
    const lights = hasTech('ai_traffic_lights'), night = STATE.night;
    for (const S of this.I.values()) S.pedArm.fill(0);
    const zero = this._zero || (this._zero = new THREE.Matrix4().makeScale(0, 0, 0));
    for (const p of this.peds) {
      const mesh = this.meshes[p.type];
      // la nuit, la plupart des passants sont rentrés chez eux
      p.vis = false;
      if (night && ((p.type === 'ped' && p.k % 4) || (p.type === 'bike' && p.k % 3))) { mesh.setMatrixAt(p.k, zero); continue; }
      let step = p.sp * dt;
      if (p.cross) {
        const [c0, c1, b, arm] = p.cross, S = this.I.get(p.tile);
        if (!p.ok && p.u + step >= c0) {
          const a = 1 - b;
          // aucun véhicule engagé sur ce passage (y compris ceux qui tournent), feu vert piétons si feux
          const ok = S.armBusy[arm] === 0 && (lights ? S.g === a && !S.red && !S.amber && S.tg < 7 : (S.nearArm[arm] === 0 || p.wait > 6));
          if (ok) p.ok = true; else { p.u = Math.max(p.u, c0 - 0.001); step = 0; p.wait += dt; }
        }
        if (p.ok) { step *= 1.5; if (p.u >= c0 - 0.03 && p.u <= c1 + 0.02) S.pedArm[arm]++; if (p.u > c1 + 0.02) p.cross = null; }
      }
      p.u += step;
      if (p.u >= p.L) {
        const i = p.tile, D = DIRV[p.d];
        if (p.nd === p.d) p.tile = this.nb[i * 4 + p.d];
        else if (p.nd === (p.d + 2) % 4) { p.tile = this.pedValid(this.nb[i * 4 + p.nd]) ? this.nb[i * 4 + p.nd] : i; p.d = p.nd; p.s = -p.s; }
        else { const N = DIRV[p.nd]; p.tile = this.nb[i * 4 + p.nd]; p.s = -((-N[1]) * D[0] + N[0] * D[1]) || 1; p.d = p.nd; }
        if (p.tile < 0) p.tile = i;
        p.u -= p.L; p.u = Math.min(p.u, 0.05);
        this.choosePed(p);
      }
      // position sur le trottoir
      const c0x = (p.tile % this.W) + 0.5, c0z = ((p.tile / this.W) | 0) + 0.5, [dx, dz] = DIRV[p.d], px = -dz * p.s, pz = dx * p.s, o = this.pedOff(p);
      let x = c0x + px * o - dx * 0.5, z = c0z + pz * o - dz * 0.5, h = p.d;
      if (p.nd === p.d) { x += dx * p.u; z += dz * p.u; }
      else if (p.nd === (p.d + 2) % 4) { const u = p.u < p.half ? p.u : 2 * p.half - p.u; x += dx * u; z += dz * u; if (p.u >= p.half) h = p.nd; }
      else { const seg = 0.5 - o, [nx, nz] = DIRV[p.nd]; if (p.u < seg) { x += dx * p.u; z += dz * p.u; } else { x = c0x + px * o - dx * o + nx * (p.u - seg); z = c0z + pz * o - dz * o + nz * (p.u - seg); h = p.nd; } }
      if (this.closedBy.flood && this.closedBy.flood.has(p.tile)) { mesh.setMatrixAt(p.k, zero); continue; }
      const moving = step > 0, bob = p.type === 'ped' && moving ? 0.006 * Math.abs(Math.sin(t * 10 + p.ph)) : 0;
      this._q.setFromAxisAngle(this._up, Math.atan2(DIRV[h][0], DIRV[h][1]));
      p.x = x; p.z = z; p.vis = true;
      this._m.compose(this._p.set(x, 0.014 + bob, z), this._q, this._s);
      mesh.setMatrixAt(p.k, this._m);
    }
    for (const k of ['ped', 'bike', 'robot']) if (this.meshes[k]) this.meshes[k].instanceMatrix.needsUpdate = true;
  },
  /* ---------- itinéraires, véhicules d'urgence, fermetures */
  dirTo(a, b) { for (let d = 0; d < 4; d++) if (this.nb[a * 4 + d] === b) return d; return -1; },
  route(a, b) {
    const prev = new Map([[a, -1]]), q = [a];
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (i === b) break;
      for (let d = 0; d < 4; d++) { const j = this.nb[i * 4 + d]; if (j >= 0 && !prev.has(j) && (!this.closed.has(j) || j === b)) { prev.set(j, i); q.push(j); } }
    }
    if (!prev.has(b)) return null;
    const r = []; for (let i = b; i !== -1; i = prev.get(i)) r.push(i);
    return r.reverse();
  },
  /* véhicule d'intervention sur un itinéraire ; opts.calm : retour à la caserne sans gyrophare ni priorité */
  dispatch(type, from, dest, cb, opts = {}) {
    const free = this.emer && this.emer[type];
    if (free && !free.length) return null;                                     // plus de véhicule disponible : réessayer plus tard
    const r = opts.route || this.route(from, dest);
    if (!r || r.length < 2) { if (cb && !opts.calm) { const x = (dest % this.W) + 0.5, z = ((dest / this.W) | 0) + 0.5; cb({ rx: x, rz: z, ry: 0 }); } return false; }
    const VT = VTYPES[type];
    const v = { type, k: free.pop(), len: VT.len, vf: VT.sp * (opts.calm ? 0.8 : 1), spd: opts.spd ?? 0.3, granted: false, inI: -1, inAxis: -1, wait: 0, init: true, emergency: !opts.calm, calm: !!opts.calm, route: r, ri: 0, cb, lane: 0, from: r[0], dir: this.dirTo(r[0], r[1]), t: opts.t ?? 0.2 };
    this.pickNext(v); this.veh.push(v);
    return v;
  },
  /* véhicules en intervention (pour les sirènes) */
  sirens() { return this.veh.filter((v) => v.emergency && v.route && v.type !== 'getaway'); },
  close(tiles, key) {
    this.closedBy[key] = new Set(tiles);
    this.closed = new Set(Object.values(this.closedBy).flatMap((x) => [...x]));
    for (const v of this.veh) if (!v.emergency && !v.route && (this.closed.has(v.from) || this.closed.has(this.nb[v.from * 4 + v.dir]))) this.place(v, true);
  },
  /** Retire tous les objets de la circulation de la scène. */
  dispose() {
    if (!this.scene) return;
    for (const m of Object.values(this.meshes || {})) { this.scene.remove(m); m.dispose(); }
    for (const m of [this.beams, this.poleMesh, this.bulbMesh, this.ov]) if (m) { this.scene.remove(m); m.dispose(); }
    this.meshes = {}; this.veh = []; this.peds = []; this.beams = null; this.poleMesh = this.bulbMesh = this.ov = null;
  },
  setOverlay(on) { this.ov.visible = on; if (on) this.refreshOverlay(); },
  refreshTech() {
    const lightsOn = hasTech('ai_traffic_lights');
    this.poleMesh.visible = this.bulbMesh.visible = lightsOn;
    this.pickRoadworks();
    for (const v of this.veh) v.granted = v.granted && v.t > 0.5;
  },
};
const PEDGEO = {};
function pedGeo(type) {
  return animGeo((g) => {
    if (type === 'ped') {
      g.box(-0.011, 0, 0, 0.014, 0.048, 0.016, C('#2f3742'), { tint: false }); g.box(0.011, 0, 0, 0.014, 0.048, 0.016, C('#2f3742'), { tint: false });
      g.box(0, 0.046, 0, 0.042, 0.042, 0.022, C('#ffffff')); g.box(0, 0.088, 0, 0.022, 0.024, 0.022, C('#e3b48f'), { tint: false });
    } else if (type === 'bike') {
      g.box(0, 0.0, -0.04, 0.006, 0.036, 0.036, C('#2b2f33'), { tint: false }); g.box(0, 0.0, 0.04, 0.006, 0.036, 0.036, C('#2b2f33'), { tint: false });
      g.box(0, 0.025, 0, 0.008, 0.008, 0.08, C('#ffffff'));
      g.box(0, 0.035, -0.005, 0.034, 0.04, 0.022, C('#3f6fb0'), { tint: false, rx: 0.3 }); g.box(0, 0.08, 0.008, 0.02, 0.02, 0.02, C('#e3b48f'), { tint: false });
      g.box(0, 0.03, 0.045, 0.012, 0.008, 0.004, C('#fffbe8'), { layer: 'glow', tint: false });
    } else {
      g.box(0, 0.005, 0, 0.05, 0.045, 0.06, C('#ffffff'));
      g.box(0, 0.05, -0.02, 0.006, 0.04, 0.006, C('#e2b13c'), { tint: false });
      g.box(0, 0.03, 0.031, 0.035, 0.008, 0.003, C('#62e6f7'), { layer: 'glow', tint: false });
    }
  });
}

/* chantier : cônes, pelleteuse */
kind('cone', (g) => { g.cone(0, 0, 0, 0.022, 0.06, C('#ff7a1e'), { seg: 6, tint: false }); g.cyl(0, 0.025, 0, 0.0145, 0.012, C('#ffffff'), { k: 0.75, seg: 6, tint: false }); }, () => {});
kind('digger', (g) => {
  g.box(0, 0, 0, 0.09, 0.03, 0.12, C('#2b2f33'), { tint: false });
  g.box(0, 0.03, -0.01, 0.08, 0.06, 0.08, C('#e2b13c'));
  g.box(0.02, 0.09, -0.02, 0.04, 0.045, 0.04, C('#bcd8e6'), { tint: false });
  g.box(-0.02, 0.06, 0.06, 0.018, 0.018, 0.14, C('#e2b13c'), { rx: -0.6 });
  g.box(-0.02, 0.0, 0.15, 0.04, 0.03, 0.03, C('#5a5f66'), { tint: false });
}, (d, t, o) => { o.ry = 0.9 * Math.sin(t * 0.6 + (d.ph || 0)); });



/* ---------- états dégradés et objets des crises ---------- */
/* ---------- états dégradés d'un bâtiment ---------- */
function rubbleModel(g, W, D, b) {
  pad(g, W, D, '#8a8478');
  const H = H_OF(b.def.v), n = Math.min(14, Math.round(W * D * 4 + H * 2));
  const cols = ['#9a958c', '#8a8072', '#b5ada0', '#6e675e', '#a5523d', '#7d8288'];
  for (let i = 0; i < n; i++) {
    const x = (g.rnd() - 0.5) * (W - 0.35), z = (g.rnd() - 0.5) * (D - 0.35), r = 0.08 + g.rnd() * 0.12 * Math.min(2, Math.sqrt(W * D));
    g.sphere(x, 0.02, z, r, C(cols[(g.rnd() * cols.length) | 0]), { low: true, sy: r * (0.5 + g.rnd() * 0.5) });
  }
  for (let i = 0; i < 5; i++) { const x = (g.rnd() - 0.5) * (W - 0.4), z = (g.rnd() - 0.5) * (D - 0.4); g.box(x, 0.03, z, 0.012, 0.18, 0.012, C('#6b4a2b'), { rx: g.rnd() - 0.5, rz: g.rnd() - 0.5 }); }
  // barrières de chantier
  for (const s of [-1, 1]) { g.box(0, 0.03, s * (D / 2 - 0.05), W - 0.12, 0.06, 0.012, C('#f2f2f2')); g.box(s * (W / 2 - 0.05), 0.03, 0, 0.012, 0.06, D - 0.12, C('#f2f2f2')); }
  for (let i = 0; i < Math.round(W * 4); i++) g.box(-W / 2 + 0.1 + i * 0.25, 0.045, D / 2 - 0.05, 0.1, 0.03, 0.014, C('#e8573a'));
  g.anim('digger', (g.rnd() - 0.5) * (W - 0.6), 0.03, (g.rnd() - 0.5) * (D - 0.6), { ph: g.rnd() * 6, act: 'day' }, g.rnd() * 6);
  g.emit('dust', 0, 0.1, 0, { k: 0.3, s: 1.2 });
}
function decayExtras(g, W, D, b) {
  if (b.state === 'abandoned') { // herbes folles, planches, tags
    for (let i = 0; i < 4 + W * D * 2; i++) g.tree((g.rnd() - 0.5) * (W - 0.2), (g.rnd() - 0.5) * (D - 0.2), 0.5 + g.rnd() * 0.5, 4);
    for (let i = 0; i < 3; i++) g.box(-W * 0.25 + i * W * 0.25, 0.05, D / 2 - 0.12, 0.14, 0.12, 0.02, C('#8a6440'), { rz: (g.rnd() - 0.5) * 0.4 });
    g.box(0, 0.06, D / 2 - 0.11, W * 0.5, 0.06, 0.01, C(['#c23fbf', '#2fae6a', '#e2b13c'][(b.id % 3)]));
  } else { // brûlé : poutres noircies, cendres (le feu est éteint : plus aucune fumée)
    for (let i = 0; i < 4; i++) g.box((g.rnd() - 0.5) * W * 0.6, 0.03, (g.rnd() - 0.5) * D * 0.6, 0.03, 0.25, 0.03, C('#1d1b1a'), { rz: (g.rnd() - 0.5) * 1.2 });
    g.box(0, 0.005, D / 2 - 0.1, W * 0.7, 0.004, 0.14, C('#3a3634'));
  }
}
/* bâtiment sinistré après la crue : boue, sacs de sable, mobilier sorti, benne, ouvriers */
function floodExtras(g, W, D, b) {
  g.box(0, 0.004, D / 2 - 0.12, W * 0.9, 0.004, 0.2, C('#6b5436'));
  for (let i = 0; i < Math.max(4, Math.round(W * 7)); i++) {
    const x = -W / 2 + 0.12 + i * ((W - 0.24) / Math.max(1, Math.round(W * 7) - 1));
    g.sphere(x, 0.02, D / 2 - 0.05, 0.034, C('#b59a6a'), { low: true, sy: 0.02 });
    if (i % 2) g.sphere(x + 0.03, 0.045, D / 2 - 0.05, 0.032, C('#a88d5e'), { low: true, sy: 0.018 });
  }
  const px = -W / 2 + 0.24, pz = D / 2 - 0.2;
  g.box(px, 0.01, pz, 0.18, 0.03, 0.1, C('#e8e2d4'), { ry: 0.3 });            // matelas
  g.box(px + 0.05, 0.04, pz - 0.02, 0.15, 0.05, 0.07, C('#7a5a48'), { ry: -0.2 }); // canapé
  g.box(px - 0.07, 0.01, pz + 0.06, 0.05, 0.05, 0.05, C('#c9a774'), { ry: 0.5 });
  g.box(px + 0.12, 0.01, pz + 0.07, 0.04, 0.04, 0.04, C('#c9a774'), { ry: 1.1 });
  if (W >= 1) {
    const bx = W / 2 - 0.22;
    g.box(bx, 0.02, D / 2 - 0.13, 0.26, 0.1, 0.13, C('#e2b13c'));                  // benne
    g.box(bx, 0.12, D / 2 - 0.13, 0.22, 0.03, 0.1, C('#6e5a44'));
  }
  g.anim('person', 0, 0.03, D / 2 - 0.25, { m: 'wander', cx: 0, cz: 0, rx: Math.min(0.3, W * 0.3), rz: 0.06, sp: 0.18, stop: 0.7, seed: b.id % 17, color: '#ff8a1e', act: 'day' });
  g.anim('person', 0, 0.03, D / 2 - 0.3, { m: 'wander', cx: 0, cz: 0, rx: Math.min(0.25, W * 0.25), rz: 0.05, sp: 0.15, stop: 0.5, seed: (b.id % 13) + 5, color: '#e2b13c', act: 'day' });
}

/* ---------- genres animés des événements ---------- */
kind('fire', (g) => {
  g.cone(0, 0, 0, 0.11, 0.32, C('#ff5a1e'), { layer: 'glow', tint: false, seg: 6 });
  g.cone(0.05, 0, 0.03, 0.07, 0.24, C('#ff9a2a'), { layer: 'glow', tint: false, seg: 6 });
  g.cone(-0.04, 0, -0.02, 0.05, 0.2, C('#ffe36a'), { layer: 'glow', tint: false, seg: 6 });
}, (d, t, o) => {
  const k = d.ev ? d.ev.k : 1;
  if (k < 0.03) { o.hide = true; return; }
  const p = d.ph || 0, s = (d.s || 1) * (0.35 + 0.65 * k);
  o.x = d.x; o.y = d.y; o.z = d.z;
  o.sy = s * (0.85 + 0.35 * Math.sin(t * 11 + p) + 0.2 * Math.sin(t * 23 + p * 2));
  o.sx = o.sz = s * (0.9 + 0.15 * Math.sin(t * 13 + p));
  o.ry = t * 0.7 + p; o.rz = 0.12 * Math.sin(t * 2.5 + p);
});
kind('wreck', (g) => {
  g.box(0, 0.02, 0, 0.13, 0.05, 0.26, C('#2a2624'), { tint: false, rz: 0.12 });
  g.box(0, 0.07, -0.01, 0.11, 0.035, 0.13, C('#1a1817'), { tint: false, rz: 0.12 });
  for (const [x, z] of [[-0.06, -0.08], [0.06, -0.08], [-0.06, 0.08], [0.06, 0.08]]) g.box(x, 0, z, 0.02, 0.03, 0.04, C('#111111'), { tint: false });
}, (d, t, o) => { const ev = d.ev; if (ev && ev.wrecksGone) o.hide = true; });
kind('policeVan', (g) => {
  g.box(0, 0.02, -0.02, 0.14, 0.12, 0.26, C('#f2f4f6'), { tint: false });
  g.box(0, 0.02, 0.12, 0.14, 0.08, 0.06, C('#f2f4f6'), { tint: false });
  g.box(0, 0.06, -0.02, 0.142, 0.03, 0.26, C('#2f4fa8'), { tint: false });
  g.box(0, 0.09, 0.11, 0.12, 0.035, 0.04, C('#2a3440'), { tint: false, rx: -0.4 });
  g.box(-0.03, 0.145, 0.02, 0.04, 0.02, 0.03, C('#3d7bff'), { layer: 'glow', tint: false }); g.box(0.03, 0.145, 0.02, 0.04, 0.02, 0.03, C('#ff3b30'), { layer: 'glow', tint: false });
}, (d, t, o) => { if (d.ev && d.ev.done) o.hide = true; });
kind('fireTruckP', (g) => {
  g.box(0, 0.025, 0.15, 0.15, 0.13, 0.11, C('#c8392f'), { tint: false });
  g.box(0, 0.025, -0.07, 0.15, 0.15, 0.32, C('#c8392f'), { tint: false });
  g.box(0, 0.18, -0.06, 0.05, 0.025, 0.36, C('#d9dcdd'), { tint: false, rx: -0.12 });
  g.box(-0.035, 0.16, 0.16, 0.04, 0.02, 0.03, C('#3d7bff'), { layer: 'glow', tint: false }); g.box(0.035, 0.16, 0.16, 0.04, 0.02, 0.03, C('#ff3b30'), { layer: 'glow', tint: false });
  for (const z of [0.15, -0.12]) g.tube(-0.075, 0.022, z, 0.075, 0.022, z, 0.022, C('#1d2024'), { tint: false, seg: 7 });
}, (d, t, o) => { if (d.ev && d.ev.trucksGone) o.hide = true; });
// voiture des braqueurs, à l'arrêt, feux de détresse
kind('getawayP', (g) => {
  g.box(0, 0.02, 0, 0.12, 0.05, 0.24, C('#1d2024'), { tint: false });
  g.box(0, 0.068, -0.015, 0.104, 0.042, 0.13, C('#0f1215'), { tint: false });
  for (const z of [0.08, -0.08]) g.tube(-0.065, 0.022, z, 0.065, 0.022, z, 0.022, C('#111111'), { tint: false, seg: 7 });
}, (d, t, o) => { if (d.gone && d.gone()) o.hide = true; });
kind('hazard', (g) => {
  for (const [x, z] of [[-0.045, 0.121], [0.045, 0.121], [-0.045, -0.121], [0.045, -0.121]]) g.box(x, 0, z, 0.022, 0.014, 0.008, C('#ffae1e'), { layer: 'glow', tint: false });
}, (d, t, o) => { if ((d.gone && d.gone()) || Math.sin(t * 9 + (d.ph || 0)) < 0) o.hide = true; });
// alarme du bâtiment : flash rouge et orange
kind('alarm', (g) => {
  g.box(0, 0, 0, 0.1, 0.07, 0.04, C('#ff3b30'), { layer: 'glow', tint: false });
  g.box(0, 0.07, 0, 0.05, 0.03, 0.04, C('#ff9a1e'), { layer: 'glow', tint: false });
}, (d, t, o) => {
  if (!d.ev || !d.ev.alarm) { o.hide = true; return; }
  const on = Math.sin(t * 14) > 0; o.sx = o.sy = o.sz = on ? 1.25 : 0.35;
});



/* ---------- 6. scène : terrain, eau, routes, rails, forêts, bâtiments par tronçons ---------- */
const CHUNK = 20;
const TERR_COL = { 0: '#7fae5a', 1: '#e0cf96', 2: '#5f8f45', 3: '#9a948a', 4: '#3b5f6e' };
// v1.7.1 : parcelles zonées encore vides bien visibles (couleur de la zone, comme en 2D et dans la légende),
// au lieu d'un vert presque identique à l'herbe
const ZONE_TINT = { 1: '#b4e08c', 2: '#6cc48c', 3: '#8fbfe8', 4: '#bba6ea', 5: '#ecca62', 6: '#cbe07a', 7: '#cf9468', 8: '#9cbc62', 9: '#77a3dc' };
const SNOW = new THREE.Color('#f4f7fb'), LOCKED = new THREE.Color('#8f948c');
const DIR4 = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // sud, est, nord, ouest
const BED_Y = -0.72;
// activités : la nuit, parcs, écoles, stades, commerces de jour et champs se vident
const DAY_KINDS = new Set(['person', 'ball', 'tractor', 'harvester', 'dumper', 'bulldozer']);
const NIGHT_ANY = new Set(['train_station', 'airport', 'police', 'police_post', 'fire', 'fire_post', 'fire_drone', 'hospital', 'clinic', 'health_ai', 'seaport', 'com_1_bar', 'com_2_resto', 'com_3_club', 'metro_station', 'tram_stop', 'bus_stop']);

function waterNormalTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), img = x.createImageData(S, S);
  const h = (u, v) => { // hauteur périodique : somme de sinus aux fréquences entières (raccord parfait)
    const a = 2 * Math.PI;
    return Math.sin(a * (3 * u + 2 * v)) * 0.5 + Math.sin(a * (5 * u - 3 * v) + 1.3) * 0.35 + Math.sin(a * (2 * u + 7 * v) + 2.1) * 0.3 + Math.sin(a * (11 * u + 4 * v) + 0.4) * 0.15 + Math.sin(a * (-6 * u + 13 * v) + 2.7) * 0.12;
  };
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = i / S, v = j / S, e = 1 / S;
    const dx = (h(u + e, v) - h(u - e, v)) * 3, dz = (h(u, v + e) - h(u, v - e)) * 3;
    const n = new THREE.Vector3(-dx, -dz, 1).normalize(), k = (j * S + i) * 4;
    img.data[k] = (n.x * 0.5 + 0.5) * 255; img.data[k + 1] = (n.y * 0.5 + 0.5) * 255; img.data[k + 2] = (n.z * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/* arbres : 0 feuillu rond, 1 conifère, 2 peuplier, 3 bouleau, 4 buisson */
const TREE_GEO = [];
function treeGeos() {
  if (TREE_GEO.length) return TREE_GEO;
  const T = (g, h = 0.2, r = 0.032, col = '#6f4f33') => g.cyl(0, 0, 0, r, h, C(col), { seg: 5, tint: false });
  TREE_GEO.push(animGeo((g) => { T(g); g.sphere(0, 0.32, 0, 0.18, C('#ffffff'), { low: true, sy: 0.17 }); g.sphere(0.07, 0.26, 0.04, 0.12, C('#eeeeee'), { low: true }); g.sphere(-0.06, 0.4, -0.03, 0.1, C('#f6f6f6'), { low: true }); }));
  TREE_GEO.push(animGeo((g) => { T(g, 0.12, 0.03); g.cone(0, 0.08, 0, 0.17, 0.3, C('#ffffff'), { seg: 6 }); g.cone(0, 0.24, 0, 0.13, 0.26, C('#f2f2f2'), { seg: 6 }); g.cone(0, 0.38, 0, 0.08, 0.2, C('#ebebeb'), { seg: 6 }); }));
  TREE_GEO.push(animGeo((g) => { T(g, 0.14, 0.025); g.sphere(0, 0.36, 0, 0.09, C('#ffffff'), { low: true, sy: 0.26 }); }));
  TREE_GEO.push(animGeo((g) => { T(g, 0.26, 0.022, '#eeeae2'); g.box(0, 0.1, 0, 0.046, 0.012, 0.046, C('#2a2a2a'), { tint: false }); g.sphere(0.04, 0.32, 0, 0.09, C('#ffffff'), { low: true }); g.sphere(-0.04, 0.38, 0.02, 0.08, C('#f4f4f4'), { low: true }); g.sphere(0, 0.28, -0.05, 0.07, C('#eeeeee'), { low: true }); }));
  TREE_GEO.push(animGeo((g) => { g.sphere(0, 0.05, 0, 0.09, C('#ffffff'), { low: true, sy: 0.065 }); g.sphere(0.06, 0.04, 0.03, 0.06, C('#f0f0f0'), { low: true }); }));
  return TREE_GEO;
}
const TREE_PAL = [
  ['#4f8f3a', '#5a9a3f', '#3f7f35', '#6aa64a', '#5c8f2f'],
  ['#2f6b3a', '#285e34', '#3a7444', '#24543a'],
  ['#5f9a3a', '#6aa646', '#4f8a34'],
  ['#8cbf5a', '#9cc865', '#7fb24f'],
  ['#4f8a3a', '#5f9a44', '#6f8f3a'],
];
const AUTUMN = ['#d9822b', '#c8552f', '#e2b13c', '#b84a2e', '#d6a03a'];

/* chantier d'un bâtiment de zone : palissade, structure qui monte, grue pour les immeubles */
function constructionModel(g, def, W, D, b) {
  pad(g, W, D, '#b8ab90');
  for (const s of [-1, 1]) { g.box(0, 0.03, s * (D / 2 - 0.04), W - 0.08, 0.1, 0.012, C('#d8d2c2')); g.box(s * (W / 2 - 0.04), 0.03, 0, 0.012, 0.1, D - 0.08, C('#d8d2c2')); }
  const H = H_OF(def.v), k = Math.max(0.15, Math.min(1, b.progress ?? 0.4)), h = Math.max(0.08, H * k);
  const w = W - 0.4, d = D - 0.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(sx * w / 2, 0.03, sz * d / 2, 0.035, h, 0.035, C('#8e939a'));
  for (let y = 0.15; y < h; y += 0.18) g.box(0, 0.03 + y, 0, w, 0.025, d, C('#b9bec4'));
  g.box(0, 0.03, 0, w * 0.9, Math.max(0.04, h * 0.6), d * 0.9, C(def.v.color || '#d8d2c2', 0.85));
  if (H > 0.6) {
    const cx = -w / 2 - 0.08, cz = d / 2 - 0.1, mh = h + 0.5;
    g.box(cx, 0.03, cz, 0.05, mh, 0.05, C('#e2b13c'));
    g.anim('craneJib', cx, mh, cz, { ph: g.rnd() * 6, len: Math.min(1.2, W * 0.8), act: 'day' });
  }
  g.anim('person', 0, 0.03, 0, { m: 'wander', cx: 0, cz: 0, rx: w * 0.35, rz: d * 0.35, sp: 0.15, stop: 0.6, seed: b.id % 11, color: '#ff8a1e', act: 'day' });
}
kind('craneJib', (g) => {
  g.box(0.3, 0, 0, 0.75, 0.035, 0.035, C('#e2b13c'));
  g.box(-0.18, -0.03, 0, 0.18, 0.06, 0.06, C('#5d636b'));
  g.box(0.55, -0.25, 0, 0.012, 0.25, 0.012, C('#2b2f33'));
  g.box(0.55, -0.3, 0, 0.06, 0.05, 0.06, C('#c8463a'));
}, (d, t, o) => { o.ry = 0.8 * Math.sin(t * 0.25 + (d.ph || 0)); o.sx = (d.len || 1); });

/* longues étendues d'eau droites (fleuve, canal) : couloirs des péniches et bateaux */
function waterRuns(map) {
  const { W, H, terr, idx } = map, runs = [];
  const scan = (horiz) => {
    const A = horiz ? H : W, B = horiz ? W : H;
    for (let a = 1; a < A - 1; a++) {
      let s = -1;
      for (let b = 0; b <= B; b++) {
        const ok = b < B && [-1, 0, 1].every((o) => { const x = horiz ? b : a + o, z = horiz ? a + o : b; return map.inside(x, z) && terr[idx(x, z)] === T_WATER; });
        if (ok && s < 0) s = b;
        if (!ok && s >= 0) { if (b - s >= 12) runs.push({ horiz, a, s, e: b - 1, len: b - s }); s = -1; }
      }
    }
  };
  scan(true); scan(false);
  runs.sort((p, q) => q.len - p.len);
  const out = [];
  for (const r of runs) { if (out.every((o) => o.horiz !== r.horiz || Math.abs(o.a - r.a) > 4)) out.push(r); if (out.length >= 3) break; }
  return out;
}

function buildWorld(map, catalog, mats, scene) {
  const W = map.W, H = map.H;
  const nCx = Math.ceil(W / CHUNK), nCz = Math.ceil(H / CHUNK);
  const chunkOf = (x, z) => Math.min(nCz - 1, Math.max(0, Math.floor(z / CHUNK))) * nCx + Math.min(nCx - 1, Math.max(0, Math.floor(x / CHUNK)));
  const group = new THREE.Group();
  scene.add(group);
  LIFE.init(scene);
  const wtex = waterNormalTexture(); wtex.repeat.set(0.18, 0.18);
  const waterMat = new THREE.MeshPhongMaterial({ color: '#3d8ec2', transparent: true, opacity: 0.86, shininess: 110, specular: new THREE.Color('#d6eeff'), normalMap: wtex, normalScale: new THREE.Vector2(0.55, 0.55) });
  const chunks = Array.from({ length: nCx * nCz }, () => ({ meshes: [], picks: [], sink: null, trees: [], dirty: true }));
  let byChunk = null; // bâtiments par tronçon (recalculé quand la liste change)
  const ctx = new Ctx(null), g = new Ctx(null);
  const { idx, inside } = map;
  const topY = (x, z) => { if (!inside(x, z)) return -1.0; const i = idx(x, z); return map.terr[i] === T_WATER ? BED_Y : map.alt[i] * LEVEL_H; };
  const isRoadAt = (x, z) => inside(x, z) && map.road[idx(x, z)] > 0;
  const isRailAt = (x, z) => inside(x, z) && map.rail[idx(x, z)] > 0;
  const tmp = new THREE.Color();
  const DIST_TREE = { 1: 0.35, 2: 0.2, 3: 0.12, 4: 0.12, 5: 0.06, 6: 0.04, 7: 0.03, 8: 0.6 };

  function groupBuildings() {
    byChunk = Array.from({ length: nCx * nCz }, () => []);
    for (const b of map.buildings) byChunk[chunkOf(b.x + b.w / 2, b.z + b.h / 2)].push(b);
  }

  /* ---- un tronçon : sol, eau, routes, rails, arbres, bâtiments ---- */
  function buildChunk(ci) {
    const ch = chunks[ci];
    for (const m of ch.meshes) { group.remove(m); m.geometry.dispose(); }
    ch.meshes = []; ch.picks = []; ch.trees = [];
    const L = { body: new Acc(), lit: new Acc(), litc: new Acc(), glow: new Acc() };
    L.dark = L.body;
    const sink = { anims: [], emitters: [], lamps: [], pools: [], landfills: [], world: [] };
    const lamps = sink.lamps, pools = sink.pools;
    const x0 = (ci % nCx) * CHUNK, z0 = Math.floor(ci / nCx) * CHUNK, x1 = Math.min(W, x0 + CHUNK), z1 = Math.min(H, z0 + CHUNK);
    const rnd = mulberry32(ci * 7919 + 99);
    g.trees = ch.trees; g.sink = sink; g.frame(0, 0, 0, 0, L, mulberry32(ci + 7));
    // sol et berges
    const wpos = [], wuv = [];
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const i = idx(x, z), y = topY(x, z), water = map.terr[i] === T_WATER;
      let col = TERR_COL[map.terr[i]];
      if (map.occ[i] < 0 && !map.road[i] && !water && ZONE_TINT[map.zone[i]] && map.terr[i] !== T_FOREST) col = ZONE_TINT[map.zone[i]];
      if (water) col = '#4c5e52';
      tmp.set(col).multiplyScalar(0.93 + hash2(x, z, 11) * 0.12);
      // parcelles zonées : damier léger qui dessine les lots ; la neige ne les efface pas
      const zoned = col === ZONE_TINT[map.zone[i]];
      if (zoned) tmp.multiplyScalar((x + z) % 2 ? 0.94 : 1.03);
      if (map.snow && !water) tmp.lerp(SNOW, zoned ? (map.snow > 1 ? 0.3 : 0.18) : map.snow > 1 ? 0.78 : 0.42);
      if (map.locked && map.locked[i]) tmp.lerp(LOCKED, 0.45).multiplyScalar(0.78); // parcelle hors du territoire communal
      L.body.quad(x, z, x + 1, z + 1, y, tmp.clone());
      for (let d = 0; d < 4; d++) {
        const [dx, dz] = DIR4[d], ny = topY(x + dx, z + dz);
        if (ny >= y - 1e-4) continue;
        const wc = !inside(x + dx, z + dz) ? C('#6e5a43') : water ? C('#4b5a5c') : y > 0.01 ? C('#8b8377', 0.92 + hash2(x, z, d) * 0.1) : (map.terr[idx(x + dx, z + dz)] === T_WATER ? C('#8f8676') : C('#7a6a50'));
        if (d === 0) L.body.wall(x, z + 1, x + 1, z + 1, ny, y, 0, 1, wc);
        if (d === 1) L.body.wall(x + 1, z, x + 1, z + 1, ny, y, 1, 0, wc);
        if (d === 2) L.body.wall(x, z, x + 1, z, ny, y, 0, -1, wc);
        if (d === 3) L.body.wall(x, z, x, z + 1, ny, y, -1, 0, wc);
      }
      if (water) for (const [px, pz] of [[x, z], [x, z + 1], [x + 1, z + 1], [x, z], [x + 1, z + 1], [x + 1, z]]) { /* face visible d en haut */ wpos.push(px, WATER_Y, pz); wuv.push(px * 0.18, pz * 0.18); }
    }
    if (wpos.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
      wg.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(wpos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
      const wm = new THREE.Mesh(wg, waterMat); wm.receiveShadow = true; wm.renderOrder = 1;
      group.add(wm); ch.meshes.push(wm);
    }
    // routes
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const i = idx(x, z), t = map.road[i];
      if (!t) continue;
      const rv = catalog.roads[t - 1]; if (!rv) continue;
      const v = rv.v, w = v.width, cx = x + 0.5, cz = z + 0.5;
      const bridge = map.terr[i] === T_WATER;
      const yb = (bridge ? Math.max(0, map.bridge[i] - 1) : map.alt[i]) * LEVEL_H;
      g.frame(0, yb, 0, 0, L, rnd);
      const conn = DIR4.map(([dx, dz]) => isRoadAt(x + dx, z + dz) || !inside(x + dx, z + dz));
      const nArms = conn.filter(Boolean).length;
      const straightX = conn[1] && conn[3] && !conn[0] && !conn[2], straightZ = conn[0] && conn[2] && !conn[1] && !conn[3];
      if (bridge) {
        const along = straightX ? 'x' : 'z';
        g.box(cx, -0.1, cz, along === 'x' ? 1.0 : w + 0.14, 0.1, along === 'x' ? w + 0.14 : 1.0, C('#a4a7a6'), { full: true });
        for (const s of [-1, 1]) g.box(cx + (along === 'z' ? s * (w / 2 + 0.05) : 0), 0.0, cz + (along === 'x' ? s * (w / 2 + 0.05) : 0), along === 'x' ? 1.0 : 0.03, 0.08, along === 'x' ? 0.03 : 1.0, C('#d9dcdd'));
        if ((along === 'x' ? x : z) % 2 === 0) g.cyl(cx, BED_Y - yb, cz, 0.12, -0.1 - BED_Y + yb, C('#9a9d9c'));
        if ((along === 'x' ? x : z) % 2 === 1) for (const s of [-1, 1]) { const lx = cx + (along === 'z' ? s * (w / 2 + 0.05) : 0), lz = cz + (along === 'x' ? s * (w / 2 + 0.05) : 0); g.box(lx, 0.08, lz, 0.02, 0.3, 0.02, C('#5d636b')); g.box(lx, 0.38, lz, 0.05, 0.02, 0.05, C('#fff1c4'), { layer: 'lit' }); lamps.push({ x: lx, y: yb + 0.38, z: lz, r: 0.5, col: '#ffd69a' }); pools.push({ x: lx, y: yb + 0.03, z: lz, r: 0.5, col: '#ffd69a' }); }
      } else if (t === 1 || t === 2 || t === 4) L.body.quad(x, z, x + 1, z + 1, yb + 0.012, C('#b7b2a7', 0.96 + hash2(x, z, 21) * 0.06));
      const asph = C(v.color), ry = yb + 0.024;
      L.body.quad(cx - w / 2, cz - w / 2, cx + w / 2, cz + w / 2, ry, asph);
      if (conn[0]) L.body.quad(cx - w / 2, cz + w / 2, cx + w / 2, z + 1, ry, asph);
      if (conn[2]) L.body.quad(cx - w / 2, z, cx + w / 2, cz - w / 2, ry, asph);
      if (conn[1]) L.body.quad(cx + w / 2, cz - w / 2, x + 1, cz + w / 2, ry, asph);
      if (conn[3]) L.body.quad(x, cz - w / 2, cx - w / 2, cz + w / 2, ry, asph);
      const my = yb + 0.03, mk = C(v.marking || '#ffffff'), straight = straightX || straightZ;
      if (straight) {
        const ax = straightX;
        const line = (off, len, col, wd = 0.03, at = 0) => {
          if (ax) L.body.quad(cx - len / 2 + at, cz + off - wd / 2, cx + len / 2 + at, cz + off + wd / 2, my, col);
          else L.body.quad(cx + off - wd / 2, cz - len / 2 + at, cx + off + wd / 2, cz + len / 2 + at, my, col);
        };
        if (t === 1) { line(0, 0.28, mk, 0.03, -0.25); line(0, 0.28, mk, 0.03, 0.25); }
        if (t === 2 || t === 4) {
          const mw = t === 4 ? 0.18 : 0.1;
          if (v.median) line(0, 1.0, C(v.median), mw);
          for (const s of [-1, 1]) { line(s * w * 0.255, 0.25, mk, 0.02, -0.25); line(s * w * 0.255, 0.25, mk, 0.02, 0.25); line(s * (w / 2 - 0.035), 1.0, C(v.edge || '#cccccc'), 0.02); }
          if (t === 4 && !bridge && (ax ? x : z) % 2 === 0) ch.trees.push({ x: cx, y: yb + 0.04, z: cz, s: 0.7, kind: (x + z) % 4 === 0 ? 2 : 0 });
        }
        if (t === 3 || t === 5) {
          for (const s of [-1, 1]) line(s * (w / 2 - 0.05), 1.0, C(v.edge || '#c9a227'), 0.025);
          line(0, 0.35, mk, 0.03, -0.25); line(0, 0.35, mk, 0.03, 0.25);
          for (const s of [-1, 1]) { line(s * w * 0.25, 0.25, mk, 0.02, -0.25); line(s * w * 0.25, 0.25, mk, 0.02, 0.25); }
        }
        if (map.tram[i]) for (const s of [-0.06, 0.06]) line(s, 1.0, C('#9aa1a8'), 0.012); // rails du tramway
      } else if (nArms >= 3 && (t === 1 || t === 2 || t === 4)) {
        for (let d = 0; d < 4; d++) {
          if (!conn[d]) continue;
          const [dx, dz] = DIR4[d], ex = cx + dx * (w / 2 + 0.1), ez = cz + dz * (w / 2 + 0.1);
          for (let k = -2; k <= 2; k++) {
            const o = k * (w / 6);
            if (dx) L.body.quad(ex - 0.06, ez + o - 0.025, ex + 0.06, ez + o + 0.025, my, C('#ecebe6'));
            else L.body.quad(ex + o - 0.025, ez - 0.06, ex + o + 0.025, ez + 0.06, my, C('#ecebe6'));
          }
        }
      }
      // éclairage public : un lampadaire toutes les deux cases en quinconce, des deux côtés sur les grands axes
      if (straight && !bridge && (x + z) % 2 === 0) {
        const sides = t === 1 ? [((x * 7 + z * 3) >> 1) % 2 ? 1 : -1] : [-1, 1];
        for (const s of sides) {
          const off = w / 2 + (t === 3 || t === 5 ? 0.06 : 0.12);
          const lx = straightX ? cx : cx + s * off, lz = straightX ? cz + s * off : cz;
          const hh = t === 3 || t === 5 ? 0.62 : 0.44;
          g.box(lx, 0.012, lz, 0.025, hh, 0.025, C('#5d636b'));
          const ax = straightX ? 0 : -s * 0.08, az = straightX ? -s * 0.08 : 0;
          g.box(lx + ax / 2, hh - 0.01, lz + az / 2, straightX ? 0.02 : 0.1, 0.015, straightX ? 0.1 : 0.02, C('#5d636b'));
          g.box(lx + ax, hh - 0.025, lz + az, 0.06, 0.02, 0.06, C('#fff1c4'), { layer: 'lit' });
          const col = t === 3 || t === 5 ? '#ffc56e' : '#ffe0a8';
          lamps.push({ x: lx + ax, y: yb + hh - 0.03, z: lz + az, r: 0.6, col });
          pools.push({ x: lx + ax * 2.2, y: yb + 0.034, z: lz + az * 2.2, r: t === 3 || t === 5 ? 0.75 : 0.62, col });
        }
      } else if (nArms >= 3 && (x + z) % 2 === 0) {
        const lx = cx + w / 2 + 0.12, lz = cz + w / 2 + 0.12;
        g.box(lx, 0.012, lz, 0.025, 0.44, 0.025, C('#5d636b')); g.box(lx - 0.04, 0.42, lz - 0.04, 0.06, 0.02, 0.06, C('#fff1c4'), { layer: 'lit' });
        lamps.push({ x: lx - 0.04, y: yb + 0.41, z: lz - 0.04, r: 0.6, col: '#ffe0a8' }); pools.push({ x: lx - 0.15, y: yb + 0.034, z: lz - 0.15, r: 0.7, col: '#ffe0a8' });
      }
    }
    // voie ferrée : demi-tronçons vers chaque voisin
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const i = idx(x, z);
      if (!map.rail[i]) continue;
      const cx = x + 0.5, cz = z + 0.5, bridge = map.terr[i] === T_WATER, yb = bridge ? 0 : map.alt[i] * LEVEL_H;
      g.frame(0, yb, 0, 0, L, rnd);
      let arms = DIR4.map(([dx, dz]) => isRailAt(x + dx, z + dz) || (!inside(x + dx, z + dz)));
      if (!arms.some(Boolean)) arms = [false, true, false, true];
      if (arms.filter(Boolean).length === 1) { const d = arms.indexOf(true); arms[(d + 2) % 4] = true; }
      for (let d = 0; d < 4; d++) {
        if (!arms[d]) continue;
        const [dx, dz] = DIR4[d], along = dx !== 0, mx = cx + dx * 0.25, mz = cz + dz * 0.25;
        if (bridge) {
          g.box(mx, -0.1, mz, along ? 0.5 : 0.6, 0.1, along ? 0.6 : 0.5, C('#8e8a84'), { full: true });
          if (d === 1 || d === 0) g.cyl(cx, BED_Y, cz, 0.1, -0.1 - BED_Y, C('#9a9d9c'));
        } else g.box(mx, 0, mz, along ? 0.5 : 0.46, 0.035, along ? 0.46 : 0.5, C('#8a8072'));
        for (let k = 0; k < 2; k++) { const o = 0.125 + k * 0.25; g.box(cx + dx * o, 0.035, cz + dz * o, along ? 0.06 : 0.36, 0.02, along ? 0.36 : 0.06, C('#6b5a46')); }
        for (const s of [-1, 1]) g.box(mx + (along ? 0 : s * 0.1), 0.055, mz + (along ? s * 0.1 : 0), along ? 0.52 : 0.022, 0.025, along ? 0.022 : 0.52, C('#c2c6c9'));
      }
    }
    // forêts et arbres isolés
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const i = idx(x, z);
      if (map.occ[i] >= 0 || map.road[i] || map.rail[i] || map.terr[i] === T_WATER) continue;
      const y = map.alt[i] * LEVEL_H;
      if (map.terr[i] === T_FOREST) {
        const hill = map.alt[i] > 0;
        for (let k = 0; k < 6; k++) {
          if (rnd() < 0.18) continue;
          const gx = (k % 3) / 3 + 0.16, gz = Math.floor(k / 3) / 2 + 0.25;
          const r = rnd();
          const kd = hill ? (r < 0.6 ? 1 : r < 0.78 ? 3 : r < 0.92 ? 0 : 2) : (r < 0.45 ? 0 : r < 0.65 ? 3 : r < 0.85 ? 1 : 2);
          ch.trees.push({ x: x + gx + (rnd() - 0.5) * 0.2, y, z: z + gz + (rnd() - 0.5) * 0.25, s: 0.8 + rnd() * 0.7, kind: kd });
        }
        if (rnd() < 0.6) ch.trees.push({ x: x + rnd(), y, z: z + rnd(), s: 0.8 + rnd() * 0.5, kind: 4 });
      } else if (!map.zone[i] || DIST_TREE[map.zone[i]]) {
        const p = map.zone[i] ? DIST_TREE[map.zone[i]] * 0.25 : 0.05;
        if (rnd() < p) { const r = rnd(); ch.trees.push({ x: x + 0.2 + rnd() * 0.6, y, z: z + 0.2 + rnd() * 0.6, s: 0.8 + rnd() * 0.5, kind: map.alt[i] > 0 && r < 0.6 ? 1 : r < 0.55 ? 0 : r < 0.7 ? 3 : r < 0.85 ? 2 : 4 }); }
      }
    }
    // bâtiments du tronçon
    ctx.trees = ch.trees; ctx.sink = sink;
    for (const b of byChunk[ci]) {
      const def = b.def, angle = [0, Math.PI / 2, Math.PI, Math.PI * 1.5][b.rot];
      const lw = b.rot % 2 === 0 ? b.w : b.h, ld = b.rot % 2 === 0 ? b.h : b.w;
      const cx = b.x + b.w / 2, cz = b.z + b.h / 2, y = b.alt * LEVEL_H;
      const start = { body: L.body.count, lit: L.lit.count, litc: L.litc.count, glow: L.glow.count };
      ctx.frame(cx, y, cz, angle, L, mulberry32(b.id * 7919 + 13));
      if (b.water >= 0) {
        const [wx, wz] = DIR4[b.water], c = Math.cos(-angle), s = Math.sin(-angle);
        b.waterLocal = [Math.round(wx * c + wz * s), Math.round(-wx * s + wz * c)];
      } else b.waterLocal = null;
      const nAnim = sink.anims.length, nEm = sink.emitters.length, nLamp = sink.lamps.length, nPool = sink.pools.length;
      if (b.state === 'demolishing') continue;                       // la maquette animée de la démolition le remplace
      if (b.state === 'rubble') rubbleModel(ctx, lw, ld, b);
      else if (b.state === 'construction') constructionModel(ctx, def, lw, ld, b);
      else if (b.state === 'abandoned' || b.state === 'burnt' || b.state === 'flooded') {
        // modèle construit à part puis vieilli : couleurs ternies ou calcinées, boue d'une crue ; plus de lumière ni d'activité
        const T = { body: new Acc(), lit: new Acc(), litc: new Acc(), glow: new Acc() }; T.dark = T.body;
        ctx.frame(cx, y, cz, angle, T, mulberry32(b.id * 7919 + 13));
        buildModel(ctx, def, lw, ld, b);
        sink.anims.length = nAnim; sink.emitters.length = nEm; sink.lamps.length = nLamp; sink.pools.length = nPool;
        const burnt = b.state === 'burnt', flooded = b.state === 'flooded', ash = new THREE.Color('#2a2624'), mud = new THREE.Color('#6b5436'), c = new THREE.Color();
        for (const k of ['body', 'lit', 'litc', 'glow']) {
          const A = T[k];
          for (let i = 0; i < A.c.length; i += 3) {
            c.setRGB(A.c[i], A.c[i + 1], A.c[i + 2]);
            const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11, n = hash2(i, b.id, 7);
            if (burnt) c.lerp(ash, 0.72 + n * 0.2);
            else if (flooded) { // laisse de boue en bas des murs, fenêtres éteintes (logements évacués)
              const h = A.p[i + 1] - y;
              if (h < 0.17) c.lerp(mud, h < 0.13 ? 0.78 + n * 0.1 : 0.9);
              else c.lerp(mud, 0.12).multiplyScalar(0.9);
              if (k !== 'body') c.multiplyScalar(0.42);
            } else { c.lerp(new THREE.Color(l, l, l), 0.55).multiplyScalar(0.72 + n * 0.12); if (k !== 'body') c.multiplyScalar(0.35); }
            L.body.p.push(A.p[i], A.p[i + 1], A.p[i + 2]); L.body.n.push(A.n[i], A.n[i + 1], A.n[i + 2]); L.body.c.push(c.r, c.g, c.b);
          }
        }
        ctx.frame(cx, y, cz, angle, L, mulberry32(b.id + 3));
        if (flooded) floodExtras(ctx, lw, ld, b); else decayExtras(ctx, lw, ld, b);
      } else buildModel(ctx, def, lw, ld, b);
      for (let k = nAnim; k < sink.anims.length; k++) {
        const a = sink.anims[k]; a.b = b;
        if (a.d.act) a.act = a.d.act;
        else if (DAY_KINDS.has(a.kind)) a.act = a.kind === 'person' && NIGHT_ANY.has(def.id) ? 'any' : 'day';
      }
      let maxY = y + 0.15;
      for (const k of ['body', 'lit', 'litc', 'glow']) { const p = L[k].p; for (let j = start[k] * 3 + 1; j < p.length; j += 3) if (p[j] > maxY) maxY = p[j]; }
      ch.picks.push({ b, box: new THREE.Box3(new THREE.Vector3(b.x, y, b.z), new THREE.Vector3(b.x + b.w, Math.max(maxY, y + 0.2), b.z + b.h)) });
    }
    for (const [k, mat] of [['body', mats.body], ['lit', mats.lit], ['litc', mats.litc], ['glow', mats.glow]]) {
      if (!L[k].count) continue;
      const mesh = new THREE.Mesh(L[k].geometry(), mat);
      mesh.castShadow = k !== 'glow'; mesh.receiveShadow = k === 'body'; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh); ch.meshes.push(mesh);
    }
    ch.sink = sink; ch.dirty = false;
  }

  /* ---------------- arbres instanciés */
  const treeMeshes = [];
  function rebuildTrees() {
    for (const m of treeMeshes) { group.remove(m); m.dispose(); }
    treeMeshes.length = 0;
    const all = [].concat(...chunks.map((c) => c.trees));
    const geos = treeGeos();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), cc = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    for (let kd = 0; kd < 5; kd++) {
      const list = all.filter((t) => (t.kind || 0) === kd);
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geos[kd], LIFE.mats.anim, list.length);
      list.forEach((t, j) => {
        const h = hash2(Math.floor(t.x * 31), Math.floor(t.z * 37), kd);
        q.setFromAxisAngle(up, h * 6.28);
        s.setScalar(t.s); p.set(t.x, t.y, t.z);
        im.setMatrixAt(j, m.compose(p, q, s));
        const pal = TREE_PAL[kd];
        cc.set(pal[Math.floor(hash2(Math.floor(t.x * 13), Math.floor(t.z * 17), 4) * pal.length) % pal.length]).multiplyScalar(0.85 + h * 0.3);
        if ((kd === 0 || kd === 3) && hash2(Math.floor(t.x * 7), Math.floor(t.z * 5), 9) < 0.16) cc.set(AUTUMN[Math.floor(h * AUTUMN.length) % AUTUMN.length]);
        im.setColorAt(j, cc);
      });
      im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      group.add(im); treeMeshes.push(im);
    }
    return all.length;
  }

  /* ---------------- bateaux : couloirs d'eau détectés sur la carte */
  let runs = waterRuns(map);
  function riverBoats() {
    const out = [], M = new THREE.Matrix4();
    const add = (kind, d) => out.push({ kind, base: M.clone(), d: Object.assign({ far: true, m: 'river' }, d) });
    runs.forEach((r, k) => {
      const a = r.a + 0.5, s = r.s + 0.5, e = r.e + 0.5;
      const seg = (off, rev) => (r.horiz ? { x0: rev ? e : s, z0: a + off, x1: rev ? s : e, z1: a + off } : { x0: a + off, z0: rev ? e : s, x1: a + off, z1: rev ? s : e });
      const kinds = k === 0 ? [['barge', 0], ['tourBoat', 0.33], ['motorBoat', 0.66]] : [['motorBoat', 0.2], ['barge', 0.7]];
      kinds.forEach(([kd, ph], j) => add(kd, Object.assign(seg(j % 2 ? 0.3 : -0.3, j % 2 === 1), { sp: kd === 'motorBoat' ? 0.6 : 0.4, ph })));
    });
    return out;
  }
  function marinaBoats(sinks) {
    const out = [], M = new THREE.Matrix4();
    for (const s of sinks) {
      if (!s.marina) continue;
      const b = s.marina.b, ws = b.water >= 0 ? DIR4[b.water] : null;
      if (!ws) continue;
      const cx = b.x + b.w / 2, cz = b.z + b.h / 2, ext = (ws[0] ? b.w : b.h) / 2;
      for (let i = -1; i <= 1; i++) for (const sd of [-1, 1]) {
        const off = i * 0.55 + sd * 0.16, px = cx + ws[0] * (ext + 0.15) + (ws[0] ? 0 : off), pz = cz + ws[1] * (ext + 0.15) + (ws[1] ? 0 : off);
        const ry = Math.atan2(ws[0], ws[1]);
        if (i === 0 && sd === 1) out.push({ kind: 'motorBoat', base: M.clone(), d: { m: 'loop', far: true, sp: 0.42, dwell: 14, ph: 0.3, dockRy: ry, path: [[px, pz], [px + ws[0] * 3, pz + ws[1] * 3], [px + ws[0] * 3 + ws[1] * 1.2, pz + ws[1] * 3 + ws[0] * 1.2], [px + ws[1] * 0.3, pz + ws[0] * 0.3]] } });
        else out.push({ kind: (i + sd) % 2 ? 'sailBoat' : 'motorBoat', base: M.clone(), d: { m: 'dock', far: true, x: px, z: pz, ry, ph: (i + 2) * 0.7 + sd } });
      }
    }
    return out;
  }

  /* ---------------- assemblage des systèmes vivants */
  let picks = [];
  function collect() {
    const sinks = chunks.map((c) => c.sink).filter(Boolean);
    const id = new THREE.Matrix4();
    picks = [].concat(...chunks.map((c) => c.picks));
    api.picks = picks;
    const anims = [].concat(...sinks.map((s) => s.anims), ...sinks.map((s) => s.world.map((w) => ({ kind: w.kind, base: id, d: Object.assign({ far: true }, w.d), act: w.d.act }))), riverBoats(), marinaBoats(sinks), TRAFFIC.globalAnims(), FX.anims());
    LIFE.setAnims(anims);
    LIFE.setEmitters([].concat(...sinks.map((s) => s.emitters), FX.emitters()));
    LIFE.setLights([].concat(...sinks.map((s) => s.lamps)), [].concat(...sinks.map((s) => s.pools), FX.pools()));
    LIFE.setLandfills([].concat(...sinks.map((s) => s.landfills)));
    const st = sinks.find((s) => s.station);
    LIFE.station = st ? st.station : null;
    LIFE.setTrainLine(st ? st.station : null, map);
    const pt = sinks.find((s) => s.port);
    LIFE.port = pt ? pt.port : null;
    api.stats.anims = anims.length;
  }

  const api = {
    group, picks, waterMat, stats: { buildings: map.buildings.length, trees: 0, anims: 0 },
    /** Marque les tronçons touchés par des cases ou des bâtiments modifiés. */
    markTiles(tiles) { for (const i of tiles) chunks[chunkOf(i % W, Math.floor(i / W))].dirty = true; },
    markBuildings(bs) { for (const b of bs) chunks[chunkOf(b.x + b.w / 2, b.z + b.h / 2)].dirty = true; },
    markAll() { for (const c of chunks) c.dirty = true; },
    dirtyCount() { return chunks.reduce((n, c) => n + (c.dirty ? 1 : 0), 0); },
    /** Reconstruit les tronçons marqués (budget en millisecondes, au moins un tronçon). */
    flush(budgetMs = 1e9, cam = null) {
      if (!chunks.some((c) => c.dirty)) return false;
      groupBuildings();
      const t0 = performance.now();
      const order = chunks.map((c, i) => i).filter((i) => chunks[i].dirty);
      if (cam) order.sort((a, b) => { const d = (i) => Math.hypot((i % nCx) * CHUNK + CHUNK / 2 - cam.tx, Math.floor(i / nCx) * CHUNK + CHUNK / 2 - cam.tz); return d(a) - d(b); });
      for (const ci of order) { buildChunk(ci); if (performance.now() - t0 > budgetMs) break; }
      runs = waterRuns(map);
      api.stats.trees = rebuildTrees();
      api.stats.buildings = map.buildings.length;
      collect();
      return true;
    },
    recollect() { collect(); },
    buildAlone(b) { // maquette isolée d'un bâtiment (démolition animée)
      const T = { body: new Acc(), lit: new Acc(), litc: new Acc(), glow: new Acc() }; T.dark = T.body;
      const angle = [0, Math.PI / 2, Math.PI, Math.PI * 1.5][b.rot], lw = b.rot % 2 === 0 ? b.w : b.h, ld = b.rot % 2 === 0 ? b.h : b.w;
      const g2 = new Ctx([]); g2.frame(0, 0, 0, angle, T, mulberry32(b.id * 7919 + 13));
      buildModel(g2, b.def, lw, ld, b);
      const grp = new THREE.Group();
      for (const k of ['body', 'lit', 'litc', 'glow']) if (T[k].count) { const m = new THREE.Mesh(T[k].geometry(), mats[k]); m.castShadow = true; grp.add(m); }
      grp.position.set(b.x + b.w / 2, b.alt * LEVEL_H, b.z + b.h / 2);
      group.add(grp);
      return grp;
    },
    remove(obj) { group.remove(obj); obj.traverse((o) => o.geometry && o.geometry.dispose()); },
    update(dt, t, cam) {
      wtex.offset.y -= dt * 0.012; wtex.offset.x = Math.sin(t * 0.1) * 0.01;
      FX.update(dt, t, cam);
      LIFE.update(dt, t, cam);
      TRAFFIC.update(dt, t);
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of treeMeshes) m.dispose();
      wtex.dispose();
    },
  };
  return api;
}


/* ---------- 7. crises de la partie mises en scène ---------- */
const FIRE_IDS = ['fire', 'fire_post', 'fire_drone'], POLICE_IDS = ['police', 'police_post'];
const BIN_CATS = /residential|commerce|offices/;

const FX = {
  list: [], dirty: false, t: 0, rain: 0, snow: 0, mud: 0, flood: null, tick: 0,
  init(world, map, scene) {
    this.world = world; this.map = map; this.scene = scene;
    this.list = []; this.fires = new Map(); this.socials = new Map(); this.crimes = new Set(); this.collected = new Map();
    this.floodMat = new THREE.MeshPhongMaterial({ color: '#7a5a38', transparent: true, opacity: 0.9, shininess: 30, specular: new THREE.Color('#8a7a62'), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.floodMesh = null; this.floodKey = '';
    this.rainN = 1100;
    this.rainMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.007, 0.2, 0.007), new THREE.MeshBasicMaterial({ color: '#c3cfdb', transparent: true, opacity: 0.55, depthWrite: false, fog: false }), this.rainN);
    this.rainMesh.frustumCulled = false; this.rainMesh.visible = false; this.rainMesh.renderOrder = 3;
    scene.add(this.rainMesh);
    this.waterBlue = new THREE.Color('#3d8ec2'); this.waterMud = new THREE.Color('#7d6040');
    this.initBins();
  },
  dispose() {
    if (this.floodMesh) { this.scene.remove(this.floodMesh); this.floodMesh.geometry.dispose(); }
    this.scene.remove(this.rainMesh); this.rainMesh.dispose();
    for (const m of [this.binMesh, this.bagMesh]) if (m) { this.scene.remove(m); m.dispose(); }
  },
  pickOf(b) { return this.world.picks.find((p) => p.b === b); },
  boxOf(b) {
    const p = this.pickOf(b);
    if (p) return p.box;
    const y = b.alt * LEVEL_H;
    return new THREE.Box3(new THREE.Vector3(b.x, y, b.z), new THREE.Vector3(b.x + b.w, y + Math.max(0.3, H_OF(b.def.v)), b.z + b.h));
  },
  /* tuile de route la plus proche de la façade */
  frontTile(b) {
    const { road, idx, inside } = this.map, F = DIR4[b.rot];
    const fx = b.x + b.w / 2 + F[0] * (b.w / 2 + 0.5), fz = b.z + b.h / 2 + F[1] * (b.h / 2 + 0.5);
    let best = -1, bd = 1e9;
    for (let z = b.z - 1; z <= b.z + b.h; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
      if (x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.h) continue;
      if (!inside(x, z) || !road[idx(x, z)]) continue;
      const d = Math.hypot(x + 0.5 - fx, z + 0.5 - fz);
      if (d < bd) { bd = d; best = idx(x, z); }
    }
    return best;
  },
  door(b) {
    const F = DIR4[b.rot], cx = b.x + b.w / 2, cz = b.z + b.h / 2, ext = (F[0] ? b.w : b.h) / 2;
    return { x: cx + F[0] * (ext - 0.06), z: cz + F[1] * (ext - 0.06), sx: cx + F[0] * (ext + 0.12), sz: cz + F[1] * (ext + 0.12), F, R: [-F[1], F[0]] };
  },
  stations(ids, x, z, n) {
    return this.map.buildings.filter((o) => ids.includes(o.def.id) && !o.state).sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z)).slice(0, n);
  },
  park(taken, v) {
    const p = { x: v.rx, z: v.rz, ry: v.ry }, bx = -Math.sin(v.ry), bz = -Math.cos(v.ry);
    for (let k = 0; k < 4 && taken.some((o) => o && Math.hypot(o.x - p.x, o.z - p.z) < 0.34); k++) { p.x += bx * 0.36; p.z += bz * 0.36; }
    return p;
  },
  sendHome(type, from, home) { if (from >= 0 && home >= 0 && from !== home) TRAFFIC.dispatch(type, from, home, null, { calm: true }); },
  alarmAt(b) {
    const box = this.boxOf(b), F = DIR4[b.rot];
    return new THREE.Matrix4().makeRotationY(Math.atan2(F[0], F[1])).setPosition((box.min.x + box.max.x) / 2 + F[0] * 0.15, box.max.y + 0.02, (box.min.z + box.max.z) / 2 + F[1] * 0.15);
  },

  /* ---------------- rapprochement avec l'état de la partie ---------------- */
  /**
   * @param {any} state état de la partie (lecture seule)
   * @param {{removed?: any[]}} changes bâtiments retirés depuis le dernier passage (démolitions)
   */
  sync(state, changes = {}) {
    this.tick = state.time.tick;
    const active = state.crises?.active ?? [];
    // incendies : un foyer par bâtiment en feu
    const burning = new Set();
    for (const c of active) if (c.kind === 'fire') for (const id of Object.keys(c.burning ?? {})) burning.add(Number(id));
    for (const id of burning) if (!this.fires.has(id)) { const b = this.map.byId.get(id); if (b) this.startFire(b); }
    for (const [id, ev] of this.fires) if (!burning.has(id) && !ev.out) { ev.out = true; this.dirty = true; }
    // crue
    const fl = active.find((c) => c.kind === 'flood' && c.tiles?.length);
    this.syncFlood(fl);
    // manifestation et émeute
    const social = new Set();
    for (const c of active) if ((c.kind === 'riot' || c.kind === 'protest') && Number.isInteger(c.x)) { social.add(c.id); if (!this.socials.has(c.id)) this.startSocial(c); }
    for (const [id, ev] of this.socials) if (!social.has(id) && !ev.ending) { ev.ending = true; ev.endT = this.t; }
    // cambriolages et braquages récents (CrimeSystem de la partie)
    for (const f of state.crime?.incidents ?? []) {
      if (this.crimes.has(f.id) || this.tick - f.tick > 2) continue;
      this.crimes.add(f.id);
      const b = this.map.byId.get(f.buildingId);
      if (!b || b.state || this.list.filter((e) => e.type === 'burglary' || e.type === 'robbery').length >= 3) continue;
      if (f.kind === 'robbery') this.robbery(b, f.arrested); else this.burglary(b, f.arrested);
    }
    // démolitions : le bâtiment s'effondre dans la poussière
    for (const b of changes.removed ?? []) if (!b.state && this.list.filter((e) => e.type === 'demolish').length < 4) this.demolish(b);
  },

  /* ---------------- incendie ---------------- */
  startFire(b) {
    const box = this.boxOf(b), ev = { type: 'fire', b, t0: this.t, k: 0.05, fighting: false, arrived: 0, parked: [], pending: [], box, anims: [] };
    this.fires.set(b.id, ev);
    const rnd = mulberry32(b.id * 31 + this.tick), sz = Math.min(2.2, Math.sqrt((box.max.x - box.min.x) * (box.max.z - box.min.z)));
    ev.size = sz;
    const n = Math.max(3, Math.min(10, Math.round(sz * 4)));
    for (let i = 0; i < n; i++) ev.anims.push({ x: lerp(box.min.x + 0.12, box.max.x - 0.12, rnd()), y: box.max.y - 0.05, z: lerp(box.min.z + 0.12, box.max.z - 0.12, rnd()), s: 0.9 + sz * 0.5 * rnd() });
    for (let i = 0; i < 4; i++) { // flammes aux fenêtres
      const side = (rnd() * 4) | 0, u = rnd(), y = lerp(box.min.y + 0.15, box.min.y + (box.max.y - box.min.y) * 0.85, rnd());
      const x = side === 0 ? box.min.x - 0.02 : side === 1 ? box.max.x + 0.02 : lerp(box.min.x, box.max.x, u), z = side === 2 ? box.min.z - 0.02 : side === 3 ? box.max.z + 0.02 : lerp(box.min.z, box.max.z, u);
      ev.anims.push({ x, y, z, s: 0.7 });
    }
    ev.dest = this.frontTile(b);
    const near = [...this.fires.values()].some((o) => o !== ev && !o.ended && Math.hypot(o.b.x - b.x, o.b.z - b.z) < 3);
    if (ev.dest >= 0) for (const st of this.stations(FIRE_IDS, b.x, b.z, near ? 1 : 2)) { const home = this.frontTile(st); if (home >= 0) ev.pending.push(home); }
    this.sendTrucks(ev);
    this.list.push(ev); this.dirty = true;
    HOOKS.sound('whoosh', (box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2);
  },
  sendTrucks(ev) {
    ev.pending = ev.pending.filter((home) => TRAFFIC.dispatch('firetruck', home, ev.dest, (v) => this.truckArrived(ev, v, home)) === null);
  },
  truckArrived(ev, v, home) {
    if (ev.ended || ev.out) { this.sendHome('firetruck', ev.dest, home); return; } // feu déjà éteint : demi-tour
    ev.arrived++; ev.fighting = true;
    const box = ev.box, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const p = this.park(ev.parked, v);
    ev.parked.push({ x: p.x, z: p.z, ry: p.ry, aim: Math.atan2(cx - p.x, cz - p.z), dist: Math.hypot(cx - p.x, cz - p.z), top: box.max.y, home });
    this.dirty = true;
  },

  /* ---------------- crue : eau boueuse sur les cases inondées ---------------- */
  syncFlood(c) {
    const key = c ? `${c.id}:${c.tiles.length}` : '';
    if (key === this.floodKey) return;
    this.floodKey = key;
    if (!c) { if (this.flood) this.flood.ending = true; TRAFFIC.close([], 'flood'); return; }
    const { W } = this.map, pos = [];
    let sx = 0, sz = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const i of c.tiles) {
      const x = i % W, z = Math.floor(i / W), y = this.map.alt[i] * LEVEL_H + 0.13;
      pos.push(x, y, z, x, y, z + 1, x + 1, y, z + 1, x, y, z, x + 1, y, z + 1, x + 1, y, z);
      sx += x + 0.5; sz += z + 0.5; x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); z0 = Math.min(z0, z); z1 = Math.max(z1, z + 1);
    }
    if (this.floodMesh) { this.scene.remove(this.floodMesh); this.floodMesh.geometry.dispose(); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    this.floodMesh = new THREE.Mesh(geo, this.floodMat); this.floodMesh.renderOrder = 1; this.floodMesh.position.y = -0.2;
    this.scene.add(this.floodMesh);
    const n = c.tiles.length;
    this.flood = { L: this.flood && !this.flood.ending ? this.flood.L : 0, cx: sx / n, cz: sz / n, rx: Math.max(1, (x1 - x0) / 2 - 0.5), rz: Math.max(1, (z1 - z0) / 2 - 0.5), ending: false, label: c.id };
    TRAFFIC.close(c.tiles.filter((i) => this.map.road[i] && this.map.terr[i] !== T_WATER), 'flood');
    this.dirty = true;
  },

  /* ---------------- manifestation et émeute ---------------- */
  startSocial(c) {
    const { road, idx, inside, W } = this.map;
    let best = -1, bd = 1e9;
    for (let z = c.y - 4; z <= c.y + 4; z++) for (let x = c.x - 4; x <= c.x + 4; x++) if (inside(x, z) && road[idx(x, z)]) { const d = Math.hypot(x - c.x, z - c.y); if (d < bd) { bd = d; best = idx(x, z); } }
    if (best < 0) return;
    const bx = best % W, bz = Math.floor(best / W);
    const horiz = (inside(bx + 1, bz) && road[idx(bx + 1, bz)]) || (inside(bx - 1, bz) && road[idx(bx - 1, bz)]);
    const tiles = [best];
    for (const s of [1, -1]) for (let k = 1; k <= 3 && tiles.length < 5; k++) { const x = horiz ? bx + s * k : bx, z = horiz ? bz : bz + s * k; if (inside(x, z) && road[idx(x, z)]) tiles.push(idx(x, z)); else break; }
    const xs = tiles.map((i) => i % W), zs = tiles.map((i) => Math.floor(i / W));
    const ev = { type: c.kind, id: c.id, t0: this.t, tiles, horiz, crowd: 1, k: 1, cx: (Math.min(...xs) + Math.max(...xs)) / 2 + 0.5, cz: (Math.min(...zs) + Math.max(...zs)) / 2 + 0.5, len: Math.max(...(horiz ? xs : zs)) - Math.min(...(horiz ? xs : zs)) + 1 };
    this.socials.set(c.id, ev);
    TRAFFIC.close(tiles, `social${c.id}`);
    ev.homes = [];
    if (c.kind === 'riot') for (const p of this.stations(POLICE_IDS, ev.cx, ev.cz, 2)) { const from = this.frontTile(p); if (from >= 0) { ev.homes.push(from); TRAFFIC.dispatch('police', from, tiles[0], () => {}); } }
    this.list.push(ev); this.dirty = true;
  },

  /* ---------------- cambriolage : alarme, fuite, police ---------------- */
  burglary(b, arrested) {
    const D = this.door(b), ev = { type: 'burglary', b, t0: this.t, alarm: true, arrest: arrested, door: D, police: [], ft: this.frontTile(b) };
    const run = arrested ? 1.1 : 3.6, sd = Math.random() < 0.5 ? 1 : -1;
    ev.thieves = [0, 1].map((i) => ({ path: [[D.x, D.z], [D.sx + D.R[0] * 0.05 * i, D.sz + D.R[1] * 0.05 * i], [D.sx + D.R[0] * sd * run, D.sz + D.R[1] * sd * run + 0.03 * i]], t0: this.t + 1.4 + i * 0.35 }));
    const st = this.stations(POLICE_IDS, b.x, b.z, 1)[0];
    if (st && ev.ft >= 0) { ev.home = this.frontTile(st); ev.pendingPolice = [ev.home]; this.sendPolice(ev); }
    this.list.push(ev); this.dirty = true;
  },
  /* ---------------- braquage : voiture des braqueurs, fuite, barrage ---------------- */
  robbery(b, arrested) {
    const ft = this.frontTile(b); if (ft < 0) return;
    const D = this.door(b), W = this.map.W;
    const fx = (ft % W) + 0.5, fz = Math.floor(ft / W) + 0.5, ns = TRAFFIC.nb[ft * 4] >= 0 || TRAFFIC.nb[ft * 4 + 2] >= 0;
    const car = { x: fx - D.F[0] * 0.26, z: fz - D.F[1] * 0.26, ry: ns ? 0 : Math.PI / 2 };
    const exits = TRAFFIC.tiles.filter((i) => [0, 1, 2, 3].some((d) => TRAFFIC.out[i * 4 + d]));
    let route = null;
    for (let k = 0; k < 10 && exits.length; k++) {
      const e = exits[(Math.random() * exits.length) | 0], r = TRAFFIC.route(ft, e);
      if (r && r.length > 10 && (!route || Math.abs(r.length - 30) < Math.abs(route.length - 30))) route = r;
    }
    if (!route) return;
    const ev = { type: 'robbery', b, t0: this.t, bell: true, alarm: true, arrest: arrested, ft, car, door: D, police: [] };
    let home2 = -1;
    if (arrested) {
      let cut = -1;
      for (let k = 8; k < route.length - 1 && cut < 0; k += 2) {
        const tx = route[k] % W, tz = Math.floor(route[k] / W), s2 = this.stations(POLICE_IDS, tx, tz, 1)[0], h2 = s2 ? this.frontTile(s2) : -1, rp = h2 >= 0 ? TRAFFIC.route(h2, route[k]) : null;
        if (rp && rp.length * 1.05 < k + 6) { cut = k; home2 = h2; }
      }
      if (cut < 0) { cut = Math.min(route.length - 1, 14); const s2 = this.stations(POLICE_IDS, route[cut] % W, Math.floor(route[cut] / W), 1)[0]; home2 = s2 ? this.frontTile(s2) : -1; }
      route = route.slice(0, cut + 1);
    }
    ev.route = route; ev.dest = route[route.length - 1];
    ev.robbers = [0, 1, 2].map((i) => ({ path: [[D.x, D.z], [D.sx, D.sz], [car.x + D.F[0] * 0.09 + (i - 1) * 0.05 * D.R[0], car.z + D.F[1] * 0.09 + (i - 1) * 0.05 * D.R[1]]], t0: this.t + 2.3 + i * 0.3 }));
    const st = this.stations(POLICE_IDS, b.x, b.z, 1)[0];
    if (st) {
      ev.home = this.frontTile(st); ev.pendingPolice = [ev.home]; this.sendPolice(ev);
      if (arrested && home2 >= 0) { ev.home2 = home2; TRAFFIC.dispatch('police', home2, ev.dest, (v) => { if (ev.ended) { this.sendHome('police', ev.dest, home2); return; } ev.police.push({ ...this.park([...ev.police, ev.caught], v), home: home2, at: ev.dest }); this.dirty = true; }); }
    }
    this.list.push(ev); this.dirty = true;
  },
  sendPolice(ev) {
    if (!ev.pendingPolice) return;
    ev.pendingPolice = ev.pendingPolice.filter((home) => TRAFFIC.dispatch('police', home, ev.ft, (v) => this.policeAt(ev, v, home)) === null);
  },
  policeAt(ev, v, home) {
    if (ev.ended) { this.sendHome('police', ev.ft, home); return; }
    if (ev.type === 'robbery' && ev.left && ev.arrest && !ev.chasing) {
      ev.chasing = true;
      const r = TRAFFIC.dispatch('police', ev.ft, ev.dest, (w) => { if (ev.ended) { this.sendHome('police', ev.dest, home); return; } ev.police.push({ ...this.park([...ev.police, ev.caught], w), home, at: ev.dest }); this.dirty = true; }, { route: ev.route });
      if (!r) ev.police.push({ ...this.park(ev.police, v), home, at: ev.ft });
      return;
    }
    ev.police.push({ ...this.park(ev.police, v), home, at: ev.ft });
    ev.policeT = ev.policeT || this.t;
    this.dirty = true;
  },

  /* ---------------- démolition animée ---------------- */
  demolish(b) {
    const ghost = Object.assign({}, b, { state: undefined });
    const grp = this.world.buildAlone(ghost);
    this.list.push({ type: 'demolish', b: ghost, grp, t0: this.t, H: H_OF(b.def.v), y0: grp.position.y });
    this.dirty = true;
    HOOKS.sound('collapse', b.x + b.w / 2, b.z + b.h / 2);
  },

  /* ---------------- éléments à afficher ---------------- */
  anims() {
    const out = [], I = new THREE.Matrix4(), M = (x, y, z, ry = 0) => new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    const cop = (p, i, n = 2) => {
      out.push({ kind: 'policeVan', base: M(p.x, 0.024, p.z, p.ry), d: {} });
      out.push({ kind: 'beacon', base: M(p.x, 0.19, p.z - 0.03), d: { ph: i * 0.4 } });
      out.push({ kind: 'beaconBlue', base: M(p.x, 0.19, p.z + 0.03), d: { ph: i * 0.4 } });
      for (let k = 0; k < n; k++) out.push({ kind: 'person', base: M(p.x, 0.03, p.z, p.ry), d: { m: 'sway', x: k ? 0.15 : -0.15, z: 0.05 * k, ry: 0, seed: k * 3 + i, color: '#1f3a6e', far: true } });
    };
    for (const ev of this.list) {
      if (ev.type === 'fire') {
        ev.anims.forEach((a, i) => out.push({ kind: 'fire', base: I, d: { ...a, ev, ph: i * 1.7, far: true } }));
        if (ev.trucksGone) continue;
        ev.parked.forEach((p, i) => {
          out.push({ kind: 'fireTruckP', base: M(p.x, 0.024, p.z, p.ry), d: { ev } });
          out.push({ kind: 'beacon', base: M(p.x, 0.2, p.z, p.ry), d: { ph: i * 0.3, need: null } });
          if (!ev.out) for (const s of [-1, 1]) out.push({ kind: 'jet', base: M(p.x + Math.cos(p.aim) * s * 0.1, 0.1, p.z - Math.sin(p.aim) * s * 0.1, p.aim + s * 0.12), d: { pattern: 'arc', h: Math.min(1.4, 0.4 + p.dist * 0.45 + p.top * 0.3), tilt: 0.95, w: 1.6, ph: s, ev, fireJet: true } });
          for (let k = 0; k < 2; k++) out.push({ kind: 'person', base: M(p.x, 0.03, p.z, p.ry), d: { m: 'sway', x: (k ? 0.14 : -0.14), z: 0.1, ry: 0, seed: k * 3, color: '#2d3136' } });
        });
      } else if (ev.type === 'riot' || ev.type === 'protest') {
        const riot = ev.type === 'riot', hz = ev.horiz;
        const P = (along, across) => (hz ? [ev.cx + along, ev.cz + across] : [ev.cx + across, ev.cz + along]);
        const n = riot ? 30 : 26, rA = Math.max(0.8, ev.len / 2 - 0.2), rB = 0.42;
        for (let i = 0; i < n; i++) out.push({ kind: 'person', base: I, d: { m: 'riot', ev, i, n, calm: !riot, cx: ev.cx, cz: ev.cz, rx: hz ? rA : rB, rz: hz ? rB : rA, sp: riot ? 0.8 : 0.35, seed: i * 2.3, far: true, color: riot ? ['#2d3136', '#3a3f45', '#5a3b2a', '#1f2a44', '#d64a3a'][i % 5] : SHIRTS[i % SHIRTS.length] } });
        if (riot) {
          for (let i = 0; i < 8; i++) { const [x, z] = P(-rA - 0.35, -0.4 + i * 0.11); out.push({ kind: 'person', base: I, d: { m: 'sway', x, z, ry: hz ? Math.PI / 2 : 0, seed: i, far: true, color: '#1f3a6e' } }); }
          [[-0.5, -0.12, 0.6], [0.3, 0.18, -0.4], [rA * 0.8, -0.1, 1.9]].forEach(([a, b, r]) => {
            const [x, z] = P(a, b);
            out.push({ kind: 'wreck', base: M(x, 0.024, z, r + (hz ? 0 : Math.PI / 2)), d: { ev } });
            out.push({ kind: 'fire', base: I, d: { x, y: 0.1, z, s: 0.8, ev, ph: a * 3, far: true } });
          });
          if (!ev.done) for (const s of [-0.25, 0.25]) {
            const [x, z] = P(-rA - 0.9, s);
            out.push({ kind: 'policeVan', base: M(x, 0.024, z, hz ? Math.PI / 2 : 0), d: { ev } });
            out.push({ kind: 'beacon', base: M(x, 0.19, z - 0.03), d: { ph: s } });
            out.push({ kind: 'beaconBlue', base: M(x, 0.19, z + 0.03), d: { ph: s } });
          }
        }
      } else if (ev.type === 'burglary') {
        out.push({ kind: 'alarm', base: this.alarmAt(ev.b), d: { ev, far: true } });
        ev.thieves.forEach((th, i) => out.push({ kind: 'person', base: I, d: { m: 'run', path: th.path, t0: th.t0, sp: 0.75, hold: ev.arrest, ev, seed: i, color: '#232327', far: true } }));
        ev.police.forEach((p, i) => cop(p, i));
      } else if (ev.type === 'robbery') {
        const D = ev.door, c = ev.car;
        out.push({ kind: 'alarm', base: this.alarmAt(ev.b), d: { ev, far: true } });
        void D;
        if (!ev.left) {
          out.push({ kind: 'getawayP', base: M(c.x, 0.024, c.z, c.ry), d: { far: true } });
          out.push({ kind: 'hazard', base: M(c.x, 0.06, c.z, c.ry), d: { far: true } });
          ev.robbers.forEach((r, i) => out.push({ kind: 'person', base: I, d: { m: 'run', path: r.path, t0: r.t0, sp: 0.9, hold: false, ev, seed: i + 4, color: '#232327', far: true } }));
        }
        if (ev.caught) {
          const g = ev.caught, gone = () => ev.done;
          out.push({ kind: 'getawayP', base: M(g.x, 0.024, g.z, g.ry), d: { far: true, gone } });
          out.push({ kind: 'hazard', base: M(g.x, 0.06, g.z, g.ry), d: { far: true, gone, ph: 1 } });
          if (ev.arrestT) for (let k = 0; k < 3; k++) out.push({ kind: 'person', base: M(g.x, 0.03, g.z, g.ry), d: { m: 'run', path: [[0.16, -0.1 + k * 0.1], [0.17, -0.1 + k * 0.1]], t0: 0, sp: 1, hold: true, ev, seed: k, color: '#232327', far: true } });
        }
        ev.police.forEach((p, i) => cop(p, i));
      }
    }
    if (this.flood && this.flood.L > 0.3) {
      const f = this.flood;
      for (let i = 0; i < Math.min(4, Math.ceil((f.rx * f.rz) / 6)); i++) out.push({ kind: 'motorBoat', base: I, d: { m: 'flood', far: true, cx: f.cx, cz: f.cz, rx: f.rx, rz: f.rz, sp: 0.15, seed: i * 5, color: '#ff7a1e' } });
    }
    return out;
  },
  emitters() {
    const out = [];
    for (const ev of this.list) {
      if (ev.type === 'fire') {
        const b = ev.box, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, sz = ev.size;
        out.push({ type: 'smokeBlack', x: cx, y: b.max.y + 0.1, z: cz, acc: 0, s: 0.8 + sz * 0.6, kf: () => (ev.ended ? 0 : ev.k * (ev.fighting ? 0.7 : 1.2)) });
        out.push({ type: 'steamS', x: cx, y: b.max.y + 0.05, z: cz, acc: 0, s: 1.5 + sz, kf: () => (!ev.ended && !ev.out && ev.fighting && ev.parked.length ? 1.5 : 0) });
      } else if (ev.type === 'riot') {
        for (const a of [-0.5, 0.3, 0.8]) { const x = ev.horiz ? ev.cx + a : ev.cx, z = ev.horiz ? ev.cz : ev.cz + a; out.push({ type: 'smokeBlack', x, y: 0.25, z, acc: 0, s: 0.6, kf: () => (ev.wrecksGone ? 0 : ev.k) }); }
        for (let i = 0; i < 3; i++) out.push({ type: 'gas', x: ev.cx - 0.4 + i * 0.4, y: 0.06, z: ev.cz - 0.2 + i * 0.2, acc: 0, s: 1.4, kf: () => (ev.crowd > 0.2 && !ev.ending ? 1 : 0) });
      } else if (ev.type === 'demolish') {
        const b = ev.b, cx = b.x + b.w / 2, cz = b.z + b.h / 2;
        for (const [dx, dz] of [[-0.4, -0.4], [0.4, 0.4], [0.4, -0.4], [-0.4, 0.4], [0, 0]]) out.push({ type: 'dust', x: cx + dx * b.w, y: 0.1, z: cz + dz * b.h, acc: 0, s: 2.6 + ev.H * 0.4, l: 2.2, r: 4, kf: () => ev.dust || 0 });
      }
    }
    return out;
  },
  pools() {
    const out = [];
    for (const ev of this.list) if (ev.type === 'fire' && !ev.ended) { const b = ev.box; out.push({ x: (b.min.x + b.max.x) / 2, y: 0.05, z: (b.min.z + b.max.z) / 2, r: 1.2 + (b.max.x - b.min.x), col: '#ff7a2a' }); }
    return out;
  },

  /* ---------------- poubelles : niveau de déchets non collectés de la partie ---------------- */
  initBins() {
    const { road, idx, inside } = this.map, pos = [], tile = [], owner = [];
    for (const b of this.map.buildings) {
      if (!BIN_CATS.test(b.def.cat)) continue;
      const F = DIR4[b.rot], R = [-F[1], F[0]];
      const ext = F[0] ? b.w : b.h, wid = F[0] ? b.h : b.w;
      const x = b.x + b.w / 2 + F[0] * (ext / 2 - 0.09) + R[0] * (wid / 2 - 0.16), z = b.z + b.h / 2 + F[1] * (ext / 2 - 0.09) + R[1] * (wid / 2 - 0.16);
      const tx = Math.floor(x + F[0] * 0.6), tz = Math.floor(z + F[1] * 0.6);
      if (!inside(tx, tz) || !road[idx(tx, tz)]) continue;
      pos.push([x, b.alt * LEVEL_H + 0.03, z, Math.atan2(F[0], F[1])]); tile.push(idx(tx, tz)); owner.push(b);
    }
    for (const m of [this.binMesh, this.bagMesh]) if (m) { this.scene.remove(m); m.dispose(); }
    const n = pos.length;
    this.bins = { pos, tile, owner, byTile: new Map() };
    tile.forEach((t, i) => { if (!this.bins.byTile.has(t)) this.bins.byTile.set(t, []); this.bins.byTile.get(t).push(i); });
    this.binGeo ??= animGeo((g) => {
      g.box(0, 0, 0, 0.05, 0.07, 0.055, C('#ffffff'));
      g.box(0, 0.07, -0.004, 0.054, 0.008, 0.062, C('#2f3439'), { tint: false });
      g.box(0, 0.0, -0.03, 0.05, 0.012, 0.01, C('#1d2024'), { tint: false });
    });
    this.bagGeo ??= animGeo((g) => { // sacs empilés, cartons et détritus autour du bac
      const cols = ['#2b2b2e', '#3a3f45', '#2b2b2e', '#5a5f66'];
      for (let i = 0; i < 6; i++) { const a = i * 1.1; g.sphere(Math.cos(a) * 0.05, 0.02 + (i > 3 ? 0.03 : 0), Math.sin(a) * 0.05 + 0.02, 0.028, C(cols[i % 4]), { low: true, tint: false }); }
      g.box(0.06, 0, 0.05, 0.04, 0.03, 0.035, C('#c9a774'), { tint: false, ry: 0.4 }); g.box(-0.07, 0, 0.06, 0.03, 0.025, 0.03, C('#c9a774'), { tint: false, ry: -0.3 });
      for (let i = 0; i < 6; i++) g.box(Math.cos(i * 2.3) * 0.11, 0, Math.sin(i * 2.3) * 0.1 + 0.03, 0.02, 0.004, 0.015, C(['#e8e8e8', '#e2b13c', '#5f88b8', '#c8463a'][i % 4]), { tint: false, ry: i });
    });
    this.binMesh = new THREE.InstancedMesh(this.binGeo, LIFE.mats.anim, Math.max(1, n)); this.bagMesh = new THREE.InstancedMesh(this.bagGeo, LIFE.mats.anim, Math.max(1, n));
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) this.binMesh.setColorAt(i, c.set(['#3f8a4c', '#5d636b', '#e2b13c'][i % 3]));
    for (const mm of [this.binMesh, this.bagMesh]) { mm.frustumCulled = false; mm.count = n; this.scene.add(mm); }
    this.binT = 0; this.refreshBins();
  },
  garbageOf(i) {
    const B = this.bins, until = this.collected.get(B.tile[i]);
    if (until && until > this.t) return 0;
    const b = B.owner[i];
    return HOOKS.garbageAt(this.map.idx(Math.floor(b.x + b.w / 2), Math.floor(b.z + b.h / 2)));
  },
  binsNeed(tile) { const L = this.bins && this.bins.byTile.get(tile); return !!L && L.some((i) => this.garbageOf(i) > 0.3 && !this.bins.owner[i].state); },
  collectBins(tile) { this.collected.set(tile, this.t + 25); this.binDirty = true; }, // visuel seulement : la partie gère la collecte
  refreshBins() {
    const B = this.bins, m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
    B.pos.forEach(([x, y, z, ry], i) => {
      const gone = !!B.owner[i].state, f = gone ? 0 : this.garbageOf(i);
      const k = Math.max(0, Math.min(1, (f - 0.35) / 0.5));
      q.setFromAxisAngle(up, ry + i);
      this.bagMesh.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(k, k * (0.6 + 0.4 * k), k)));
      this.binMesh.setMatrixAt(i, gone ? m.makeScale(0, 0, 0) : m.compose(p.set(x, y, z), q.setFromAxisAngle(up, ry), s.set(1, 1, 1)));
    });
    this.bagMesh.instanceMatrix.needsUpdate = true; this.binMesh.instanceMatrix.needsUpdate = true;
  },

  /* ---------------- pluie et neige ---------------- */
  updateRain(t, cam) {
    const R = Math.max(this.rain, this.snow), m = this.rainMesh;
    m.visible = R > 0.01 && !!cam;
    if (!m.visible) return;
    const snow = this.snow > this.rain;
    m.material.color.set(snow ? '#ffffff' : '#c3cfdb'); m.material.opacity = snow ? 0.85 : 0.55;
    const spread = Math.max(5, Math.min(34, cam.d * 0.62)), H = 1.6 + cam.d * 0.22, n = Math.round(this.rainN * R), speed = snow ? 1.2 : 7.5;
    const M = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(snow ? 0 : 0.12, 0, snow ? 0 : 0.18)), p = new THREE.Vector3(), s = snow ? new THREE.Vector3(3.5, 0.17, 3.5) : new THREE.Vector3(1, 1 + cam.d * 0.02, 1);
    for (let i = 0; i < n; i++) {
      const h1 = hash2(i, 3, 11), h2 = hash2(i, 7, 13), h3 = hash2(i, 5, 17);
      const u = frac(t * (speed / H) + h3), sw = snow ? 0.25 * Math.sin(t * 1.3 + i) : u * 0.5;
      p.set(cam.tx + (h1 * 2 - 1) * spread + sw, H * (1 - u), cam.tz + (h2 * 2 - 1) * spread + (snow ? 0 : u * 0.35));
      m.setMatrixAt(i, M.compose(p, q, s));
    }
    m.count = n; m.instanceMatrix.needsUpdate = true;
  },
  /** Météo de la partie : pluie, orage, neige. */
  setWeather(kind, intensity = 0.6) {
    this.rainTarget = kind === 'rain' ? 0.35 + 0.5 * intensity : kind === 'storm' ? 1 : 0;
    this.snowTarget = kind === 'snow' ? 0.4 + 0.5 * intensity : 0;
  },

  /* ---------------- évolution ---------------- */
  update(dt, t, cam) {
    this.t = t;
    // météo
    const rt = Math.max(this.rainTarget ?? 0, this.flood && !this.flood.ending ? 0.8 : 0);
    this.rain += Math.max(-dt / 3, Math.min(dt / 3, rt - this.rain));
    this.snow += Math.max(-dt / 3, Math.min(dt / 3, (this.snowTarget ?? 0) - this.snow));
    // crue : montée en 3 s, décrue en 4 s ; le fleuve reste boueux un moment
    if (this.flood) {
      const f = this.flood;
      f.L = f.ending ? Math.max(0, f.L - dt / 4) : Math.min(1, f.L + dt / 3);
      if (this.floodMesh) this.floodMesh.position.y = -0.2 * (1 - smooth(f.L));
      this.mud = Math.max(this.mud, f.L);
      if (f.ending && f.L <= 0) { this.flood = null; if (this.floodMesh) { this.scene.remove(this.floodMesh); this.floodMesh.geometry.dispose(); this.floodMesh = null; } this.dirty = true; }
    } else this.mud = Math.max(0, this.mud - dt / 40);
    if (this.world.waterMat) this.world.waterMat.color.copy(this.waterBlue).lerp(this.waterMud, Math.min(1, this.mud) * 0.9);
    for (const ev of this.list) {
      const q = t - ev.t0;
      if (ev.type === 'fire') {
        if (ev.ended) {
          if (!ev.trucksGone && t - ev.endT > 3) { // les camions repartent vers leur caserne, sans gyrophare
            ev.trucksGone = true; ev.gone = true; this.dirty = true;
            for (const p of ev.parked) this.sendHome('firetruck', ev.dest, p.home);
          }
          continue;
        }
        if (ev.pending.length && (ev.retryT = (ev.retryT || 0) + dt) > 1) { ev.retryT = 0; this.sendTrucks(ev); }
        if (ev.out) ev.k = Math.max(0, ev.k - dt / 4);
        else ev.k = Math.min(ev.fighting ? 0.75 : 1, ev.k + dt / 5);
        if (ev.out && ev.k <= 0) { ev.ended = true; ev.endT = t; this.fires.delete(ev.b.id); this.dirty = true; }
      } else if (ev.type === 'riot' || ev.type === 'protest') {
        if (ev.ending) {
          const e = t - ev.endT;
          ev.crowd = Math.max(0, 1 - e / 6); ev.k = Math.max(0, 1 - e / 8);
          if (e > 8 && !ev.done) {
            ev.done = true; ev.wrecksGone = true; this.dirty = true; TRAFFIC.close([], `social${ev.id}`);
            for (const h of ev.homes) this.sendHome('police', ev.tiles[0], h);
          }
          if (e > 10) { ev.ended = true; this.socials.delete(ev.id); this.dirty = true; }
        }
      } else if (ev.type === 'demolish') {
        const g = ev.grp, b = ev.b;
        ev.dust = q < 0.6 ? q / 0.6 : q < 6 ? 1 : Math.max(0, 1 - (q - 6) / 3);
        if (q < 1) { g.position.x = b.x + b.w / 2 + Math.sin(q * 60) * 0.015; }
        else if (q < 5) { const u = smooth((q - 1) / 4); g.position.y = ev.y0 - u * ev.H * 0.85; g.scale.y = 1 - 0.75 * u; g.rotation.z = 0.05 * Math.sin(q * 3) * u; }
        else if (!ev.down) { ev.down = true; this.world.remove(g); }
        if (q > 9) { ev.ended = true; this.dirty = true; }
      } else if (ev.type === 'burglary') this.stepBurglary(ev, q, dt);
      else if (ev.type === 'robbery') this.stepRobbery(ev, q, dt);
    }
    this.updateRain(t, cam);
    const before = this.list.length;
    this.list = this.list.filter((e) => !(e.ended && (e.type !== 'fire' || e.gone)));
    if (this.list.length !== before) this.dirty = true;
    this.binT += dt;
    if (this.bins && (this.binT > 1 || this.binDirty)) { this.binT = 0; this.binDirty = false; this.refreshBins(); }
    if (this.dirty) { this.dirtyT = (this.dirtyT || 0) + dt; if (this.dirtyT > 0.3) { this.dirty = false; this.dirtyT = 0; this.world.recollect(); } }
  },
  stepBurglary(ev, q, dt) {
    if (ev.pendingPolice && ev.pendingPolice.length && (ev.retryT = (ev.retryT || 0) + dt) > 1) { ev.retryT = 0; this.sendPolice(ev); }
    const here = ev.police.length > 0;
    if (!here && q > 30 && ev.arrest) { ev.arrest = false; this.dirty = true; }
    if (here && this.t - ev.policeT > 6) ev.alarm = false;
    if (q > 16 && !here && !ev.pendingPolice?.length && !TRAFFIC.veh.some((v) => v.type === 'police' && v.emergency)) ev.alarm = false;
    if ((here && this.t - ev.policeT > 10) || q > 60) {
      ev.ended = true; ev.done = true; ev.alarm = false; this.dirty = true;
      for (const p of ev.police) this.sendHome('police', ev.ft, p.home);
    }
  },
  stepRobbery(ev, q, dt) {
    if (ev.pendingPolice && ev.pendingPolice.length && (ev.retryT = (ev.retryT || 0) + dt) > 1) { ev.retryT = 0; this.sendPolice(ev); }
    if (!ev.left && q > 4.6) {
      ev.left = true; this.dirty = true;
      const r = TRAFFIC.dispatch('getaway', ev.ft, ev.dest, (v) => {
        if (ev.arrest) { ev.caught = this.park(ev.police.filter((p) => p.at === ev.dest), v); ev.caughtT = this.t; } else ev.fled = true;
        this.dirty = true;
      }, { route: ev.route, spd: 0.15, t: 0.35 });
      if (!r) { ev.fled = !ev.arrest; if (ev.arrest) { ev.caught = { x: ev.car.x, z: ev.car.z, ry: ev.car.ry }; ev.caughtT = this.t; } }
      HOOKS.sound('screech', ev.car.x, ev.car.z);
    }
    if (ev.caught && !ev.arrestT && ev.police.some((p) => p.at === ev.dest)) { ev.arrestT = this.t; this.dirty = true; }
    const here = ev.police.some((p) => p.at === ev.ft);
    if (here && !ev.policeT) ev.policeT = this.t;
    if (ev.bell && (q > 30 || (ev.policeT && this.t - ev.policeT > 5))) ev.bell = false;
    ev.alarm = ev.bell;
    const end = ev.arrest ? ev.arrestT && this.t - ev.arrestT > 10 : ev.fled && here && this.t - ev.policeT > 10;
    if (end || q > 110) {
      ev.ended = true; ev.done = true; ev.bell = ev.alarm = false; this.dirty = true;
      for (const p of ev.police) this.sendHome('police', p.at ?? ev.dest, p.home);
    }
  },
  /** Sirènes en mouvement (pour le son) */
  sirens() { return TRAFFIC.sirens().map((v) => ({ x: v.rx, y: v.rz, type: v.type === 'firetruck' ? 'fire' : 'police' })); },
};


/* ---------- exports ---------- */
/** Maquette isolée d'un bâtiment (fantôme de placement) avec les matériaux fournis. */
function buildGroup(b, mats) {
  const T = { body: new Acc(), lit: new Acc(), litc: new Acc(), glow: new Acc() }; T.dark = T.body;
  const angle = [0, Math.PI / 2, Math.PI, Math.PI * 1.5][b.rot], lw = b.rot % 2 === 0 ? b.w : b.h, ld = b.rot % 2 === 0 ? b.h : b.w;
  const g2 = new Ctx([]); g2.frame(0, 0, 0, angle, T, mulberry32((b.id || 1) * 7919 + 13));
  if (b.water >= 0) { // rive dans le repère du bâtiment (comme dans la scène)
    const [wx, wz] = DIR4[b.water], c = Math.cos(-angle), s = Math.sin(-angle);
    b.waterLocal = [Math.round(wx * c + wz * s), Math.round(-wx * s + wz * c)];
  } else b.waterLocal = null;
  buildModel(g2, b.def, lw, ld, b);
  const grp = new THREE.Group();
  for (const k of ['body', 'lit', 'litc', 'glow']) if (T[k].count) grp.add(new THREE.Mesh(T[k].geometry(), mats[k] || mats.body));
  return grp;
}
export { THREE, STATE, HOOKS, setCatalog, buildWorld, buildGroup, LIFE, TRAFFIC, FX, U_NIGHT, LEVEL_H, WATER_Y, BED_Y, DIR4, hasTech, H_OF };
