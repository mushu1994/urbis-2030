import { THREE, STATE, HOOKS, setCatalog, buildWorld, buildGroup, LIFE, TRAFFIC, FX, U_NIGHT, LEVEL_H, WATER_Y, BED_Y } from './Engine3D.js';
import { MapMirror, nightOf, activeTechs, facingOf, waterSideOf, alt3, T3 } from './Adapter3D.js';
import { Sound3D } from './Sound3D.js';
import { OVERLAY_BY_ID } from '../rendering/Overlays.js';
import { SPEEDS } from '../simulation/SimulationClock.js';
import { seasonKey } from '../simulation/WeatherSystem.js';

/**
 * Vue 3D de la partie (v1.5) — Three.js. Second moteur d'affichage, interchangeable avec la vue isométrique 2D :
 * mêmes méthodes publiques (pointage des cases, aperçus de construction, sélection, couches, caméra).
 *
 * Il lit l'état (via le miroir d'Adapter3D) et les événements du bus ; il ne décide d'aucune règle et ne modifie
 * jamais la partie. Les animations (circulation, piétons, fumées, secours) sont décoratives et suivent les données
 * de la simulation : trafic et congestion, crises en cours, déchets non collectés, technologies et améliorations.
 */

const FOV = 38;
const SKY_DAY = new THREE.Color('#bcd6e8');
const SKY_NIGHT = new THREE.Color('#13213a');
const SKY_DUSK = new THREE.Color('#e9a77a');
const SKY_GREY = new THREE.Color('#a9b3bd');
const OK = new THREE.Color('#42d77d');
const BAD = new THREE.Color('#ff5050');
const TOP_EL = 1.553;
const ISO_EL = 0.78;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hexOf = (c) => (typeof c === 'number' ? c : parseInt(String(c).replace('#', ''), 16));

/* ───────────────────────────── Caméra orbitale ───────────────────────────── */

/**
 * Caméra : point visé (tx, tz), azimut, élévation, distance. Méthodes compatibles avec la caméra 2D
 * (pan, zoomAt, zoom, version) et gestes propres à la 3D (glisser ancré, inertie, torsion, inclinaison).
 */
export class Camera3D {
  constructor(r) {
    this.r = r;
    this.cam = { tx: 32, tz: 32, az: Math.PI / 4, el: ISO_EL, d: 34 };
    this.size = { W: 64, H: 64 };
    this.version = 0;
    this.tween = null;
    this.inertia = { vx: 0, vz: 0 };
    this.drag = null;
    this.gest = null;
  }

  get dMax() {
    return Math.max(60, Math.max(this.size.W, this.size.H) * 1.5);
  }

  /** Équivalent du zoom 2D (1 = vue moyenne) : sert au son et aux réglages qui en dépendent. */
  get zoom() {
    return clamp(34 / this.cam.d, 0.2, 2.5);
  }

  clamp() {
    const c = this.cam;
    c.d = clamp(c.d, 3, this.dMax);
    c.el = clamp(c.el, 0.2, TOP_EL);
    c.tx = clamp(c.tx, -4, this.size.W + 4);
    c.tz = clamp(c.tz, -4, this.size.H + 4);
    this.version++;
  }

  stop() {
    this.tween = null;
    this.inertia.vx = this.inertia.vz = 0;
  }

