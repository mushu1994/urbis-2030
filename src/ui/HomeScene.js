/**
 * Scène de l'écran d'accueil (v1.9) : la ville grandit de 2030 à 2045, de la nuit à l'aube.
 * Canvas 2D sans dépendance ni image : tout est dessiné, les immeubles sont pré-rendus une fois par taille d'écran.
 * La scène s'arrête dès que l'écran d'accueil est fermé (aucun coût pendant la partie).
 */
export const YEAR_START = 2030;
export const YEAR_END = 2045;

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

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

  /** Démarre l'animation. `intro` : la ville se construit de 2030 à 2045 ; sinon elle est déjà en 2045. */
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
      this.intro = { from: this.t0 + 900, duration: 7000 };
    } else {
      this.intro = null;
      this.#setYear(YEAR_END);
    }
    this.#schedule();
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
      this.#setYear(lerp(YEAR_START, YEAR_END, easeInOut(k)));
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
    this.hy = Math.round(H * (portrait ? 0.5 : 0.7));
    const hy = this.hy;
    // Téléphone en paysage : le menu est à droite, la ville se regroupe donc à gauche, sous le titre
    const short = !portrait && H < 500;
    const maxH = hy - (portrait ? 150 : short ? 150 : 96);
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
      return { x, h: (34 + r() * 16) * s, born: 2031.5 + r() * 5, spin: 0.7 + r() * 0.6, p: r() * TAU };
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
          blink: r() < 0.5 ? r() * TAU : null
        };
        b.sprite = kind === 'far' ? null : this.#sprite(b, r, kind);
        list.push(b);
        x += w + step * s * (0.2 + r() * 1.2);
      }
      return list;
    };
    this.far = layer({ step: 5, wMin: 14, wMax: 34, hMin: 60, hMax: 210, oldTown: 0.3, bornMin: 2030.4, bornMax: 2041, kind: 'far' });
    this.mid = layer({ step: 9, wMin: 30, wMax: 62, hMin: 120, hMax: 430, oldTown: 0.22, bornMin: 2031.5, bornMax: 2044, kind: 'mid' });
    this.near = layer({ step: 26, wMin: 34, wMax: 70, hMin: 40, hMax: 150, oldTown: 0, bornMin: 2033, bornMax: 2044, kind: 'near' });

    // Le hameau de 2030 : maisons à toit pentu et arbres le long du quai
    this.houses = [];
    for (let x = 10 + r() * 30; x < W; x += (38 + r() * 70) * s) {
      this.houses.push({ x, w: (20 + r() * 14) * s, h: (11 + r() * 8) * s, lit: r() < 0.6, gone: r() < 0.45 ? 2036 + r() * 7 : null });
    }
    this.trees = [];
    for (let x = r() * 20; x < W; x += (9 + r() * 30) * s) this.trees.push({ x, r: (4 + r() * 5) * s, born: r() < 0.5 ? 2030 : 2031 + r() * 12 });

    // Viaduc du train à sustentation magnétique
    this.railY = hy - Math.round(54 * s);

    // Drones et taxis aériens
    this.drones = Array.from({ length: Math.round(W / 70) }, () => ({
      y: hy - (70 + r() * (maxH - 40)), v: (22 + r() * 46) * (r() < 0.5 ? -1 : 1), p: r() * 4000, born: 2033.5 + r() * 9, wob: r() * TAU, red: r() < 0.3
    }));
    this.taxis = Array.from({ length: Math.max(2, Math.round(W / 420)) }, (_, i) => ({
      y: hy - maxH * (0.42 + r() * 0.5), v: (58 + r() * 40) * (i % 2 ? -1 : 1), p: r() * 4000, born: 2039.5 + r() * 4, wob: r() * TAU
    }));
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

    const top = tone(...SKY_TOP, p);
    const mid = tone(...SKY_MID, p);
    const low = tone(...SKY_LOW, p);

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
    glow.addColorStop(0, `rgba(255,220,160,${0.2 + 0.6 * p})`);
    glow.addColorStop(0.3, `rgba(255,160,110,${0.34 * p})`);
    glow.addColorStop(1, 'rgba(255,150,104,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, hy + 1);
    if (p > 0.3) {
      ctx.fillStyle = `rgba(255,238,206,${clamp01((p - 0.3) * 2)})`;
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

    // Circulation aérienne
    this.#drawAir(year, t);

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
    return b.h0 + (b.h - b.h0) * easeOut(clamp01((year - b.born) / b.rise));
  }

  #drawLayer(list, year, p, t, ox) {
    const { ctx, hy, dpr } = this;
    for (const b of list) {
      const g = clamp01((year - b.born) / b.rise);
      const hNow = Math.round(this.#height(b, year));
      if (hNow <= 0) continue;
      const x = b.x + ox;
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
    if (year < 2038.4) return;
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
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      const x = m.x + ox;
      ctx.fillStyle = '#0a1620';
      ctx.fillRect(x, hy - m.h, m.w, m.h);
      ctx.beginPath();
      ctx.moveTo(x - 2, hy - m.h);
      ctx.lineTo(x + m.w / 2, hy - m.h - m.w * 0.36);
      ctx.lineTo(x + m.w + 2, hy - m.h);
      ctx.fill();
      if (m.lit) {
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
    // Quai et lampadaires
    ctx.fillStyle = '#081119';
    ctx.fillRect(0, hy - 2 * s, W, 2 * s + 1);
    const lamps = clamp01((year - 2031) / 3);
    if (lamps > 0) {
      const flick = 0.75 + 0.25 * Math.sin(t * 1.3);
      for (let x = (ox % (58 * s)) + 20; x < W * lamps; x += 58 * s) {
        ctx.fillStyle = `rgba(255,222,150,${0.85 * flick})`;
        ctx.fillRect(x, hy - 7 * s, 2, 2);
      }
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
