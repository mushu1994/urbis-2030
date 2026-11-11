/**
 * Scène de l'écran d'accueil (v1.9) : la ville grandit de 2025 à 2045, de la nuit à l'aube, comme une
 * bande-annonce. Chaque chapitre met en scène un aspect du jeu (tracer et zoner, réseaux, budget, transports,
 * crises, élections, IA urbaine) ; l'écran d'accueil affiche le titre du chapitre en cours (voir CHAPTERS).
 * Canvas 2D sans dépendance ni image : tout est dessiné, les immeubles sont pré-rendus une fois par taille d'écran.
 * La scène s'arrête dès que l'écran d'accueil est fermé (aucun coût pendant la partie).
 */
export const YEAR_START = 2025;
export const YEAR_END = 2045;

/** Chapitres de la bande-annonce : chacun commence à `from` et dure jusqu'au suivant. */
export const CHAPTERS = [
  { from: 2025, title: 'Un terrain, une route', text: 'Tout commence par un accès à l\'autoroute et quelques maisons.' },
  { from: 2027, title: 'Tracez, zonez', text: 'Logements, commerces, bureaux, industrie. La ville pousse là où vous l\'avez décidé.' },
  { from: 2030, title: 'Alimentez la ville', text: 'Électricité, eau, déchets. Sans réseaux, personne ne s\'installe.' },
  { from: 2033, title: 'Tenez le budget', text: 'Impôts, emprunts, compte de résultat. Chaque euro se décide à la mairie.' },
  { from: 2036, title: 'Faites circuler', text: 'Bus, tramway, métro, train. Moins de voitures, des trajets plus courts.' },
  { from: 2039, title: 'Affrontez les crises', text: 'Orages, crues, canicules, pannes géantes. Il faut prévenir, puis trancher.' },
  { from: 2041, title: 'Gagnez les élections', text: 'Tous les six ans, les habitants jugent votre mandat.' },
  { from: 2043, title: 'Déployez l\'IA urbaine', text: 'Drones, véhicules autonomes, services pilotés par l\'IA.' },
  { from: 2044.9, title: 'Et la vôtre ?', text: 'Vingt ans, des milliers de décisions. À vous de jouer.' }
];

/** Indice du chapitre en cours pour une année donnée. */
export function chapterAt(year) {
  let i = 0;
  for (let k = 0; k < CHAPTERS.length; k++) if (year >= CHAPTERS[k].from) i = k;
  return i;
}

/** Population affichée pendant la bande-annonce (jalons proches des statuts du jeu, du hameau à la capitale régionale). */
const POPULATION = [[2025, 0], [2025.6, 0], [2027, 320], [2030, 2400], [2033, 9000], [2036, 22000], [2039, 46000], [2042, 82000], [2045, 124000]];
export function populationAt(year) {
  for (let k = 1; k < POPULATION.length; k++) {
    const [y1, p1] = POPULATION[k];
    if (year <= y1) {
      const [y0, p0] = POPULATION[k - 1];
      return Math.round(p0 + (p1 - p0) * ((year - y0) / (y1 - y0)));
    }
  }
  return POPULATION.at(-1)[1];
}