  flyTo(to, dur = 600) {
    const from = { ...this.cam };
    const target = { ...this.cam, ...to };
    let da = target.az - from.az;
    da = ((((da + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    target.az = from.az + da;
    this.tween = { from, to: target, t0: performance.now(), dur };
  }

  /** Déplacement en pixels d'écran (le contenu suit le geste), comme la caméra 2D. */
  pan(dx, dy) {
    const c = this.cam;
    const upp = (2 * c.d * Math.tan((FOV * Math.PI) / 360)) / Math.max(1, this.r.view.height);
    const rx = Math.cos(c.az);
    const rz = -Math.sin(c.az);
    const fx = -Math.sin(c.az);
    const fz = -Math.cos(c.az);
    const k = 1 / Math.max(0.35, Math.sin(c.el));
    c.tx += -dx * upp * rx + dy * upp * k * fx;
    c.tz += -dx * upp * rz + dy * upp * k * fz;
    this.tween = null;
    this.clamp();
  }

  /** Zoom vers le point de l'écran (facteur > 1 : rapproche). */
  zoomAt(factor, sx, sy) {
    const c = this.cam;
    const anchor = this.r.groundAt(sx, sy);
    c.d /= factor;
    this.tween = null;
    this.clamp();
    const cur = this.r.groundAt(sx, sy);
    if (anchor && cur) {
      c.tx += anchor.x - cur.x;
      c.tz += anchor.z - cur.z;
      this.clamp();
    }
  }

  /** Glisser ancré : le point saisi reste sous le doigt. */
  dragStart(x, y) {
    this.stop();
    this.drag = { anchor: this.r.groundAt(x, y), hist: [] };
  }

  dragTo(x, y) {
    const d = this.drag;
    if (!d?.anchor) return;
    const cur = this.r.groundAt(x, y);
    if (!cur) return;
    const dx = d.anchor.x - cur.x;
    const dz = d.anchor.z - cur.z;
    this.cam.tx += dx;
    this.cam.tz += dz;
    this.clamp();
    d.hist.push({ t: performance.now(), dx, dz });
    if (d.hist.length > 6) d.hist.shift();
  }

  /** Fin du glisser : lancer (inertie) si le geste était rapide. */
  dragEnd() {
    const h = this.drag?.hist;
    this.drag = null;
    if (!h || h.length < 2) return;
    const span = h[h.length - 1].t - h[0].t;
    if (span > 0 && performance.now() - h[h.length - 1].t < 60) {
      this.inertia.vx = (h.reduce((s, q) => s + q.dx, 0) / span) * 16;
      this.inertia.vz = (h.reduce((s, q) => s + q.dz, 0) / span) * 16;
    }
  }

  /** Clic droit (ou Ctrl/Alt + glisser) : tourner et incliner. */
  orbit(dx, dy) {
    this.stop();
    this.cam.az -= dx * 0.006;
    this.cam.el += dy * 0.005;
    this.clamp();
  }

  /**
   * Geste à deux doigts : pincer (zoom), tourner (torsion continue) et déplacer ; glisser verticalement les deux
   * doigts dans le même sens incline la vue.
   * @param {{x:number,y:number}[]} pts deux pointeurs (coordonnées locales)
   * @param {boolean} start premier appel du geste
   */
  gesture(pts, start) {
    const [a, b] = pts;
    if (!a || !b) return;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (start || !this.gest) {
      this.stop();
      this.gest = { mode: null, mx0: mx, my0: my, d0: dist, ang0: ang, cam0: { ...this.cam }, anchor: this.r.groundAt(mx, my), a0: { ...a }, b0: { ...b } };
      return;
    }
    const g = this.gest;
    if (!g.mode) {
      const day = a.y - g.a0.y;
      const dby = b.y - g.b0.y;
      const dax = a.x - g.a0.x;
      const dbx = b.x - g.b0.x;
      // décision quand les deux doigts ont bougé (les événements de chaque doigt arrivent l'un après l'autre)
      const ma = Math.hypot(dax, day);
      const mb = Math.hypot(dbx, dby);
      if (!((Math.max(ma, mb) > 10 && Math.min(ma, mb) > 4) || Math.max(ma, mb) > 40)) return;
      const sameV = Math.sign(day) === Math.sign(dby) && Math.abs(day) > 6 && Math.abs(dby) > 6;
      const vertical = Math.abs(day + dby) > 1.6 * Math.abs(dax + dbx);
      const spread = Math.abs(dist - g.d0) < 18;
      const level = Math.abs(g.a0.y - g.b0.y) < 0.75 * g.d0;
      g.mode = sameV && vertical && spread && level ? 'tilt' : 'transform';
      Object.assign(g, { mx0: mx, my0: my, d0: dist, ang0: ang, cam0: { ...this.cam }, anchor: this.r.groundAt(mx, my) });
      return;
    }
    const c = this.cam;
    if (g.mode === 'tilt') {
      c.el = g.cam0.el + (my - g.my0) * 0.0045;
      this.clamp();
      return;
    }
    c.d = g.cam0.d * (g.d0 / dist);
    c.az = g.cam0.az + (ang - g.ang0);
    this.clamp();
    const cur = this.r.groundAt(mx, my);
    if (cur && g.anchor) {
      c.tx += g.anchor.x - cur.x;
      c.tz += g.anchor.z - cur.z;
      this.clamp();
    }
  }

  gestureEnd() {
    this.gest = null;
  }

  /** Double appui : zoom vers le point touché. */
  doubleTap(x, y) {
    const g = this.r.groundAt(x, y);
    if (g) this.flyTo({ tx: g.x, tz: g.z, d: Math.max(3, this.cam.d * 0.55) }, 400);
  }

  update(dt) {
    const c = this.cam;
    if (this.tween) {
      const tw = this.tween;
      const u = Math.min(1, (performance.now() - tw.t0) / tw.dur);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      for (const k of ['tx', 'tz', 'az', 'el', 'd']) c[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      if (u >= 1) this.tween = null;
      this.clamp();
    }
    if (!this.drag && !this.gest && Math.abs(this.inertia.vx) + Math.abs(this.inertia.vz) > 1e-4) {
      c.tx += this.inertia.vx;
      c.tz += this.inertia.vz;
      const f = Math.pow(0.9, dt * 60);
      this.inertia.vx *= f;
      this.inertia.vz *= f;
      this.clamp();
    }
  }
}

/* ───────────────────────────── Lignes de bus et de tramway ───────────────────────────── */

/** Tracés des lignes et véhicules qui les parcourent (nombre = flotte en service calculée par la simulation). */
class Lines3D {
  constructor(r) {
    this.r = r;
    this.group = new THREE.Group();
    this.sig = '';
    this.time = 0;
    const body = new THREE.BoxGeometry(0.4, 0.13, 0.17).translate(0, 0.095, 0);
    const stripe = new THREE.BoxGeometry(0.405, 0.035, 0.175).translate(0, 0.12, 0);
    this.cap = 160;
    this.bodies = new THREE.InstancedMesh(body, new THREE.MeshLambertMaterial(), this.cap);
    this.stripes = new THREE.InstancedMesh(stripe, new THREE.MeshLambertMaterial({ emissive: new THREE.Color('#222'), emissiveIntensity: 0.3 }), this.cap);
    for (const m of [this.bodies, this.stripes]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color('#fff'));
    }
    this.routes = new THREE.Group();
    this.group.add(this.bodies, this.stripes, this.routes);
  }

  #points(state, line) {
    const g = state.grid;
    return line.path.map((i) => ({ x: g.xOf(i) + 0.5, z: g.yOf(i) + 0.5, y: this.r.surfaceY(g.xOf(i), g.yOf(i)) }));
  }

  #drawRoutes(state, lines, show, highlight) {
    const sig = show ? `${state.lines?.rev ?? 0}:${lines.length}:${highlight}:${lines.map((l) => `${l.id}${l.status}${l.color}${l.path?.length}`).join(',')}` : '';
    if (sig === this.sig) return;
    this.sig = sig;
    for (const c of [...this.routes.children]) {
      this.routes.remove(c);
      c.geometry.dispose();
      c.material.dispose();
    }
    if (!show) return;
    lines.forEach((line, k) => {
      if (!line.path?.length) return;
      const pts = this.#points(state, line);
      if (pts.length < 2) return;
      const strong = highlight === line.id;
      const w = strong ? 0.13 : 0.08;
      const off = (k % 5) * 0.07 - 0.14;
      const pos = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L;
        const nz = dx / L;
        const ya = a.y + 0.14;
        const yb = b.y + 0.14;
        const ax = a.x + nx * off;
        const az = a.z + nz * off;
        const bx = b.x + nx * off;
        const bz = b.z + nz * off;
        pos.push(ax - nx * w, ya, az - nz * w, bx - nx * w, yb, bz - nz * w, bx + nx * w, yb, bz + nz * w);
        pos.push(ax - nx * w, ya, az - nz * w, bx + nx * w, yb, bz + nz * w, ax + nx * w, ya, az + nz * w);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const broken = line.status !== 'ok';
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: broken ? '#9aa5b1' : line.color, transparent: true, opacity: broken ? 0.6 : 0.9, depthTest: false, side: THREE.DoubleSide }));
      mesh.renderOrder = 6;
      this.routes.add(mesh);
      for (const idx of line.stopAt ?? []) {
        const p = pts[idx];
        if (!p) continue;
        const disc = new THREE.Mesh(new THREE.CircleGeometry(strong ? 0.2 : 0.15, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }));
        disc.position.set(p.x, p.y + 0.16, p.z);
        disc.renderOrder = 7;
        this.routes.add(disc);
      }
    });
  }

  update(state, dt, show, highlight) {
    this.time += dt;
    const lines = state.lines?.list ?? [];
    this.#drawRoutes(state, lines, show, highlight);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    const shuttle = STATE.tech.has('autonomous_shuttles');
    let n = 0;
    for (const line of lines) {
      if (line.status !== 'ok' || !line.path?.length || !(line.stats?.effVehicles > 0)) continue;
      const pts = this.#points(state, line);
      const L = pts.length;
      if (L < 2) continue;
      const tram = line.mode === 'tram';
      const count = Math.min(16, Math.max(1, Math.round(line.stats.effVehicles)));
      const speed = tram ? 1.5 : 1.25;
      for (let k = 0; k < count && n < this.cap - 2; k++) {
        const sAt = (this.time * speed + (k * L) / count + (line.id % 5) * 1.7) % L;
        for (let car = 0; car < (tram ? 2 : 1); car++) {
          const sv = (((sAt - car * 0.44) % L) + L) % L;
          const a = Math.floor(sv);
          const b = (a + 1) % L;
          const f = sv - a;
          const A = pts[a];
          const B = pts[b];
          const dx = B.x - A.x;
          const dz = B.z - A.z;
          const len = Math.hypot(dx, dz) || 1;
          // voie de droite dans le sens de la marche
          const ox = (-dz / len) * 0.13;
          const oz = (dx / len) * 0.13;
          p.set(A.x + dx * f + ox, lerp(A.y, B.y, f) + 0.025, A.z + dz * f + oz);
          q.setFromAxisAngle(up, Math.atan2(-dz, dx));
          s.set(tram ? 1 : shuttle ? 0.75 : 1.05, 1, 1);
          m.compose(p, q, s);
          this.bodies.setMatrixAt(n, m);
          this.stripes.setMatrixAt(n, m);
          this.bodies.setColorAt(n, c.set(tram ? '#f3f5f7' : shuttle ? '#eef2f5' : '#f2c230'));
          this.stripes.setColorAt(n, c.set(line.color || '#3f6fb0'));
          n++;
        }
      }
    }
    for (const mesh of [this.bodies, this.stripes]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

/* ───────────────────────────── Icônes d'alerte ───────────────────────────── */

function iconTexture(kind) {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const x = cv.getContext('2d');
  x.fillStyle = 'rgba(28,28,30,0.82)';
  x.beginPath();
  x.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  x.fill();
  if (kind === 'power') {
    x.fillStyle = '#ffd23f';
    x.beginPath();
    x.moveTo(36, 10); x.lineTo(20, 36); x.lineTo(31, 36); x.lineTo(27, 54); x.lineTo(44, 27); x.lineTo(33, 27);
    x.closePath();
    x.fill();
  } else if (kind === 'water') {
    x.fillStyle = '#5cb7ff';
    x.beginPath();
    x.moveTo(32, 11);
    x.bezierCurveTo(44, 28, 47, 34, 47, 39);
    x.arc(32, 39, 15, 0, Math.PI);
    x.bezierCurveTo(17, 34, 20, 28, 32, 11);
    x.fill();
  } else {
    x.fillStyle = '#dddddd';
    x.fillRect(16, 28, 32, 8);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ───────────────────────────── Moteur de rendu 3D ───────────────────────────── */

export class Renderer3D {
  /** @param {{catalog: import('../data/Catalog.js').Catalog, audio?: any}} deps */
  constructor({ catalog, audio = null }) {
    this.catalog = catalog;
    this.is3d = true;
    this.mirror = new MapMirror(catalog);
    this.camera = new Camera3D(this);
    this.view = { width: 800, height: 600 };
    this.stats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 };
    this.effects = { night: 0, onThunder: null };
    this.airsea = { onSound: null };
    this.options = { dayNight: true, weather: true, effects: true, reducedMotion: false };
    this.selectedId = 0;
    this.hover = null;
    this.preview = null;
    this.overlayId = null;
    this.xray = false;
    this.gridLines = false;
    this.vehiclesOn = true;
    this.showRoutes = false;
    this.routeHighlight = 0;
    this.unsub = [];
    this.session = null;
    this.world = null;
    this.map = null;
    this.phase = 0;
    this.animT = 0;
    this.sound = audio ? new Sound3D(audio) : null;
    this.active = false;
  }

  /** Crée le contexte WebGL (lève une erreur si la 3D n'est pas disponible). */
  async init(parent) {
    this.parent = parent;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.coarse = coarse;
    const canvas = document.createElement('canvas');
    canvas.className = 'view3d';
    canvas.setAttribute('aria-label', 'Carte de la ville en 3D');
    const r = new THREE.WebGLRenderer({ canvas, antialias: !coarse || (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
    this.gl = r;
    r.shadowMap.enabled = !coarse;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;
    r.info.autoReset = false;
    parent.appendChild(canvas);
    this.setRenderScale('auto');
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.world?.markAll();
      this.shadowDirty = true;
    });
    this.#resize();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.#resize()).observe(parent);
    window.addEventListener('resize', () => this.#resize());
    this.#newScene();
  }

  get canvas() {
    return this.gl?.domElement;
  }

  #resize() {
    if (!this.gl || !this.parent) return;
    const w = Math.max(1, this.parent.clientWidth);
    const h = Math.max(1, this.parent.clientHeight);
    this.gl.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.view.width = w;
    this.view.height = h;
    if (this.cam3) {
      this.cam3.aspect = w / h;
      this.cam3.updateProjectionMatrix();
    }
    this.camera.version++;
    this.shadowDirty = true;
  }

  /** Scène neuve : lumières, matériaux, plateau, calques de sélection et d'information. */
  #newScene() {
    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(FOV, this.view.width / this.view.height, 0.1, 900);
    this.cam3 = camera;
    scene.background = SKY_DAY.clone();
    scene.fog = new THREE.Fog(SKY_DAY.clone(), 80, 260);
    this.hemi = new THREE.HemisphereLight('#e6f1ff', '#8f9580', 1.35);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#fff4e2', 1.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.coarse ? 2048 : 4096, this.coarse ? 2048 : 4096);
    const sc = sun.shadow.camera;
    sc.left = -66; sc.right = 66; sc.top = 66; sc.bottom = -66; sc.near = 10; sc.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sun = sun;
    this.mats = {
      body: new THREE.MeshLambertMaterial({ vertexColors: true }),
      lit: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color('#ffc977'), emissiveIntensity: 0 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      litc: new THREE.MeshLambertMaterial({ vertexColors: true })
    };
    this.mats.litc.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = U_NIGHT;
      sh.fragmentShader = 'uniform float uNight;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor * uNight * 0.9;');
    };
    this.table = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#56704a' }));
    this.table.position.y = -1.02;
    scene.add(this.table);
    // sélection, aperçus, couches d'information, alertes, lignes
    this.selGroup = new THREE.Group();
    this.selGroup.renderOrder = 8;
    this.overlayGroup = new THREE.Group();
    this.alertGroup = new THREE.Group();
    this.gridGroup = new THREE.Group();
    scene.add(this.selGroup, this.overlayGroup, this.alertGroup, this.gridGroup);
    this.lines = new Lines3D(this);
    scene.add(this.lines.group);
    this.icons ??= { power: iconTexture('power'), water: iconTexture('water'), abandoned: iconTexture('abandoned') };
    this.alertSprites = [];
    this.ghostGroup = new THREE.Group();
    scene.add(this.ghostGroup);
    this.ghostKey = '';
    this.shadowDirty = true;
  }

  /* ───────────────────────────── Partie ───────────────────────────── */

  /** Associe une partie : construit le miroir, la scène et s'abonne aux événements. */
  attach(session) {
    this.detach();
    if (!this.gl) return;
    this.session = session;
    const state = session.state;
    if (this.world) this.#disposeScene();
    this.#newScene();
    const map = this.mirror.build(state);
    this.map = map;
    map.snow = this.#snowLevel(state);
    this.roadCache = map.road.slice();
    this.firstFlushDone = false;
    setCatalog(this.mirror.cat);
    STATE.tech = activeTechs(state);
    STATE.anim = this.options.effects && !this.options.reducedMotion;
    HOOKS.sound = (name, x, z) => this.sound?.shot(name, x, z);
    HOOKS.garbageAt = (i) => this.session?.state.grid.garbage?.[i] ?? 0;
    this.world = buildWorld(map, this.mirror.cat, this.mats, this.scene);
    TRAFFIC.target = null;
    TRAFFIC.init(map, this.mirror.cat, this.scene);
    FX.init(this.world, map, this.scene);
    this.world.flush();
    this.#flows(state, true);
    FX.sync(state, {});
    this.sound?.setMap(map);
    this.sound?.setCamera(this.cam3, this.camera.cam);
    this.camera.size = { W: map.W, H: map.H };
    this.camera.stop();
    const entry = state.entries?.[0];
    const c = this.camera.cam;
    if (entry !== undefined) {
      c.tx = state.grid.xOf(entry) + 7.5;
      c.tz = state.grid.yOf(entry) - 2.5;
    } else {
      c.tx = map.W / 2;
      c.tz = map.H / 2;
    }
    c.d = 30;
    this.camera.clamp();
    this.phase = (state.time.tick % 30) / 30;
    this.techSig = [...STATE.tech].sort().join(',');
    this.dirty = false;
    this.syncT = 0;
    this.flowT = 0;
    this.trafficDirty = 0;
    this.binsDirty = false;
    this.selDirty = true;
    this.overlayDirty = true;
    this.gridDirty = true;
    const bus = session.bus;
    const mark = () => {
      this.dirty = true;
    };
    this.unsub.push(
      bus.on('world:changed', () => {
        this.dirty = true;
        this.overlayDirty = true;
        this.selDirty = true;
        this.gridDirty = true;
      }),
      bus.on('building:added', mark),
      bus.on('building:changed', mark),
      bus.on('building:removed', mark),
      bus.on('network:rebuilt', mark),
      bus.on('sync:dirty', () => {
        this.dirty = true;
        this.overlayDirty = true;
        this.selDirty = true;
      }),
      bus.on('crisis:started', mark),
      bus.on('crisis:ended', mark),
      bus.on('land:changed', () => {
        this.dirty = true;
        this.gridDirty = true;
      }),
      bus.on('weather:changed', mark),
      bus.on('sim:month', mark),
      bus.on('fields:updated', ({ fields } = {}) => {
        this.overlayDirty = true;
        if (fields?.includes?.('traffic')) this.flowT = 1e9;
      })
    );
    this.camera.cam.az = this.#azOf(this.viewRot ?? 0);
    this.camera.cam.el = this.viewTop ? TOP_EL : ISO_EL;
    this.camera.stop();
    this.camera.clamp();
  }

  detach() {
    for (const off of this.unsub) off();
    this.unsub = [];
    this.session = null;
  }

  #disposeScene() {
    TRAFFIC.dispose?.();
    FX.dispose?.();
    this.world?.dispose();
    this.world = null;
    this.scene?.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
  }

  destroy() {
    this.detach();
    if (this.world) this.#disposeScene();
    this.sound?.dispose();
    this.gl?.dispose();
    this.canvas?.remove();
    this.gl = null;
  }

  /** Vue 3D affichée ou masquée (bascule 2D/3D) : le son spatial ne joue que dans la vue active. */
  setActive(on) {
    this.active = !!on;
    if (this.canvas) this.canvas.style.display = on ? 'block' : 'none';
    this.sound?.setActive(on);
    if (on) {
      this.dirty = true;
      this.shadowDirty = true;
    }
  }

  #snowLevel(state) {
    const cover = state.weather?.snowCover ?? 0;
    return cover >= 0.7 ? 2 : cover >= 0.3 ? 1 : 0;
  }

  /** Volumes de circulation de la partie → nombre de véhicules et lenteurs (bouchons) dans la scène. */
  #flows(state, force = false) {
    const g = state.grid;
    const pop = state.stats?.population ?? 0;
    if (!TRAFFIC.tiles) return;
    const respawn = TRAFFIC.setFlows(g.traffic, g.congestion, pop);
    if (respawn || force) TRAFFIC.respawn();
  }

  /** Rapproche la scène de l'état : cases et bâtiments modifiés, crises, technologies, météo. */
  #sync() {
    const state = this.session.state;
    const ch = this.mirror.sync(state);
    const world = this.world;
    if (ch.rebuilt) {
      this.attach(this.session);
      return;
    }
    let roads = false;
    if (ch.tiles?.size) {
      const marks = new Set();
      const W = this.map.W;
      for (const i of ch.tiles) {
        marks.add(i);
        const x = i % W;
        const z = (i / W) | 0;
        if (x > 0) marks.add(i - 1);
        if (x < W - 1) marks.add(i + 1);
        if (z > 0) marks.add(i - W);
        if (z < this.map.H - 1) marks.add(i + W);
      }
      world.markTiles(marks);
      roads = true;
      this.overlayDirty = true;
      this.gridDirty = true;
    }
    if (ch.changed.length || ch.removed.length) {
      world.markBuildings(ch.changed);
      for (const b of ch.changed) if (b.prev) world.markBuildings([{ ...b, ...b.prev }]);
      world.markBuildings(ch.removed);
      this.binsDirty = true;
      this.selDirty = true;
    }
    const snow = this.#snowLevel(state);
    if (snow !== this.map.snow) {
      this.map.snow = snow;
      world.markAll();
    }
    // technologies en service (une panne ou une cyberattaque les coupe aussi à l'écran)
    const tech = activeTechs(state);
    const sig = [...tech].sort().join(',');
    if (sig !== this.techSig) {
      this.techSig = sig;
      STATE.tech = tech;
      TRAFFIC.refreshTech?.();
      world.markAll();
      this.trafficDirty = performance.now();
    }
    if (roads && this.#roadsChanged(ch.tiles)) this.trafficDirty = performance.now();
    FX.sync(state, { removed: ch.removed });
    const w = state.weather ?? {};
    if (this.options.weather) FX.setWeather(w.kind ?? 'clear', w.intensity ?? 0.5);
    else FX.setWeather('clear');
  }

  /** Une case modifiée touche-t-elle le réseau routier (ajout ou retrait de route) ? */
  #roadsChanged(tiles) {
    const r = this.map.road;
    const prev = (this.roadCache ??= new Uint8Array(r.length));
    let changed = false;
    if (prev.length !== r.length) {
      this.roadCache = r.slice();
      return true;
    }
    for (const i of tiles) {
      if (prev[i] !== r[i]) {
        prev[i] = r[i];
        changed = true;
      }
    }
    return changed;
  }

  /* ───────────────────────────── Géométrie de pointage ───────────────────────────── */

  /** Hauteur de la surface praticable d'une case (tablier d'un pont, eau, sol). */
  surfaceY(x, z) {
    const m = this.map;
    if (!m || !m.inside(x, z)) return 0;
    const i = m.idx(x, z);
    if (m.terr[i] === T3.WATER) return m.bridge[i] ? Math.max(0, m.bridge[i] - 1) * LEVEL_H + 0.03 : WATER_Y;
    return m.alt[i] * LEVEL_H + (m.road[i] ? 0.03 : 0);
  }

  #updateCamera() {
    const c = this.camera.cam;
    const cam = this.cam3;
    const ce = Math.cos(c.el);
    const ty = this.map ? this.surfaceY(Math.floor(c.tx), Math.floor(c.tz)) * 0.6 : 0;
    // en vue de dessus, une infime inclinaison garde l'orientation (le nord ne bascule pas)
    cam.position.set(c.tx + c.d * ce * Math.sin(c.az), ty + c.d * Math.sin(c.el), c.tz + c.d * ce * Math.cos(c.az));
    cam.up.set(0, 1, 0);
    cam.lookAt(c.tx, ty, c.tz);
    cam.updateMatrixWorld();
    this.scene.fog.near = c.d * 1.4 + 20;
    this.scene.fog.far = c.d * 3.2 + 120;
    this.targetY = ty;
  }

  #setRay(sx, sy) {
    this.#updateCamera();
    this.ndc ??= new THREE.Vector2();
    this.ray ??= new THREE.Raycaster();
    this.ndc.set((sx / this.view.width) * 2 - 1, -(sy / this.view.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.cam3);
    return this.ray.ray;
  }

  /** Point du sol (plan horizontal) sous un point de l'écran. */
  groundAt(sx, sy, y = this.targetY ?? 0) {
    if (!this.cam3) return null;
    const ray = this.#setRay(sx, sy);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const hit = new THREE.Vector3();
    return ray.intersectPlane(plane, hit) ? hit : null;
  }

  /** Case pointée : la première case dont la surface est atteinte le long du rayon (relief compris). */
  tileAtScreen(sx, sy) {
    if (!this.session || !this.map) return null;
    const m = this.map;
    const ray = this.#setRay(sx, sy);
    const o = ray.origin;
    const d = ray.direction;
    const yTop = 4 * LEVEL_H + 0.1;
    let t = 0;
    if (o.y > yTop) {
      if (d.y >= 0) return null;
      t = (yTop - o.y) / d.y;
    }
    const hstep = 0.04;
    const step = hstep / Math.max(0.05, Math.hypot(d.x, d.z));
    for (let n = 0; n < 6000; n++, t += step) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      const tx = Math.floor(x);
      const tz = Math.floor(z);
      if (m.inside(tx, tz) && y <= this.surfaceY(tx, tz) + 0.001) return { x: tx, y: tz };
      if (y < BED_Y - 0.2) break;
    }
    const g = this.groundAt(sx, sy, 0);
    if (!g) return null;
    const tx = Math.floor(g.x);
    const tz = Math.floor(g.z);
    return m.inside(tx, tz) ? { x: tx, y: tz } : null;
  }

  /** Bâtiment sous un point de l'écran (boîte englobante la plus proche), 0 si aucun. */
  buildingAtScreen(sx, sy) {
    if (!this.session || !this.world || this.xray || this.overlayId) return 0;
    const ray = this.#setRay(sx, sy);
    const hit = new THREE.Vector3();
    let best = 0;
    let bd = Infinity;
    for (const p of this.world.picks) {
      if (p.b.state === 'demolishing' || !ray.intersectBox(p.box, hit)) continue;
      const dist = hit.distanceTo(ray.origin);
      if (dist < bd) {
        bd = dist;
        best = p.b.id;
      }
    }
    return best;
  }

  /** Position écran du centre d'une case. */
  tileToScreen(x, y) {
    this.#updateCamera();
    const v = new THREE.Vector3(x + 0.5, this.surfaceY(x, y), y + 0.5).project(this.cam3);
    return { x: ((v.x + 1) / 2) * this.view.width, y: ((1 - v.y) / 2) * this.view.height };
  }

  /* ───────────────────────────── Réglages et vues ───────────────────────────── */

  #azOf(rot) {
    return Math.PI / 4 + rot * (Math.PI / 2);
  }

  /** Orientation (quarts de tour, +1 = sens horaire) et vue de dessus, comme en 2D ; transitions animées. */
  setViewMode({ rot, top, exact = false } = {}) {
    const cur = this.viewMode;
    if (rot === undefined) rot = this.session ? cur.rot : this.viewRot ?? 0;
    if (top === undefined) top = this.session ? cur.top : this.viewTop ?? false;
    const r = ((rot % 4) + 4) % 4;
    this.viewRot = r;
    this.viewTop = !!top;
    if (!this.session) return;
    const c = this.camera.cam;
    const to = {};
    // un quart de tour dans le sens demandé (ou retour exact au nord), la rotation libre est conservée sinon
    if (rot !== cur.rot) to.az = c.az + (rot - cur.rot) * (Math.PI / 2);
    if (exact) to.az = this.#azOf(r);
    if (top !== cur.top || exact) to.el = top ? TOP_EL : ISO_EL;
    if (Object.keys(to).length) this.camera.flyTo(to, 500);
  }

  /** Place la vue sur une case sans animation (bascule 2D → 3D). */
  lookAt(x, y) {
    const c = this.camera.cam;
    this.camera.stop();
    c.tx = x + 0.5;
    c.tz = y + 0.5;
    this.camera.clamp();
  }

  /** Ombres portées (réglage) : désactivées par défaut sur les écrans tactiles, plus économes. */
  setShadows(on) {
    if (!this.gl) return;
    const v = on === undefined ? !this.coarse : !!on;
    if (this.gl.shadowMap.enabled === v) return;
    this.gl.shadowMap.enabled = v;
    if (this.sun) this.sun.castShadow = v;
    for (const m of Object.values(this.mats ?? {})) m.needsUpdate = true;
    this.shadowDirty = true;
  }

  get viewMode() {
    const c = this.camera.cam;
    const rot = Math.round((c.az - Math.PI / 4) / (Math.PI / 2));
    return { rot: ((rot % 4) + 4) % 4, top: c.el > 1.4 };
  }

  /** Direction du nord (y décroissant de la grille) à l'écran, en degrés (boussole). */
  northAngle() {
    // nord = −z ; à l'écran, droite = (cos az, −sin az) et haut = (−sin az, −cos az) : l'aiguille fait l'angle az
    return (this.camera.cam.az * 180) / Math.PI;
  }

  setEffects(options) {
    Object.assign(this.options, options);
    STATE.anim = this.options.effects && !this.options.reducedMotion;
    if (!this.options.weather) FX.setWeather?.('clear');
  }

  setShowRoutes(on, highlight = 0) {
    this.showRoutes = !!on;
    this.routeHighlight = highlight;
  }

  setPreview(preview) {
    this.preview = preview;
    this.selDirty = true;
  }

  setHover(tile) {
    const same = tile && this.hover && tile.x === this.hover.x && tile.y === this.hover.y;
    if (same || (!tile && !this.hover)) return;
    this.hover = tile;
    this.selDirty = true;
  }

  setSelected(id) {
    this.selectedId = id || 0;
    this.selDirty = true;
  }

  setOverlay(id) {
    this.overlayId = id;
    this.overlayDirty = true;
    this.#applyFade();
  }

  setXray(on) {
    this.xray = !!on;
    this.#applyFade();
  }

  setGridLines(on) {
    this.gridLines = !!on;
    this.gridDirty = true;
  }

  setVehicles(on) {
    this.vehiclesOn = on !== false;
  }

  setRenderScale(scale) {
    if (!this.gl) return;
    // écran tactile : résolution plafonnée à 1,5 (la 3D coûte plus cher que la 2D, l'autonomie compte)
    const base = Math.min(this.coarse ? 1.5 : 2, window.devicePixelRatio || 1);
    const res = scale === 'auto' || !scale ? base : Math.max(0.5, base * Number(scale));
    this.gl.setPixelRatio(res);
    this.#resize();
  }

  /** Couche d'information ou transparence : bâtiments estompés pour lire le sol. */
  #applyFade() {
    const fade = !!this.overlayId || this.xray;
    if (!this.mats) return;
    for (const m of Object.values(this.mats)) {
      m.transparent = fade;
      m.opacity = fade ? (this.xray ? 0.35 : 0.3) : 1;
      m.depthWrite = !fade;
      m.needsUpdate = true;
    }
  }

  /** Centre la vue sur une case (rapproche la caméra si elle est très loin). */
  focus(x, y) {
    const c = this.camera.cam;
    this.camera.stop();
    this.camera.flyTo({ tx: x + 0.5, tz: y + 0.5, d: Math.min(c.d, 26) }, 550);
  }

  /* ───────────────────────────── Calques ───────────────────────────── */

  #clearGroup(g) {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o) => {
        if (o.geometry && !o.userData.keepGeo) o.geometry.dispose();
        if (o.material && !o.userData.keepMat) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
    }
  }

  /** Quadrilatères colorés posés sur les cases (aperçus, couches). */
  #tileQuads(list, lift = 0.035, opts = {}) {
    const pos = new Float32Array(list.length * 18);
    const col = new Float32Array(list.length * 24);
    const c = new THREE.Color();
    list.forEach(([x, z, color, alpha], k) => {
      const y = this.surfaceY(x, z) + lift;
      const e = opts.inset ?? 0.03;
      const P = [x + e, z + e, x + 1 - e, z + e, x + 1 - e, z + 1 - e, x + e, z + e, x + 1 - e, z + 1 - e, x + e, z + 1 - e];
      for (let v = 0; v < 6; v++) {
        pos[k * 18 + v * 3] = P[v * 2];
        pos[k * 18 + v * 3 + 1] = y;
        pos[k * 18 + v * 3 + 2] = P[v * 2 + 1];
        c.set(color);
        col.set([c.r, c.g, c.b, alpha], k * 24 + v * 4);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: opts.depthTest ?? true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    mesh.renderOrder = opts.order ?? 5;
    return mesh;
  }

  #outline(x, z, w, h, color, y) {
    const pts = [x, z, x + w, z, x + w, z + h, x, z + h, x, z];
    const p = [];
    for (let i = 0; i < 4; i++) p.push(pts[i * 2], y, pts[i * 2 + 1], pts[i * 2 + 2], y, pts[i * 2 + 3]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    l.renderOrder = 9;
    return l;
  }

  #ring(cx, cz, r, color, y) {
    const p = [];
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      p.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75, depthTest: false }));
    l.renderOrder = 9;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, depthWrite: false, depthTest: false }));
    disc.position.set(cx, y, cz);
    disc.renderOrder = 4;
    const g = new THREE.Group();
    g.add(l, disc);
    return g;
  }

  /** Fantôme du bâtiment à poser (modèle 3D translucide, vert ou rouge) ; reconstruit seulement s'il change. */
  #ghost(spec) {
    const def3 = spec ? this.mirror.cat.byId.get(spec.def?.id) : null;
    const state = this.session.state;
    const g = state.grid;
    if (!def3 || !g.inBounds(spec.x, spec.y)) {
      if (this.ghostKey) {
        this.#clearGroup(this.ghostGroup);
        this.ghostKey = '';
      }
      return;
    }
    const fake = { x: spec.x, y: spec.y, w: spec.w, h: spec.h, rot: 0, access: -1, defId: def3.id };
    const rot = facingOf(state, fake, def3.id);
    const key = `${def3.id}:${spec.x},${spec.y},${spec.w},${spec.h}:${rot}:${spec.ok}`;
    if (key === this.ghostKey) return;
    this.#clearGroup(this.ghostGroup);
    this.ghostKey = key;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, color: spec.ok ? '#c8ffd9' : '#ffb0b0', transparent: true, opacity: 0.62, depthWrite: false, emissive: new THREE.Color(spec.ok ? '#0c3a1c' : '#4a0c0c') });
    const b = { id: 1, def: def3, x: spec.x, z: spec.y, w: spec.w, h: spec.h, rot, alt: alt3(g, g.idx(spec.x, spec.y)), water: def3.water ? waterSideOf(state, fake) : -1, ups: new Set() };
    let grp;
    try {
      grp = buildGroup(b, { body: mat, lit: mat, litc: mat, glow: mat });
    } catch {
      mat.dispose();
      return;
    }
    grp.position.set(spec.x + spec.w / 2, b.alt * LEVEL_H + 0.01, spec.y + spec.h / 2);
    grp.traverse((o) => {
      o.renderOrder = 7;
    });
    // matériau partagé par les maillages du fantôme : libéré une seule fois
    grp.children.forEach((o, k) => {
      if (k) o.userData.keepMat = true;
    });
    this.ghostGroup.add(grp);
  }

  #drawSelection() {
    const state = this.session.state;
    const grid = state.grid;
    this.#ghost(this.preview?.kind === 'building' ? this.preview : null);
    this.#clearGroup(this.selGroup);
    const add = (o) => o && this.selGroup.add(o);
    const sel = this.selectedId ? state.buildings.get(this.selectedId) : null;
    if (sel) {
      const def = this.catalog.building(sel.defId);
      const pick = this.world.picks.find((p) => p.b.id === sel.id);
      if (pick) {
        const bx = pick.box;
        const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(bx.max.x - bx.min.x + 0.06, bx.max.y - bx.min.y + 0.04, bx.max.z - bx.min.z + 0.06).translate(0, (bx.max.y - bx.min.y) / 2, 0));
        const box = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#ffd34d', depthTest: false, transparent: true }));
        box.position.set((bx.min.x + bx.max.x) / 2, bx.min.y, (bx.min.z + bx.max.z) / 2);
        box.renderOrder = 10;
        add(box);
      }
      add(this.#tileQuads(this.#rectTiles(sel.x, sel.y, sel.w, sel.h, '#ffd34d', 0.28), 0.04));
      const svc = def.capacity.service ?? def.capacity.logistics;
      if (svc?.radius) add(this.#ring(sel.x + sel.w / 2, sel.y + sel.h / 2, svc.radius, '#ffd34d', this.surfaceY(sel.x, sel.y) + 0.06));
    }
    const pv = this.preview;
    if (pv) {
      const color = pv.ok ? OK : BAD;
      if (pv.kind === 'road') {
        const list = (pv.tiles ?? []).map((t) => [t.x, t.y, t.status === 'invalid' ? BAD : t.status === 'same' ? new THREE.Color('#9aa5b1') : pv.ok ? OK : new THREE.Color('#ffb347'), 0.5]);
        if (list.length) add(this.#tileQuads(list, 0.05));
      } else if (pv.kind === 'rect') {
        const { x0, y0, x1, y1 } = pv.rect;
        const eligible = pv.eligible ? new Set(pv.eligible) : null;
        const zc = pv.color ? new THREE.Color(pv.color) : color;
        const list = [];
        for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(grid.height - 1, Math.max(y0, y1)); y++) {
          for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(grid.width - 1, Math.max(x0, x1)); x++) {
            const ok = eligible ? eligible.has(grid.idx(x, y)) : true;
            list.push([x, y, ok ? (pv.ok ? zc : BAD) : new THREE.Color('#555555'), ok ? 0.45 : 0.14]);
          }
        }
        if (list.length) add(this.#tileQuads(list, 0.05));
      } else if (pv.kind === 'building') {
        const list = [];
        for (let dy = 0; dy < pv.h; dy++) for (let dx = 0; dx < pv.w; dx++) if (grid.inBounds(pv.x + dx, pv.y + dy)) list.push([pv.x + dx, pv.y + dy, color, 0.32]);
        if (list.length) add(this.#tileQuads(list, 0.045));
        if (grid.inBounds(pv.x, pv.y)) {
          const y = this.surfaceY(pv.x, pv.y) + 0.06;
          add(this.#outline(pv.x, pv.y, pv.w, pv.h, color, y));
          const svc = pv.def?.capacity?.service ?? pv.def?.capacity?.logistics;
          if (svc?.radius) add(this.#ring(pv.x + pv.w / 2, pv.y + pv.h / 2, svc.radius, '#6ec6ff', y));
        }
      }
    }
    if (this.hover && grid.inBounds(this.hover.x, this.hover.y) && !pv) add(this.#tileQuads([[this.hover.x, this.hover.y, '#ffffff', 0.28]], 0.05));
  }

  #rectTiles(x0, y0, w, h, color, alpha) {
    const out = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y, color, alpha]);
    return out;
  }

  #drawOverlay() {
    this.#clearGroup(this.overlayGroup);
    const ov = this.overlayId ? OVERLAY_BY_ID.get(this.overlayId) : null;
    if (!ov || !this.session) return;
    const state = this.session.state;
    const grid = state.grid;
    const list = [];
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const c = ov.color(state, grid.idx(x, y), this.catalog);
        if (c < 0) continue;
        list.push([x, y, hexOf(c), 0.78]);
      }
    }
    if (list.length) this.overlayGroup.add(this.#tileQuads(list, 0.06, { inset: 0, order: 3 }));
  }

  #drawGrid() {
    this.#clearGroup(this.gridGroup);
    if (!this.gridLines || !this.map) return;
    const m = this.map;
    const p = [];
    for (let z = 0; z < m.H; z++) {
      for (let x = 0; x < m.W; x++) {
        const y = this.surfaceY(x, z) + 0.04;
        p.push(x, y, z, x + 1, y, z, x, y, z, x, y, z + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false }));
    l.renderOrder = 2;
    this.gridGroup.add(l);
  }

  /** Icônes au-dessus des bâtiments sans électricité, sans eau ou abandonnés (clignotantes). */
  #drawAlerts() {
    const state = this.session.state;
    const t = state.time.tick;
    const blink = Math.floor(performance.now() / 600) % 2 === 0;
    const items = [];
    for (const b of state.buildings.values()) {
      const def = this.catalog.building(b.defId);
      const settling = (b.constructionUntil > t && !b.upgradeTo) || t - (b.deliveredTick ?? b.builtTick) < 10;
      const needPower = !settling && (b.powerNeed ?? def.networks.power) > 0 && !b.powered;
      const needWater = !settling && (b.waterNeed ?? 0) > 0 && !b.watered;
      const kind = needPower && blink ? 'power' : needWater && blink ? 'water' : b.abandoned ? 'abandoned' : null;
      if (!kind) continue;
      items.push([b, kind]);
      if (items.length >= 600) break;
    }
    const sprites = this.alertSprites;
    const k0 = clamp(0.28 + this.camera.cam.d * 0.012, 0.3, 1.4);
    const byId = new Map(this.world.picks.map((p) => [p.b.id, p]));
    items.forEach(([b, kind], i) => {
      let s = sprites[i];
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.icons[kind], depthTest: false, transparent: true }));
        s.renderOrder = 12;
        sprites.push(s);
        this.alertGroup.add(s);
      }
      if (s.material.map !== this.icons[kind]) {
        s.material.map = this.icons[kind];
        s.material.needsUpdate = true;
      }
      const p = byId.get(b.id);
      const top = p ? p.box.max.y : alt3(state.grid, state.grid.idx(b.x, b.y)) * LEVEL_H + 0.4;
      s.position.set(b.x + b.w / 2, top + 0.3 + k0 * 0.3, b.y + b.h / 2);
      s.scale.set(k0 * (kind === 'abandoned' ? 0.7 : 1), k0 * (kind === 'abandoned' ? 0.7 : 1), 1);
      s.visible = true;
    });
    for (let i = items.length; i < sprites.length; i++) sprites[i].visible = false;
  }

  /* ───────────────────────────── Lumière, nuit et météo ───────────────────────────── */

  #applyLight(state, dt, paused, speedIndex) {
    const tps = SPEEDS[speedIndex ?? 1]?.ticksPerSecond ?? 0.5;
    const target = (state.time.tick % 30) / 30;
    if (!paused) this.phase = (this.phase + dt * (tps / 30)) % 1;
    let err = target + 1 / 60 - this.phase;
    if (err > 0.5) err -= 1;
    if (err < -0.5) err += 1;
    if (Math.abs(err) > 0.08) this.phase = (target + 1) % 1;
    else this.phase = (this.phase + err * 0.04 + 1) % 1;
    const night = this.options.dayNight ? nightOf(this.phase) : 0;
    this.effects.night = night;
    U_NIGHT.value = night;
    const dark = night > 0.5;
    if (dark !== STATE.night) {
      STATE.night = dark;
      LIFE.setNight(dark);
    }
    const w = this.options.weather ? state.weather?.kind ?? 'clear' : 'clear';
    const grey = w === 'storm' ? 0.75 : w === 'rain' ? 0.5 : w === 'fog' ? 0.6 : w === 'cloudy' || w === 'snow' ? 0.3 : 0;
    const dusk = Math.max(0, 1 - Math.abs(night - 0.45) * 2.6) * 0.55;
    const sky = this.scene.background;
    sky.copy(SKY_DAY).lerp(SKY_GREY, grey).lerp(SKY_DUSK, dusk).lerp(SKY_NIGHT, night);
    this.scene.fog.color.copy(sky);
    if (w === 'fog') {
      this.scene.fog.near *= 0.35;
      this.scene.fog.far *= 0.45;
    }
    this.hemi.intensity = lerp(1.35, 0.62, night) * (1 - grey * 0.18);
    this.hemi.color.set('#e6f1ff').lerp(new THREE.Color('#8ea4dc'), night);
    this.hemi.groundColor.set('#8f9580').lerp(new THREE.Color('#2c3240'), night);
    this.sun.intensity = lerp(1.9, 0.55, night) * (1 - grey * 0.55);
    this.sun.color.set('#fff4e2').lerp(new THREE.Color('#ffb070'), dusk).lerp(new THREE.Color('#a3b6ff'), night);
    this.mats.lit.emissiveIntensity = 0.72 * clamp((night - 0.25) / 0.5, 0, 1);
    this.table.material.color.set('#56704a').lerp(new THREE.Color('#1d2a24'), night);
  }

  /* ───────────────────────────── Image ───────────────────────────── */

  render(dtMs, { paused = false, speedIndex = 1 } = {}) {
    if (!this.gl || !this.session || !this.world || this.lost) return;
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, dtMs) / 1000);
    const state = this.session.state;
    this.camera.update(dt);
    // rapprochement avec l'état : vite après un événement, au moins une fois par seconde
    this.syncT += dtMs;
    if ((this.dirty && this.syncT > 100) || this.syncT > 1000) {
      this.syncT = 0;
      this.dirty = false;
      this.#sync();
      if (!this.world) return;
    }
    const cam = this.camera.cam;
    if (this.world.dirtyCount()) {
      this.world.flush(this.firstFlushDone ? 7 : 1e9, cam);
      this.firstFlushDone = true;
      this.sound?.setMap(this.map);
      this.shadowDirty = true;
      this.selDirty = true;
    }
    // réseau routier modifié : la circulation est recomposée une fois les travaux terminés (0,4 s sans changement)
    if (this.trafficDirty && performance.now() - this.trafficDirty > 400) {
      this.trafficDirty = 0;
      TRAFFIC.init(this.map, this.mirror.cat, this.scene);
      FX.initBins();
      this.#flows(state, true);
      this.world.recollect();
      this.binsDirty = false;
    } else if (this.binsDirty) {
      this.binsDirty = false;
      FX.initBins();
    }
    this.flowT += dtMs;
    if (this.flowT > 5000) {
      this.flowT = 0;
      this.#flows(state);
    }
    this.#applyLight(state, dt, paused, speedIndex);
    const adt = paused ? 0 : dt;
    this.animT += adt;
    this.world.update(adt, this.animT, cam);
    for (const m of Object.values(TRAFFIC.meshes ?? {})) m.visible = this.vehiclesOn;
    if (TRAFFIC.beams) TRAFFIC.beams.visible = this.vehiclesOn && STATE.night;
    this.lines.update(state, adt, this.showRoutes || this.overlayId === 'transit', this.routeHighlight);
    this.#updateCamera();
    const month = Math.floor(state.time.tick / 30) % 12;
    this.sound?.update(dt, { weather: state.weather?.kind, paused, season: seasonKey(month) });
    if (this.selDirty) {
      this.selDirty = false;
      this.#drawSelection();
    }
    if (this.overlayDirty) {
      this.overlayDirty = false;
      this.#drawOverlay();
    }
    if (this.gridDirty) {
      this.gridDirty = false;
      this.#drawGrid();
    }
    this.alertT = (this.alertT ?? 0) - dtMs;
    if (this.alertT <= 0) {
      this.alertT = 300;
      this.#drawAlerts();
    }
    // ombres : recalculées quand la vue ou la ville change (cadre de l'ombre centré sur la zone regardée)
    const close = cam.d < 40;
    const ext = close ? Math.max(14, Math.round((cam.d * 1.3) / 4) * 4) : Math.max(66, Math.round(cam.d));
    const cx = Math.round(cam.tx / 3) * 3;
    const cz = Math.round(cam.tz / 3) * 3;
    const sc = this.sun.shadow.camera;
    if (sc.right !== ext || this.sun.target.position.x !== cx || this.sun.target.position.z !== cz) {
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
      sc.updateProjectionMatrix();
      this.sun.target.position.set(cx, 0, cz);
      this.sun.position.set(cx - 40, 70, cz + 28);
      this.shadowDirty = true;
    }
    if (this.shadowDirty && this.gl.shadowMap.enabled) {
      this.gl.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.gl.info.reset();
    this.gl.render(this.scene, this.cam3);
    const frame = performance.now() - t0;
    this.stats.frameMs = this.stats.frameMs * 0.9 + frame * 0.1;
    this.stats.fps = this.stats.fps * 0.9 + (dtMs > 0 ? 1000 / dtMs : 0) * 0.1;
    this.stats.drawCalls = this.gl.info.render.calls;
    this.stats.triangles = this.gl.info.render.triangles;
  }

  /** Diagnostic (tests, panneau de débogage) : contenu de la scène. */
  debugInfo() {
    return {
      buildings: this.map?.buildings.length ?? 0,
      picks: this.world?.picks.length ?? 0,
      chunksDirty: this.world?.dirtyCount() ?? 0,
      vehicles: TRAFFIC.veh?.length ?? 0,
      emergency: (TRAFFIC.veh ?? []).filter((v) => v.emergency || v.type === 'firetruck' || v.type === 'police').map((v) => `${v.type}${v.emergency ? '!' : ''}`),
      anims: Object.fromEntries(Object.entries(LIFE.lists ?? {}).map(([k, v]) => [k, v.length]).filter(([k]) => /fire|jet|truck|police|beacon|wreck|alarm|getaway/i.test(k))),
      pedestrians: TRAFFIC.peds?.length ?? 0,
      target: TRAFFIC.target,
      fx: FX.list.map((e) => e.type),
      flood: FX.flood ? { L: FX.flood.L, cx: FX.flood.cx, cz: FX.flood.cz, mesh: !!FX.floodMesh, y: FX.floodMesh?.position.y, n: FX.floodMesh?.geometry.attributes.position.count } : null,
      rain: FX.rain,
      night: this.effects.night,
      cam: { ...this.camera.cam },
      sound: this.sound ? { ready: this.sound.ready, levels: { ...this.sound.levels } } : null
    };
  }
}