const ZONE_COLORS = ['127,201,107', '79,154,216', '154,127,216', '224,180,60'];

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Couleur interpolée sur trois jalons (nuit, aurore, aube). */
function tone(night, rose, dawn, p) {
  const [a, b, t] = p < 0.55 ? [night, rose, p / 0.55] : [rose, dawn, (p - 0.55) / 0.45];
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const blend = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

const SKY_TOP = [[6, 14, 27], [14, 34, 58], [22, 58, 88]];
const SKY_MID = [[13, 30, 48], [62, 74, 104], [74, 136, 150]];
const SKY_LOW = [[30, 50, 66], [216, 122, 112], [255, 186, 104]];

export class HomeScene {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.year = YEAR_START;
    this.onYear = null;
    this.running = false;
    this.intro = null;
    this.px = 0; // parallaxe lissée (-1 … 1)
    this.pxTarget = 0;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);
    this.onPointer = (e) => {
      if (e.pointerType === 'touch') return;
      this.pxTarget = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    };
    this.onVisibility = () => {
      if (!document.hidden && this.running) this.#schedule();
    };
  }

  /** Démarre l'animation. `intro` : la bande-annonce se joue de 2025 à 2045 ; sinon la ville est déjà en 2045. */
  start({ intro = true } = {}) {
    if (!this.ctx) return;
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', this.onPointer);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.running = true;
    this.t0 = performance.now();
    this.last = this.t0;
    if (intro && !this.reduced) {
      this.#setYear(YEAR_START);
      this.intro = { from: this.t0 + 700, duration: 30000 };
    } else {
      this.intro = null;
      this.#setYear(YEAR_END);
    }
    this.#schedule();
  }

  /** Rejoue la bande-annonce depuis 2025. */
  replay() {
    if (!this.running || this.reduced) return;
    this.#setYear(YEAR_START);
    this.intro = { from: performance.now() + 300, duration: 30000 };
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pointermove', this.onPointer);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Le joueur déplace le curseur des années : l'introduction s'interrompt. */
  scrubTo(year) {
    this.intro = null;
    this.#setYear(year, false);
    if (this.reduced && this.running) this.draw(performance.now());
  }

  #setYear(y, notify = true) {
    this.year = Math.min(YEAR_END, Math.max(YEAR_START, y));
    if (notify) this.onYear?.(this.year);
  }

  #schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  frame(now) {
    if (!this.running) return;
    if (this.intro) {
      const k = clamp01((now - this.intro.from) / this.intro.duration);
      // Rythme presque régulier (chaque chapitre a le temps d'être lu), départ et arrivée adoucis
      this.#setYear(lerp(YEAR_START, YEAR_END, 0.82 * k + 0.18 * easeInOut(k)));
      if (k >= 1) this.intro = null;
    }
    this.px += (this.pxTarget - this.px) * 0.05;
    this.draw(now);
    // Mouvement réduit : une image fixe, redessinée seulement au redimensionnement ou au curseur des années
    if (!this.reduced && !document.hidden) this.raf = requestAnimationFrame(this.frame);
  }

  resize() {
    const c = this.canvas;
    const w = c.clientWidth || window.innerWidth;
    const hgt = c.clientHeight || window.innerHeight;
    if (!w || !hgt) return;
    const dpr = Math.min(window.devicePixelRatio || 1, w < 700 ? 2 : 1.5);
    this.dpr = dpr;
    this.W = w;
    this.H = hgt;
    c.width = Math.round(w * dpr);
    c.height = Math.round(hgt * dpr);
    this.#build();
    if (this.running) this.draw(performance.now());
  }

  // ───────────────────────────── Construction du décor ─────────────────────────────

  #build() {
    const { W, H } = this;
    const r = rng(2045);
    const portrait = H > W * 1.15;
    const s = Math.min(1.35, Math.max(0.62, Math.min(H / 760, W / 900 + 0.25)));
    this.s = s;
    // Portrait (téléphone) : la ville occupe le haut, le menu le bas
    this.hy = Math.round(H * (portrait ? 0.45 : 0.7));
    const hy = this.hy;
    // Téléphone en paysage : le menu est à droite, la ville se regroupe donc à gauche, sous le titre
    const short = !portrait && H < 500;
    const maxH = hy - (portrait ? 128 : short ? 150 : 96);
    // Le sommet de la ligne d'horizon : à droite sur ordinateur (le titre est à gauche), au centre sur téléphone
    const peakX = portrait ? 0.55 : short ? 0.26 : 0.66;
    const floor = portrait ? 0.34 : 0.13;
    const profile = (x) => floor + (1 - floor) * Math.exp(-(((x / W - peakX) / (portrait ? 0.34 : 0.25)) ** 2));
    this.sunX = W * (portrait ? 0.64 : short ? 0.4 : 0.82);
    this.sunRise = maxH * (portrait ? 0.5 : 0.46);

    this.stars = Array.from({ length: Math.round((W * hy) / 9000) }, () => ({ x: r() * W, y: r() * hy * 0.8, a: 0.3 + r() * 0.7, f: 0.5 + r() * 2, p: r() * TAU }));

    // Collines et éoliennes
    const hillSeed = [r() * TAU, r() * TAU, r() * TAU];
    this.hill = (x) => hy - (26 + 20 * Math.sin(x / 210 + hillSeed[0]) + 12 * Math.sin(x / 83 + hillSeed[1]) + 5 * Math.sin(x / 31 + hillSeed[2])) * s;
    const nTurbines = Math.max(3, Math.round(W / 300));
    this.turbines = Array.from({ length: nTurbines }, (_, i) => {
      const x = ((i + 0.3 + r() * 0.5) / nTurbines) * W;
      return { x, h: (34 + r() * 16) * s, born: 2030.2 + r() * 2.6, spin: 0.7 + r() * 0.6, p: r() * TAU };
    });

    const layer = ({ step, wMin, wMax, hMin, hMax, oldTown, bornMin, bornMax, kind }) => {
      const list = [];
      let x = -20 - r() * 30;
      while (x < W + 20) {
        const w = Math.round((wMin + r() * (wMax - wMin)) * s);
        const k = profile(x + w / 2);
        const h = Math.round(Math.min(maxH, (hMin + r() * (hMax - hMin)) * k * s));
        const old = r() < oldTown;
        const b = {
          x: Math.round(x), w, h,
          h0: old ? Math.round(Math.min(h, (14 + r() * 22) * s)) : 0,
          born: bornMin + r() * (bornMax - bornMin) - (k - 0.3) * 1.5,
          rise: 1.6 + r() * 1.8,
          type: kind === 'far' ? 'plain' : pick(r, h > 150 * s ? ['step', 'spire', 'slant', 'garden', 'step', 'garden'] : ['plain', 'garden', 'slant', 'plain']),
          blink: r() < 0.5 ? r() * TAU : null,
          zone: ZONE_COLORS[(r() * ZONE_COLORS.length) | 0],
          coin: r() * 10
        };
        b.sprite = kind === 'far' ? null : this.#sprite(b, r, kind);
        list.push(b);
        x += w + step * s * (0.2 + r() * 1.2);
      }
      return list;
    };
    this.far = layer({ step: 5, wMin: 14, wMax: 34, hMin: 60, hMax: 210, oldTown: 0.3, bornMin: 2028, bornMax: 2041, kind: 'far' });
    this.mid = layer({ step: 9, wMin: 30, wMax: 62, hMin: 120, hMax: 430, oldTown: 0.22, bornMin: 2028.6, bornMax: 2044, kind: 'mid' });
    this.near = layer({ step: 26, wMin: 34, wMax: 70, hMin: 40, hMax: 150, oldTown: 0, bornMin: 2030.5, bornMax: 2044, kind: 'near' });

    // Le hameau des premières années : maisons à toit pentu et arbres le long de la route
    this.houses = [];
    for (let x = 10 + r() * 30; x < W; x += (38 + r() * 70) * s) {
      this.houses.push({ x, w: (20 + r() * 14) * s, h: (11 + r() * 8) * s, lit: r() < 0.6, born: 2025.5 + r() * 2.2, gone: r() < 0.45 ? 2036 + r() * 7 : null });
    }
    this.trees = [];
    for (let x = r() * 20; x < W; x += (9 + r() * 30) * s) this.trees.push({ x, r: (4 + r() * 5) * s, born: r() < 0.6 ? 2024 : 2029 + r() * 14 });

    // Viaduc du train à sustentation magnétique
    this.railY = hy - Math.round(54 * s);

    // Drones et taxis aériens
    this.drones = Array.from({ length: Math.round(W / 70) }, () => ({
      y: hy - (70 + r() * (maxH - 40)), v: (22 + r() * 46) * (r() < 0.5 ? -1 : 1), p: r() * 4000, born: 2039.5 + r() * 5, wob: r() * TAU, red: r() < 0.3
    }));
    this.taxis = Array.from({ length: Math.max(2, Math.round(W / 420)) }, (_, i) => ({
      y: hy - maxH * (0.42 + r() * 0.5), v: (58 + r() * 40) * (i % 2 ? -1 : 1), p: r() * 4000, born: 2043 + r() * 1.6, wob: r() * TAU
    }));
    // IA urbaine : liaisons lumineuses entre les sommets des plus hautes tours
    const tall = this.mid.filter((b) => b.h > maxH * 0.42 && b.x > 0 && b.x + b.w < W).sort((a, b) => a.x - b.x);
    this.links = [];
    for (let i = 0; i + 1 < tall.length; i++) this.links.push({ a: tall[i], b: tall[i + 1], p: r(), born: 2043 + r() * 1.2 });
    // Soir d'élection : feux d'artifice au-dessus du centre
    this.fireworks = Array.from({ length: 11 }, (_, i) => ({
      x: W * (peakX + (r() - 0.5) * (portrait ? 0.8 : 0.44)), y: hy - maxH * (0.7 + r() * 0.4), t: i * 0.27 + r() * 0.2, size: 0.7 + r() * 0.6, hue: ['255,214,110', '126,236,222', '255,140,110'][i % 3], seed: r() * TAU
    }));
    // Orage : nuages et pluie
    this.clouds = Array.from({ length: Math.max(5, Math.round(W / 190)) }, () => ({ x: r() * W, y: hy * (0.04 + r() * 0.3), w: (150 + r() * 190) * s, h: (36 + r() * 30) * s, v: 5 + r() * 9 }));
    this.rain = Array.from({ length: Math.round(W / 9) }, () => ({ x: r() * (W + 120), p: r(), v: 0.9 + r() * 0.6 }));
    this.maxH = maxH;
    this.ripples = Array.from({ length: Math.round(W / 26) }, () => ({ x: r() * W, y: r(), w: 10 + r() * 46, f: 0.4 + r() * 1.3, p: r() * TAU }));
  }

  /** Immeuble pré-rendu à sa hauteur finale (corps, face ombrée, fenêtres, toiture). */
  #sprite(b, r, kind) {
    const dpr = this.dpr;
    const top = b.type === 'spire' ? Math.round(26 * this.s) : b.type === 'garden' ? 6 : 0;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(b.w * dpr));
    cv.height = Math.max(1, Math.round((b.h + top) * dpr));
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const body = kind === 'near' ? '#0b1924' : '#132a3c';
    const face = kind === 'near' ? '#0f2130' : '#1a3549';
    const inset = b.type === 'step' ? Math.round(b.w * 0.2) : 0;
    const crown = b.type === 'step' ? Math.round(b.h * 0.24) : 0;
    g.fillStyle = body;
    if (b.type === 'slant') {
      const cut = Math.min(b.h * 0.2, b.w * 0.7);
      g.beginPath();
      g.moveTo(0, top + cut);
      g.lineTo(b.w, top);
      g.lineTo(b.w, top + b.h);
      g.lineTo(0, top + b.h);
      g.fill();
    } else {
      g.fillRect(inset, top, b.w - inset * 2, crown);
      g.fillRect(0, top + crown, b.w, b.h - crown);
    }
    g.fillStyle = face;
    g.fillRect(inset, top + (b.type === 'slant' ? b.h * 0.2 : 0), Math.max(3, (b.w - inset * 2) * 0.24), b.h);
    // Fenêtres : ambre pour les logements, cyan pour les bureaux pilotés par l'IA
    const cw = 6;
    const ch = 8;
    const cyanTower = r() < 0.35;
    for (let y = top + (b.type === 'slant' ? b.h * 0.2 : 4) + 4; y < top + b.h - 6; y += ch) {
      const ins = y < top + crown ? inset : 0;
      for (let x = ins + 4; x < b.w - ins - 5; x += cw) {
        const lit = r() < (kind === 'near' ? 0.3 : 0.4);
        if (!lit) {
          g.fillStyle = 'rgba(255,255,255,0.035)';
        } else if (cyanTower ? r() < 0.8 : r() < 0.12) {
          g.fillStyle = `rgba(126,236,222,${0.45 + r() * 0.45})`;
        } else {
          g.fillStyle = `rgba(255,${200 + ((r() * 30) | 0)},${118 + ((r() * 40) | 0)},${0.5 + r() * 0.45})`;
        }
        g.fillRect(x, y, 3, 4);
      }
    }
    if (b.type === 'garden') {
      // Toit végétalisé
      g.fillStyle = '#2f7a4e';
      g.fillRect(0, top - 2, b.w, 3);
      for (let x = 3; x < b.w - 2; x += 5 + r() * 6) {
        g.beginPath();
        g.arc(x, top - 2, 2 + r() * 2.2, 0, TAU);
        g.fill();
      }
      // Jardin vertical
      g.fillStyle = 'rgba(64,150,96,0.55)';
      const gx = Math.round(b.w * (0.5 + r() * 0.3));
      g.fillRect(gx, top + 8, 3, b.h * (0.4 + r() * 0.4));
    }
    if (b.type === 'spire') {
      g.fillStyle = body;
      g.fillRect(b.w / 2 - 1, 0, 2, top);
      g.fillRect(b.w / 2 - 4, top - 6, 8, 6);
    }
    return { cv, top };
  }

  // ───────────────────────────── Dessin ─────────────────────────────

  draw(now) {
    const { ctx, W, H, hy, s } = this;
    if (!W) return;
    const t = (now - this.t0) / 1000;
    const year = this.year;
    const p = clamp01((year - YEAR_START) / (YEAR_END - YEAR_START));
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Chapitre « crises » : un orage traverse la ville en 2039-2041
    const storm = smooth(2039, 2039.6, year) * (1 - smooth(2040.5, 2041, year));
    const dusk = [16, 24, 36];
    const top = blend(tone(...SKY_TOP, p), dusk, storm * 0.75);
    const mid = blend(tone(...SKY_MID, p), dusk, storm * 0.7);
    const low = blend(tone(...SKY_LOW, p), [58, 66, 80], storm * 0.8);

    // Ciel
    const sky = ctx.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, css(top));
    sky.addColorStop(0.58, css(mid));
    sky.addColorStop(1, css(low));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, hy + 1);

    // Étoiles (s'effacent à l'aube)
    const starA = clamp01(1 - p * 1.5);
    if (starA > 0.01) {
      ctx.fillStyle = '#dcebff';
      for (const st of this.stars) {
        ctx.globalAlpha = starA * st.a * (0.6 + 0.4 * Math.sin(t * st.f + st.p));
        ctx.fillRect(st.x, st.y, 1.4, 1.4);
      }
      ctx.globalAlpha = 1;
    }

    // Soleil levant
    const sunX = this.sunX + this.px * -6;
    const sunY = hy + 50 * s - p * (50 * s + this.sunRise);
    const glowR = (180 + 460 * p) * s;
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, glowR);
    const clear = 1 - storm * 0.85;
    glow.addColorStop(0, `rgba(255,220,160,${(0.2 + 0.6 * p) * clear})`);
    glow.addColorStop(0.3, `rgba(255,160,110,${0.34 * p * clear})`);
    glow.addColorStop(1, 'rgba(255,150,104,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, hy + 1);
    if (p > 0.3) {
      ctx.fillStyle = `rgba(255,238,206,${clamp01((p - 0.3) * 2) * clear})`;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 42 * s, 0, TAU);
      ctx.fill();
    }

    // Collines et éoliennes
    const hillC = blend(mid, [12, 26, 38], 0.62);
    ctx.fillStyle = css(hillC);
    ctx.beginPath();
    ctx.moveTo(0, hy);
    const ox0 = this.px * -3;
    for (let x = 0; x <= W + 12; x += 12) ctx.lineTo(x, this.hill(x - ox0));
    ctx.lineTo(W, hy);
    ctx.fill();
    ctx.strokeStyle = css(blend(hillC, [230, 240, 245], 0.45));
    ctx.lineWidth = 1.2 * s;
    for (const tb of this.turbines) {
      const g = easeOut(clamp01((year - tb.born) / 1.4));
      if (g <= 0) continue;
      const bx = tb.x + ox0;
      const by = this.hill(tb.x);
      const ty = by - tb.h * g;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, ty);
      if (g >= 1) {
        const a0 = t * tb.spin + tb.p;
        for (let k = 0; k < 3; k++) {
          const a = a0 + (k * TAU) / 3;
          ctx.moveTo(bx, ty);
          ctx.lineTo(bx + Math.cos(a) * tb.h * 0.42, ty + Math.sin(a) * tb.h * 0.42);
        }
      }
      ctx.stroke();
    }

    // Lointain : silhouettes dans la brume
    const farC = blend(mid, [14, 30, 44], 0.5);
    ctx.fillStyle = css(farC);
    const oxFar = this.px * -5;
    for (const b of this.far) {
      const hNow = this.#height(b, year);
      if (hNow > 0) ctx.fillRect(b.x + oxFar, hy - hNow, b.w, hNow + 1);
    }

    // Plan médian : les tours
    this.#drawLayer(this.mid, year, p, t, this.px * -11);

    // Viaduc et train
    this.#drawRail(year, p, t);

    // Premier plan
    this.#drawLayer(this.near, year, p, t, this.px * -18);
    this.#drawQuay(year, p, t);

    // Budget : les recettes montent des immeubles
    this.#drawCoins(year, t);

    // Circulation aérienne et réseau de l'IA urbaine
    this.#drawLinks(year, t);
    this.#drawAir(year, t);

    // Soir d'élection, puis orage
    this.#drawFireworks(year, t);
    if (storm > 0.01) this.#drawStorm(storm, t);

    // Eau : reflet de tout ce qui précède, puis teinte et clapotis
    const wh = H - hy;
    const rh = Math.min(wh, hy);
    ctx.save();
    ctx.translate(0, hy * 2);
    ctx.scale(1, -1);
    ctx.drawImage(this.canvas, 0, (hy - rh) * dpr, W * dpr, rh * dpr, 0, hy - rh, W, rh);
    ctx.restore();
    const water = ctx.createLinearGradient(0, hy, 0, H);
    water.addColorStop(0, css(blend(low, [10, 26, 40], 0.5), 0.5));
    water.addColorStop(0.3, css(blend(mid, [8, 22, 34], 0.72), 0.82));
    water.addColorStop(1, 'rgba(6,16,26,0.97)');
    ctx.fillStyle = water;
    ctx.fillRect(0, hy, W, wh);
    ctx.fillStyle = css(blend(low, [255, 255, 255], 0.25), 0.5);
    ctx.fillRect(0, hy, W, 1);
    for (const rp of this.ripples) {
      const y = hy + 3 + rp.y * rp.y * wh;
      const near = Math.exp(-(((rp.x - sunX) / (70 * s + (y - hy) * 0.6)) ** 2));
      const a = (0.05 + 0.5 * near * p) * (0.5 + 0.5 * Math.sin(t * rp.f + rp.p));
      if (a < 0.02) continue;
      ctx.fillStyle = near > 0.2 ? `rgba(255,206,150,${a})` : `rgba(190,220,235,${a})`;
      const drift = ((rp.x + t * 6 * rp.f) % (W + 60)) - 30;
      ctx.fillRect(drift, y, rp.w * (0.5 + rp.y), 1.2);
    }
  }

  #height(b, year) {
    // Les premiers immeubles bas (h0) arrivent avec le zonage, vers 2027-2028
    const h0 = b.h0 * easeOut(clamp01((year - 2026.8) / 1.6));
    return h0 + (b.h - h0) * easeOut(clamp01((year - b.born) / b.rise));
  }

  #drawLayer(list, year, p, t, ox) {
    const { ctx, hy, dpr } = this;
    for (const b of list) {
      const g = clamp01((year - b.born) / b.rise);
      const hNow = Math.round(this.#height(b, year));
      const x = b.x + ox;
      // Zonage : la parcelle est tracée (couleur de sa zone) avant que l'immeuble ne monte
      if (b.born < 2034.5 && g < 1) {
        const z = smooth(b.born - 2.4, b.born - 1.5, year) * (1 - g);
        if (z > 0.02) {
          const zh = Math.min(b.h, 64 * this.s);
          ctx.fillStyle = `rgba(${b.zone},${0.16 * z})`;
          ctx.fillRect(x, hy - zh, b.w, zh);
          ctx.strokeStyle = `rgba(${b.zone},${0.95 * z})`;
          ctx.lineWidth = 1.4;
          ctx.setLineDash([5, 4]);
          ctx.lineDashOffset = -t * 14;
          ctx.strokeRect(x + 0.5, hy - zh + 0.5, b.w - 1, zh);
          ctx.setLineDash([]);
        }
      }
      if (hNow <= 0) continue;
      const sp = b.sprite;
      const full = hNow + (g >= 1 ? sp.top : 0);
      const skip = g >= 1 ? 0 : sp.top;
      ctx.drawImage(sp.cv, 0, skip * dpr, sp.cv.width, full * dpr, x, hy - full, b.w, full);
      // L'aube accroche le flanc des tours
      if (p > 0.05) {
        ctx.fillStyle = `rgba(255,186,120,${0.55 * p})`;
        ctx.fillRect(x + b.w - 1.5, hy - hNow, 1.5, hNow);
      }
      if (g > 0 && g < 1) this.#crane(x + b.w * 0.5, hy - hNow, b.w);
      else if (g >= 1 && b.blink !== null && b.h > 120 * this.s && Math.sin(t * 2.2 + b.blink) > 0.6) {
        ctx.fillStyle = 'rgba(255,90,80,0.95)';
        ctx.fillRect(x + b.w / 2 - 1, hy - full - 2, 2.2, 2.2);
      }
    }
  }

  /** Grue de chantier au sommet d'un immeuble en construction. */
  #crane(x, y, w) {
    const { ctx, s } = this;
    const mast = 16 * s;
    const jib = Math.min(26 * s, w * 0.8);
    ctx.strokeStyle = 'rgba(242,194,48,0.9)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - mast);
    ctx.moveTo(x - jib * 0.35, y - mast);
    ctx.lineTo(x + jib, y - mast);
    ctx.moveTo(x + jib * 0.7, y - mast);
    ctx.lineTo(x + jib * 0.7, y - mast * 0.45);
    ctx.stroke();
  }

  #drawRail(year, p, t) {
    const { ctx, W, hy, s } = this;
    const built = clamp01((year - 2036) / 2.2);
    if (built <= 0) return;
    const y = this.railY;
    const end = W * built;
    ctx.fillStyle = '#0e1f2c';
    for (let x = 30; x < end; x += 74 * s) ctx.fillRect(x, y, 3 * s, hy - y);
    ctx.fillRect(0, y - 1, end, 4 * s);
    ctx.fillStyle = `rgba(126,236,222,${0.35 + 0.25 * p})`;
    ctx.fillRect(0, y - 1, end, 1);
    if (year < 2038.2) return;
    // Rame : une traversée toutes les neuf secondes
    const len = 150 * s;
    const cycle = 9;
    const k = (t % cycle) / cycle;
    const x = -len + k * (W + len) * 1.25;
    if (x > W) return;
    const h = 7 * s;
    ctx.fillStyle = '#e8f3f6';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y - h - 1, len, h, [h * 0.5, h, 2, 2]);
    else ctx.rect(x, y - h - 1, len, h);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,50,70,0.85)';
    ctx.fillRect(x + 8, y - h + 1, len - 22, h * 0.36);
    ctx.fillStyle = 'rgba(255,214,130,0.95)';
    for (let wx = x + 12; wx < x + len - 20; wx += 9 * s) ctx.fillRect(wx, y - h + 1.5, 4 * s, h * 0.26);
    const head = ctx.createLinearGradient(x + len, 0, x + len + 60 * s, 0);
    head.addColorStop(0, 'rgba(180,240,255,0.5)');
    head.addColorStop(1, 'rgba(180,240,255,0)');
    ctx.fillStyle = head;
    ctx.fillRect(x + len, y - h, 60 * s, h * 0.8);
  }

  #drawQuay(year, p, t) {
    const { ctx, W, hy, s } = this;
    const ox = this.px * -22;
    // Maisons du hameau (certaines laissent la place aux tours)
    for (const m of this.houses) {
      const a = m.gone === null ? 1 : clamp01(m.gone - year);
      // La maison « se pose » : elle sort du sol en dépassant un peu sa taille, puis se stabilise
      const k = clamp01((year - m.born) / 0.5);
      if (a <= 0 || k <= 0) continue;
      const pop = k < 1 ? 1 + 0.25 * Math.sin(k * Math.PI) : 1;
      ctx.globalAlpha = a;
      const x = m.x + ox;
      const mh = m.h * easeOut(k) * pop;
      ctx.fillStyle = '#0a1620';
      ctx.fillRect(x, hy - mh, m.w, mh);
      ctx.beginPath();
      ctx.moveTo(x - 2, hy - mh);
      ctx.lineTo(x + m.w / 2, hy - mh - m.w * 0.36 * easeOut(k));
      ctx.lineTo(x + m.w + 2, hy - mh);
      ctx.fill();
      if (m.lit && k >= 1 && year > 2030.4) {
        ctx.fillStyle = 'rgba(255,208,128,0.9)';
        ctx.fillRect(x + m.w * 0.22, hy - m.h * 0.66, 3 * s, 3.4 * s);
        ctx.fillRect(x + m.w * 0.62, hy - m.h * 0.66, 3 * s, 3.4 * s);
      }
    }
    ctx.globalAlpha = 1;
    // Arbres du quai
    for (const tr of this.trees) {
      const g = easeOut(clamp01((year - tr.born) / 1.2));
      if (g <= 0) continue;
      ctx.fillStyle = blendCss([10, 34, 26], [34, 92, 60], p * 0.8);
      ctx.beginPath();
      ctx.arc(tr.x + ox, hy - tr.r * g * 0.9, tr.r * g, 0, TAU);
      ctx.fill();
    }
    // La première route : elle se trace depuis l'accès autoroutier (bord gauche), marquage jaune en tête
    const road = easeInOut(clamp01((year - 2025.1) / 1.3));
    ctx.fillStyle = '#081119';
    ctx.fillRect(0, hy - 2.5 * s, W * road, 2.5 * s + 1);
    if (road > 0 && road < 1) {
      ctx.fillStyle = 'rgba(242,194,48,0.95)';
      ctx.fillRect(W * road - 26 * s, hy - 4 * s, 26 * s, 3 * s);
    }
    // Réseaux : le courant parcourt la rue quand les centrales arrivent
    const power = smooth(2030, 2030.6, year) * (1 - smooth(2033.2, 2034, year));
    if (power > 0.02) {
      for (let i = 0; i < 9; i++) {
        const x = ((i / 9 + t * 0.07) % 1) * (W + 80) - 40;
        const g = ctx.createLinearGradient(x - 46 * s, 0, x, 0);
        g.addColorStop(0, 'rgba(126,236,222,0)');
        g.addColorStop(1, `rgba(170,246,236,${0.95 * power})`);
        ctx.fillStyle = g;
        ctx.fillRect(x - 46 * s, hy - 4.5 * s, 46 * s, 2 * s);
      }
    }
    const lamps = clamp01((year - 2030.3) / 2.5);
    if (lamps > 0) {
      const flick = 0.75 + 0.25 * Math.sin(t * 1.3);
      for (let x = (ox % (58 * s)) + 20; x < W * lamps; x += 58 * s) {
        ctx.fillStyle = `rgba(255,222,150,${0.85 * flick})`;
        ctx.fillRect(x, hy - 7 * s, 2, 2);
      }
    }
  }

  /** Recettes : des « € » montent des immeubles pendant le chapitre du budget. */
  #drawCoins(year, t) {
    const { ctx, hy, s } = this;
    const k = smooth(2033, 2033.5, year) * (1 - smooth(2035.6, 2036.2, year));
    if (k < 0.02) return;
    ctx.font = `700 ${Math.round(13 * s)}px "Barlow Semi Condensed", Barlow, sans-serif`;
    ctx.textAlign = 'center';
    for (const b of this.mid) {
      const hNow = this.#height(b, year);
      if (hNow < 24 * s) continue;
      const ph = (t * 0.42 + b.coin) % 1;
      ctx.fillStyle = `rgba(255,214,110,${k * Math.sin(ph * Math.PI) * 0.95})`;
      ctx.fillText('+€', b.x + b.w / 2, hy - hNow - 6 * s - ph * 30 * s);
    }
    ctx.textAlign = 'start';
  }

  /** IA urbaine : arcs lumineux entre les tours, parcourus par une impulsion. */
  #drawLinks(year, t) {
    const { ctx, hy } = this;
    for (const l of this.links) {
      const k = clamp01((year - l.born) / 0.8);
      if (k <= 0) continue;
      const x1 = l.a.x + l.a.w / 2;
      const y1 = hy - l.a.h;
      const x2 = l.b.x + l.b.w / 2;
      const y2 = hy - l.b.h;
      const cx = (x1 + x2) / 2;
      const cy = Math.min(y1, y2) - 26 * this.s;
      ctx.strokeStyle = `rgba(126,236,222,${0.32 * k})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.stroke();
      const u = (t * 0.35 + l.p) % 1;
      const px = (1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * cx + u * u * x2;
      const py = (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * cy + u * u * y2;
      ctx.fillStyle = `rgba(200,255,248,${k})`;
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, TAU);
      ctx.fill();
    }
  }

  /** Soir d'élection : feux d'artifice au-dessus du centre-ville. */
  #drawFireworks(year, t) {
    const { ctx, s } = this;
    const k = smooth(2041.3, 2041.7, year) * (1 - smooth(2042.6, 2043, year));
    if (k < 0.02) return;
    const cycle = 3;
    for (const f of this.fireworks) {
      const u = (((t - f.t) % cycle) + cycle) % cycle / 1.7;
      if (u > 1) continue;
      const rad = easeOut(u) * 96 * s * f.size;
      const a = k * (1 - u) ** 1.3;
      // Halo de l'explosion, puis gerbe en deux couronnes avec traînées
      const halo = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad * 1.1);
      halo.addColorStop(0, `rgba(${f.hue},${0.28 * a})`);
      halo.addColorStop(1, `rgba(${f.hue},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(f.x - rad * 1.1, f.y - rad * 1.1, rad * 2.2, rad * 2.2);
      ctx.strokeStyle = `rgba(${f.hue},${a})`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 22; i++) {
        const ang = f.seed + (i * TAU) / 22;
        const rr = rad * (i % 2 ? 1 : 0.6);
        const fall = u * u * 22 * s;
        ctx.moveTo(f.x + Math.cos(ang) * rr * 0.82, f.y + Math.sin(ang) * rr * 0.82 + fall);
        ctx.lineTo(f.x + Math.cos(ang) * rr, f.y + Math.sin(ang) * rr + fall);
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  /** Orage : nuages, pluie, éclairs. */
  #drawStorm(k, t) {
    const { ctx, W, hy, s } = this;
    ctx.fillStyle = `rgba(22,30,42,${0.8 * k})`;
    for (const c of this.clouds) {
      const x = ((c.x + t * c.v) % (W + c.w * 2)) - c.w;
      ctx.beginPath();
      ctx.ellipse(x, c.y, c.w * 0.5, c.h * 0.5, 0, 0, TAU);
      ctx.ellipse(x + c.w * 0.32, c.y + c.h * 0.16, c.w * 0.36, c.h * 0.42, 0, 0, TAU);
      ctx.ellipse(x - c.w * 0.3, c.y + c.h * 0.2, c.w * 0.32, c.h * 0.36, 0, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = `rgba(190,214,232,${0.34 * k})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of this.rain) {
      const y = ((d.p + t * d.v) % 1) * hy;
      const x = d.x - (y / hy) * 70 * s;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5 * s, y + 15 * s);
    }
    ctx.stroke();
    // Un éclair toutes les 2,3 secondes : bref flash blanc et trait brisé
    const u = (t % 2.3) / 2.3;
    if (u < 0.09) {
      const a = k * (1 - u / 0.09);
      ctx.fillStyle = `rgba(214,230,255,${0.22 * a})`;
      ctx.fillRect(0, 0, W, hy);
      const n = Math.floor(t / 2.3);
      let x = W * (0.3 + ((n * 0.37) % 0.6));
      let y = hy * 0.12;
      ctx.strokeStyle = `rgba(240,246,255,${a})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = 0; i < 6; i++) {
        x += (((n * 7 + i * 13) % 9) - 4) * 6 * s;
        y += (hy * 0.62 - hy * 0.12) / 6;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  #drawAir(year, t) {
    const { ctx, W, s } = this;
    for (const d of this.drones) {
      if (year < d.born) continue;
      const span = W + 80;
      const x = (((d.p + t * d.v) % span) + span) % span - 40;
      const y = d.y + Math.sin(t * 0.7 + d.wob) * 5;
      const on = Math.sin(t * 5 + d.wob) > -0.2;
      ctx.fillStyle = d.red ? `rgba(255,120,104,${on ? 0.95 : 0.25})` : `rgba(150,244,232,${on ? 0.95 : 0.3})`;
      ctx.fillRect(x, y, 2, 2);
    }
    for (const tx of this.taxis) {
      if (year < tx.born) continue;
      const span = W + 240;
      const x = (((tx.p + t * tx.v) % span) + span) % span - 120;
      const y = tx.y + Math.sin(t * 0.45 + tx.wob) * 9 * s;
      const dir = Math.sign(tx.v);
      const trail = ctx.createLinearGradient(x, 0, x - dir * 70 * s, 0);
      trail.addColorStop(0, 'rgba(255,214,140,0.7)');
      trail.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = trail;
      ctx.fillRect(Math.min(x, x - dir * 70 * s), y + 1, 70 * s, 1.4);
      ctx.fillStyle = '#eaf4f7';
      ctx.beginPath();
      ctx.ellipse(x, y + 1.5, 6 * s, 2.3 * s, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(126,236,222,0.95)';
      ctx.fillRect(x + dir * 5 * s, y + 0.8, 2, 1.6);
    }
  }
}

function pick(r, list) {
  return list[(r() * list.length) | 0];
}

function blendCss(a, b, t) {
  return css(blend(a, b, t));
}
