/**
 * Son spatial de la vue 3D (v1.5) : ambiances et événements synthétisés à la volée (Web Audio, aucun fichier), placés
 * autour de la caméra et mixés selon le zoom — de près, le quartier (oiseaux, moteurs, usines, sirènes, alarmes) ;
 * de loin, la rumeur de la ville et le vent. Il se branche sur le moteur audio du jeu (mêmes réglages de volume).
 *
 * Il ne lit que la scène 3D (circulation, effets des crises) et le miroir de la carte : aucune règle n'est décidée ici.
 */
import { STATE, TRAFFIC, FX } from './Engine3D.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SR_A = 22050;
const SYN = (() => {
  const TAU = Math.PI * 2, SR = SR_A;
  const N = (s) => Math.max(1, Math.round(s * SR));
  const buf = (s) => new Float32Array(N(s));
  /* filtres biquad (RBJ), coefficients modifiables */
  function BQ(type, f, Q = 0.707) {
    let B0, B1, B2, A1, A2, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const set = (ff, qq = Q) => {
      const w = TAU * Math.min(ff, SR * 0.45) / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * qq);
      let b0, b1, b2; const a0 = 1 + al;
      if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
      else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
      else { b0 = al; b1 = 0; b2 = -al; }
      B0 = b0 / a0; B1 = b1 / a0; B2 = b2 / a0; A1 = -2 * cs / a0; A2 = (1 - al) / a0;
    };
    set(f, Q);
    const p = (x) => { const y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
    p.set = set;
    return p;
  }
  const white = (r) => () => r() * 2 - 1;
  function pink(r) { let b0 = 0, b1 = 0, b2 = 0; return () => { const w = r() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; return (b0 + b1 + b2 + w * 0.1848) * 0.2; }; }
  function brown(r) { let b = 0; return () => { b = (b + 0.02 * (r() * 2 - 1)) / 1.02; return b * 3.5; }; }
  const fill = (n, fn) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = fn(i, i / SR); return a; };
  const rms = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length) || 1e-9; };
  /* mélange de pistes à un niveau efficace donné */
  function mix(n, parts) {
    const out = new Float32Array(n);
    for (const [a, level, peak] of parts) {
      let k = level / rms(a);
      if (peak) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); k = level / (m || 1); }
      for (let i = 0; i < n && i < a.length; i++) out[i] += a[i] * k;
    }
    return out;
  }
  function normalize(a, peak = 0.9) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); if (m > peak) for (let i = 0; i < a.length; i++) a[i] *= peak / m; return a; }
  /* boucle sans couture : la fin est fondue dans le début */
  function loopify(a, xf) {
    const X = N(xf), n = a.length - X, out = a.slice(0, n);
    for (let i = 0; i < X; i++) { const w = i / X; out[i] = a[i] * Math.sqrt(w) + a[n + i] * Math.sqrt(1 - w); }
    return out;
  }
  const filt = (a, f) => { for (let i = 0; i < a.length; i++) a[i] = f(a[i]); return a; };
  function burst(a, t0, amp, tau, r) { const i0 = N(t0), n = Math.min(a.length - i0, N(tau * 7)), k = 1 / (tau * SR); for (let i = 0; i < n; i++) a[i0 + i] += amp * (r() * 2 - 1) * Math.exp(-i * k); }
  function partial(a, t0, f, amp, tau, att = 0.002) {
    const i0 = N(t0), n = Math.min(a.length - i0, N(tau * 7)), k = 1 / (tau * SR), at = N(att);
    for (let i = 0; i < n; i++) a[i0 + i] += amp * Math.sin(TAU * f * i / SR) * Math.exp(-i * k) * Math.min(1, i / at);
  }
  /* note glissée (oiseaux, sirènes) : fréquence f0 → f1, vibrato, enveloppe douce */
  function glide(a, t0, dur, f0, f1, amp, o = {}) {
    const i0 = N(t0), n = Math.min(a.length - i0, N(dur)), at = N(o.att ?? 0.006), rl = N(o.rel ?? 0.012), h2 = o.h2 ?? 0.15;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n, f = (o.exp ? f0 * Math.pow(f1 / f0, u) : f0 + (f1 - f0) * u) * (1 + (o.vib || 0) * Math.sin(TAU * (o.vr || 20) * i / SR));
      ph += f / SR;
      const e = Math.min(1, i / at, (n - i) / rl);
      a[i0 + i] += amp * e * (Math.sin(TAU * ph) + h2 * Math.sin(TAU * 2 * ph));
    }
  }
  /* crépitements : impulsions de Poisson */
  function crackles(n, rate, r, tau0, tau1, pow = 3) {
    const a = new Float32Array(n);
    let t = 0;
    for (;;) { t += -Math.log(1 - r()) / rate; if (t * SR >= n) break; burst(a, t, 0.1 + 0.9 * Math.pow(r(), pow), tau0 + (tau1 - tau0) * r(), r); }
    return a;
  }

  /* ---------- boucles d'ambiance ---------- */
  const S = {};
  S.fire = () => {
    const r = mulberry32(11), L = 6.5, n = N(L), br = brown(r), lp = BQ('lp', 380), wn = white(r), hs = BQ('bp', 3200, 0.6);
    const roar = fill(n, (i, t) => lp(br()) * (0.7 + 0.2 * Math.sin(TAU * 0.37 * t) + 0.12 * Math.sin(TAU * 1.13 * t + 1)));
    const cr = filt(filt(crackles(n, 34, r, 0.0006, 0.003), BQ('hp', 800)), BQ('bp', 2600, 0.8));
    const pops = filt(crackles(n, 4, r, 0.004, 0.012, 2), BQ('lp', 1100));
    const hiss = fill(n, () => hs(wn()));
    return normalize(loopify(mix(n, [[roar, 0.14], [cr, 0.08], [pops, 0.05], [hiss, 0.012]]), 0.5));
  };
  S.rain = () => {
    const r = mulberry32(12), n = N(6.5), pk = pink(r), hp = BQ('hp', 500), lp = BQ('lp', 6500), br = brown(r), lr = BQ('lp', 260);
    const hiss = fill(n, () => lp(hp(pk())));
    const pat = filt(crackles(n, 240, r, 0.0003, 0.0011, 2), BQ('bp', 3600, 0.7));
    const drips = new Float32Array(n); for (let t = 0.05; t < 6.4; t += 0.08 + r() * 0.4) partial(drips, t, 1400 + r() * 1700, 0.3 + r() * 0.7, 0.012 + r() * 0.02, 0.001);
    const low = fill(n, () => lr(br()));
    return normalize(loopify(mix(n, [[hiss, 0.1], [pat, 0.05], [drips, 0.02], [low, 0.04]]), 0.5));
  };
  S.water = () => { // crue : eau qui se rue, remous, gargouillis
    const r = mulberry32(13), n = N(6.5), br = brown(r), pk = pink(r), b1 = BQ('bp', 330, 0.6), b2 = BQ('bp', 1500, 0.7);
    const surge = (t) => 0.62 + 0.25 * Math.sin(TAU * 0.23 * t) + 0.13 * Math.sin(TAU * 0.71 * t + 2);
    const body = fill(n, (i, t) => b1(br()) * surge(t)), foam = fill(n, (i, t) => b2(pk()) * surge(t + 0.4));
    const gur = new Float32Array(n); for (let t = 0.02; t < 6.4; t += 0.05 + r() * 0.22) { const f = 220 + r() * 260; glide(gur, t, 0.025 + r() * 0.03, f, f * 1.8, 0.3 + r() * 0.7, { exp: true, att: 0.004, rel: 0.01, h2: 0 }); }
    return normalize(loopify(mix(n, [[body, 0.12], [foam, 0.07], [gur, 0.035]]), 0.5));
  };
  S.river = () => { // clapotis du fleuve
    const r = mulberry32(14), n = N(8.5), br = brown(r), pk = pink(r), lp = BQ('lp', 520), bp = BQ('bp', 900, 0.5);
    const lap = (t) => 0.35 + 0.65 * Math.pow(Math.sin(Math.PI * (t * 0.42 + 0.25 * Math.sin(t * 0.9))), 2);
    const a = fill(n, (i, t) => lp(br()) * lap(t)), h = fill(n, (i, t) => bp(pk()) * lap(t + 0.3));
    const bub = new Float32Array(n); for (let t = 0.1; t < 8.3; t += 0.3 + r() * 0.9) { const f = 380 + r() * 380; glide(bub, t, 0.03, f, f * 1.6, 0.5, { exp: true, h2: 0 }); }
    return normalize(loopify(mix(n, [[a, 0.08], [h, 0.018], [bub, 0.018]]), 0.5));
  };
  S.crowd = () => { // manifestation : brouhaha, slogans scandés, sifflets, grosse caisse
    const r = mulberry32(15), L = 8.5, n = N(L), VOW = [[730, 1090], [530, 1840], [290, 2250], [570, 840], [320, 870], [420, 2000], [640, 1190]];
    const voice = (out, f0, amp, sched) => {
      const F1 = BQ('bp', 600, 5), F2 = BQ('bp', 1200, 8), wn = white(r);
      let ph = 0, env = 0, k = 0, tgt = 0, seg = sched[0];
      for (let i = 0; i < n; i++) {
        while (seg && i >= seg.e) seg = sched[++k];
        if (seg && i >= seg.s) { if (seg.set !== true) { F1.set(seg.v[0], 5); F2.set(seg.v[1], 8); seg.set = true; } tgt = seg.a * (seg.e - i < N(0.03) ? 0.15 : 1); } else tgt = 0;
        env += (tgt - env) * 0.004;
        if (env < 1e-4 && tgt === 0) continue;
        const t = i / SR, f = f0 * (1 + 0.1 * Math.sin(TAU * 0.6 * t + f0) + 0.05 * Math.sin(TAU * 2.1 * t + amp * 9) + (seg ? seg.bend * (i - seg.s) / SR : 0));
        ph += f / SR; ph -= Math.floor(ph);
        const src = 2 * ph - 1 + 0.12 * wn();
        out[i] += env * (F1(src) + 0.6 * F2(src));
      }
    };
    // brouhaha : syllabes au hasard, pauses
    const bab = new Float32Array(n);
    for (let v = 0; v < 11; v++) {
      const sched = []; let t = r() * 0.5;
      while (t < L) { if (r() < 0.18) t += 0.25 + r() * 0.8; const d = 0.09 + r() * 0.16; sched.push({ s: N(t), e: N(t + d), v: VOW[(r() * VOW.length) | 0].map((x) => x * (0.9 + 0.2 * r())), a: 0.6 + 0.4 * r(), bend: 0 }); t += d; }
      voice(bab, 105 + r() * 140, 0.4 + 0.6 * r(), sched);
    }
    // slogans : même rythme pour tout le cortège, avec un léger décalage entre manifestants
    const chant = new Float32Array(n), pat = [[0, 0.2, 3], [0.3, 0.32, 3], [0.9, 0.17, 0], [1.13, 0.17, 0], [1.38, 0.42, 5]];
    for (let v = 0; v < 10; v++) {
      const sched = [], j = (r() - 0.5) * 0.06;
      for (let bar = 0; bar < 3; bar++) for (const [o, d, vw] of pat) { const t = 0.4 + bar * 2 + o + j; sched.push({ s: N(t), e: N(t + d), v: VOW[vw].map((x) => x * (1.05 + 0.15 * r())), a: 0.8 + 0.2 * r(), bend: -0.25 }); }
      voice(chant, 150 + r() * 120, 1, sched);
    }
    const drum = new Float32Array(n);
    for (let t = 0.4; t < 6.3; t += 0.5) { glide(drum, t, 0.22, 95, 55, 1, { att: 0.002, rel: 0.18, h2: 0 }); burst(drum, t, 0.25, 0.004, r); }
    const wh = new Float32Array(n);
    for (const t0 of [6.6, 7.1, 7.7]) glide(wh, t0, 0.32, 2950, 2900, 0.8, { vib: 0.05, vr: 28, att: 0.01, rel: 0.03, h2: 0.05 });
    const pk = pink(r), bp = BQ('bp', 600, 0.5), mur = fill(n, () => bp(pk()));
    return normalize(loopify(mix(n, [[bab, 0.1], [chant, 0.085], [drum, 0.035], [wh, 0.22, true], [mur, 0.03]]), 0.5));
  };
  S.birds = () => { // moineaux, merles, mésanges, tourterelles
    const r = mulberry32(16), L = 10.5, n = N(L), a = new Float32Array(n);
    let t = 0.1;
    while (t < L - 1) {
      const sp = r(), g = 0.25 + 0.75 * r();
      if (sp < 0.33) { // moineau : pépiements descendants
        const k = 3 + ((r() * 4) | 0);
        for (let i = 0; i < k; i++) { const d = 0.05 + r() * 0.03; glide(a, t, d, 4200 + r() * 1000, 3000 + r() * 600, g, { exp: true }); t += d + 0.06 + r() * 0.05; }
      } else if (sp < 0.62) { // merle : phrase mélodieuse
        const k = 5 + ((r() * 4) | 0); let f = 1800 + r() * 1300;
        for (let i = 0; i < k; i++) {
          if (r() < 0.15) { for (let j = 0; j < 5; j++) { glide(a, t, 0.032, 4200 + (j % 2) * 600, 4000 + (j % 2) * 600, g * 0.6); t += 0.042; } continue; }
          const d = 0.08 + r() * 0.17, f2 = f * (0.85 + r() * 0.35);
          glide(a, t, d, f, f2, g * (0.6 + 0.4 * r()), { vib: 0.02 + r() * 0.02, vr: 18 + r() * 12, att: 0.012, rel: 0.03 });
          f = Math.max(1600, Math.min(3400, f2 * (0.9 + r() * 0.25))); t += d + 0.02 + r() * 0.05;
        }
      } else if (sp < 0.88) { // mésange : « ti-tu » répété
        const k = 3 + ((r() * 2) | 0);
        for (let i = 0; i < k; i++) { glide(a, t, 0.09, 4300, 4250, g * 0.7); glide(a, t + 0.13, 0.11, 3000, 2950, g * 0.6); t += 0.34; }
      } else { // tourterelle : roucoulement grave
        for (const [d, k] of [[0.25, 0.7], [0.45, 1], [0.25, 0.7], [0.3, 0.6], [0.3, 0.6]]) { glide(a, t, d, 520, 480, g * k * 0.6, { att: 0.06, rel: 0.08, h2: 0.25 }); t += d + 0.08; }
      }
      t += 0.15 + r() * 1.1;
    }
    const pk = pink(r), lp = BQ('lp', 1200), leaves = fill(n, (i, tt) => lp(pk()) * (0.6 + 0.4 * Math.sin(tt * 0.7)));
    return normalize(loopify(mix(n, [[a, 0.09], [leaves, 0.006]]), 0.5), 0.85);
  };
  S.crickets = () => { // grillons et chouette
    const r = mulberry32(17), L = 8.5, n = N(L), a = new Float32Array(n);
    for (const [fc, per, amp] of [[4300, 0.48, 0.6], [4750, 0.61, 0.42], [5200, 0.73, 0.3]]) {
      for (let t = r() * per; t < L; t += per * (0.95 + 0.1 * r())) for (let p = 0; p < 3 + (r() < 0.5); p++) glide(a, t + p * 0.022, 0.016, fc, fc, amp, { att: 0.003, rel: 0.006, h2: 0.05 });
    }
    glide(a, 4.2, 0.48, 415, 385, 0.32, { att: 0.07, rel: 0.2, h2: 0.08 });
    glide(a, 5.0, 0.2, 410, 395, 0.25, { att: 0.05, rel: 0.1, h2: 0.08 });
    glide(a, 5.3, 0.36, 410, 380, 0.28, { att: 0.05, rel: 0.18, h2: 0.08 });
    const pk = pink(r), lp = BQ('lp', 300), bed = fill(n, () => lp(pk()));
    return normalize(loopify(mix(n, [[a, 0.07], [bed, 0.008]]), 0.5), 0.85);
  };
  S.traffic = () => { // circulation fluide : passages de voitures
    const r = mulberry32(18), L = 10.5, n = N(L), br = brown(r), lb = BQ('lp', 140), pk = pink(r), bt = BQ('bp', 1000, 0.6);
    const env = new Float32Array(n), eng = new Float32Array(n);
    for (let c = 0; c < 18; c++) {
      const tc = r() * L, sg = 0.5 + r() * 0.8, f0 = 45 + r() * 50, amp = 0.5 + 0.5 * r(), i0 = Math.max(0, N(tc - 3 * sg)), i1 = Math.min(n, N(tc + 3 * sg));
      let ph = 0; const lp = BQ('lp', 650);
      for (let i = i0; i < i1; i++) {
        const t = i / SR, e = amp * Math.exp(-Math.pow((t - tc) / sg, 2)), f = f0 * (1 + 0.035 * Math.tanh((tc - t) / (sg * 0.5)));
        ph += f / SR; ph -= Math.floor(ph);
        eng[i] += lp(2 * ph - 1 + (ph < 0.25 ? 0.6 : 0)) * e; env[i] += e;
      }
    }
    const bed = fill(n, () => lb(br())), tires = fill(n, (i) => bt(pk()) * env[i]);
    return normalize(loopify(mix(n, [[bed, 0.05], [eng, 0.05], [tires, 0.075]]), 0.5));
  };
  S.idle = () => { // embouteillage : moteurs au ralenti, coups d'accélérateur
    const r = mulberry32(19), L = 8.5, n = N(L), a = new Float32Array(n), br = brown(r), lb = BQ('lp', 110);
    for (let c = 0; c < 7; c++) {
      const f0 = 24 + r() * 12, amp = 0.4 + 0.6 * r(), lp = BQ('lp', 700), lp2 = BQ('lp', 900), rev = c < 2 ? 1 + r() * 6 : -1;
      let ph = 0, jit = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR; jit += (r() - 0.5) * 0.002; jit *= 0.999;
        const u = rev > 0 ? t - rev : -1, rv = u > 0 && u < 1.2 ? (u < 0.4 ? u / 0.4 : 1 - (u - 0.4) / 0.8) : 0;
        ph += f0 * (1 + jit + 0.8 * rv) / SR; ph -= Math.floor(ph);
        const s = 2 * ph - 1 + (ph < 0.18 ? 0.9 : 0); // impulsions d'échappement
        a[i] += lp2(lp(s)) * amp * (1 + 0.6 * rv) * (1 + 0.08 * Math.sin(TAU * 0.3 * t + c));
      }
    }
    const bed = fill(n, () => lb(br())), pk = pink(r), bx = BQ('bp', 450, 0.7), exh = fill(n, (i, t) => bx(pk()) * (0.8 + 0.2 * Math.sin(TAU * 0.4 * t)));
    return normalize(loopify(mix(n, [[a, 0.1], [bed, 0.04], [exh, 0.03]]), 0.5));
  };
  S.industry = () => { // usines : ronflement, presse, vapeur, convoyeur, bip de recul
    const r = mulberry32(20), L = 8.5, n = N(L), wn = white(r);
    const hum = fill(n, (i, t) => (Math.sin(TAU * 50 * t) + 0.6 * Math.sin(TAU * 100 * t) + 0.35 * Math.sin(TAU * 150 * t) + 0.2 * Math.sin(TAU * 200 * t)) * (1 + 0.1 * Math.sin(TAU * 0.5 * t)));
    const lm = BQ('lp', 320); let ph = 0; const motor = fill(n, () => { ph += 37 / SR; ph -= Math.floor(ph); return lm(2 * ph - 1); });
    const press = new Float32Array(n);
    for (let t = 0.3; t < L - 0.6; t += 1.6) {
      partial(press, t, 85, 1, 0.09, 0.001);
      [[523, 0.5, 0.5], [1187, 0.4, 0.35], [1853, 0.3, 0.22], [2741, 0.2, 0.14], [3600, 0.12, 0.08]].forEach(([f, a, tau]) => partial(press, t, f, a, tau, 0.0005));
      burst(press, t, 0.8, 0.003, r);
    }
    const steam = new Float32Array(n), hs = BQ('hp', 2500);
    for (const t0 of [2.6, 7.0]) for (let i = N(t0); i < Math.min(n, N(t0 + 0.8)); i++) { const u = i / SR - t0; steam[i] += hs(wn()) * Math.min(1, u / 0.04, (0.8 - u) / 0.35); }
    const bc = BQ('bp', 2800, 1.5), rat = fill(n, (i, t) => bc(wn()) * (Math.sin(TAU * 13 * t) > 0 ? 1 : 0.3));
    const beep = fill(n, (i, t) => (t > 4 && t < 5.5 && (t * 2) % 1 < 0.5 ? Math.sin(TAU * 1000 * t) : 0));
    const whine = fill(n, (i, t) => Math.sin(TAU * 1380 * t));
    return normalize(loopify(mix(n, [[hum, 0.045], [motor, 0.035], [press, 0.06], [steam, 0.02], [rat, 0.012], [beep, 0.012], [whine, 0.006]]), 0.5));
  };
  S.city = () => { // rumeur lointaine de la ville
    const r = mulberry32(21), n = N(10.5), br = brown(r), pk = pink(r), l1 = BQ('lp', 180), l2 = BQ('lp', 1100);
    const a = fill(n, () => l1(br())), b = fill(n, (i, t) => l2(pk()) * (0.7 + 0.3 * Math.sin(TAU * 0.13 * t)));
    const hn = new Float32Array(n); for (const t0 of [2.3, 6.8]) { glide(hn, t0, 0.4, 410, 410, 0.5, { h2: 0.4 }); glide(hn, t0, 0.4, 515, 515, 0.4, { h2: 0.4 }); }
    filt(hn, BQ('lp', 900));
    return normalize(loopify(mix(n, [[a, 0.07], [b, 0.045], [hn, 0.04, true]]), 0.5));
  };
  S.wind = () => {
    const r = mulberry32(22), n = N(8.5), pk = pink(r), b1 = BQ('bp', 380, 1), b2 = BQ('bp', 900, 1.2);
    return normalize(loopify(fill(n, (i, t) => { const x = pk(), g1 = 0.5 + 0.5 * Math.sin(TAU * 0.11 * t), g2 = 0.5 + 0.5 * Math.sin(TAU * 0.17 * t + 2); return (b1(x) * g1 + b2(x) * g2 * 0.6) * 2.4; }), 0.6));
  };
  S.club = () => { // boîte de nuit entendue de la rue : basses étouffées, 124 bpm
    const r = mulberry32(23), beat = 60 / 124, L = beat * 8, n2 = N(L * 2), a = new Float32Array(n2), hat = new Float32Array(n2);
    for (let b = 0; b < 16; b++) {
      const t = b * beat;
      glide(a, t, 0.26, 120, 48, 1, { exp: true, att: 0.001, rel: 0.2, h2: 0 });
      const f = (b % 8) < 4 ? 55 : 65.4; let ph = 0; const i0 = N(t + beat / 2), lp = BQ('lp', 240);
      for (let i = 0; i < N(0.2) && i0 + i < n2; i++) { ph += f / SR; ph -= Math.floor(ph); a[i0 + i] += lp(2 * ph - 1) * 0.7 * Math.exp(-i / N(0.09)); }
      burst(hat, t + beat / 2, 0.5, 0.02, r);
      if (b % 2) burst(a, t, 0.25, 0.02, r);
    }
    const m1 = BQ('lp', 700), m2 = BQ('lp', 700), hh = BQ('hp', 6000);
    for (let i = 0; i < n2; i++) a[i] = m2(m1(a[i])) + hh(hat[i]) * 0.12;
    return normalize(a.slice(N(L)));
  };
  /* sirènes « deux-tons » (pompiers : la-si, police : la-ré) et alarmes */
  const twoTone = (fA, fB, half) => {
    const P = half * 2, n2 = N(P * 4), a = new Float32Array(n2), bp = BQ('bp', 1100, 0.7), lp = BQ('lp', 3500);
    let ph = 0, f = fA;
    for (let i = 0; i < n2; i++) {
      const t = i / SR, tgt = (t % P) < half ? fA : fB; f += (tgt - f) * 0.004;
      ph += f / SR; ph -= Math.floor(ph);
      let s = 0; for (let k = 1; k <= 9; k += 2) s += Math.sin(TAU * k * ph) / k;
      a[i] = lp(0.6 * s + bp(s));
    }
    return normalize(a.slice(N(P * 2)), 0.7);
  };
  S.sirenFire = () => twoTone(435, 488, 0.6);
  S.sirenPolice = () => twoTone(435, 580, 0.5);
  S.alarm = () => { // alarme de maison : « ouin-ouin » rapide
    const n2 = N(4), a = new Float32Array(n2), lp = BQ('lp', 4000); let ph = 0;
    for (let i = 0; i < n2; i++) { const u = ((i / SR) % 0.25) / 0.25, f = 850 + 700 * Math.pow(u, 0.7); ph += f / SR; ph -= Math.floor(ph); a[i] = lp((ph < 0.5 ? 1 : -1) * 0.5 + Math.sin(TAU * ph) * 0.5); }
    return normalize(a.slice(N(2)), 0.6);
  };
  S.bell = () => { // sonnerie d'alarme d'un commerce
    const r = mulberry32(24), n2 = N(4), a = new Float32Array(n2);
    for (let t = 0; t < 4; t += 1 / 17) { [[1180, 1, 0.35], [2810, 0.5, 0.18], [4460, 0.3, 0.1], [6100, 0.15, 0.06]].forEach(([f, am, tau]) => partial(a, t, f, am * 0.4, tau, 0.0005)); burst(a, t, 0.2, 0.002, r); }
    return normalize(a.slice(N(2)), 0.6);
  };

  /* ---------- sons ponctuels ---------- */
  const shards = (a, r, k, t0, spread, amp) => { for (let i = 0; i < k; i++) { const t = t0 + Math.min(1.2, -Math.log(1 - r()) * spread); partial(a, t, 2800 + r() * 5800, amp * (0.2 + 0.8 * r()) * Math.exp(-(t - t0) / 0.5), 0.01 + r() * 0.06, 0.0005); } };
  S.glass = () => {
    const r = mulberry32(31), n = N(1.6), a = new Float32Array(n), c = new Float32Array(n);
    burst(c, 0.01, 1, 0.004, r); filt(c, BQ('hp', 1800));
    partial(a, 0.01, 140, 0.4, 0.04);
    shards(a, r, 70, 0.012, 0.18, 0.6);
    for (let i = 0; i < 8; i++) burst(a, 0.4 + r() * 0.7, 0.15, 0.002, r);
    for (let i = 0; i < n; i++) a[i] += c[i];
    return normalize(a, 0.95);
  };
  S.crash = () => {
    const r = mulberry32(32), n = N(1.5), a = new Float32Array(n), nz = new Float32Array(n);
    partial(a, 0.005, 70, 1, 0.18, 0.001);
    burst(nz, 0.005, 0.8, 0.05, r); filt(nz, BQ('lp', 2500));
    [[310, 0.5, 0.6], [777, 0.4, 0.4], [1290, 0.3, 0.25], [2110, 0.2, 0.15], [2900, 0.1, 0.1]].forEach(([f, am, tau]) => partial(a, 0.006, f, am, tau, 0.0005));
    shards(a, r, 20, 0.02, 0.15, 0.3);
    for (let i = 0; i < n; i++) a[i] += nz[i];
    return normalize(a, 0.95);
  };
  S.bang = () => { // pétard
    const r = mulberry32(33), n = N(1), a = new Float32Array(n), b = new Float32Array(n), c = new Float32Array(n);
    burst(a, 0.002, 1, 0.006, r); burst(b, 0.002, 0.8, 0.09, r); filt(b, BQ('lp', 300)); burst(c, 0.02, 0.15, 0.25, r); filt(c, BQ('lp', 1200));
    for (let i = 0; i < n; i++) a[i] += b[i] * 3 + c[i];
    return normalize(a, 0.95);
  };
  S.collapse = () => { // démolition : charges, effondrement, gravats
    const r = mulberry32(34), n = N(5.5), br = brown(r), lr = BQ('lp', 110), lc = BQ('lp', 1800);
    const env = (t) => (t < 1.3 ? Math.pow(t / 1.3, 1.5) : Math.exp(-(t - 1.3) / 1.4));
    const rum = fill(n, (i, t) => lr(br()) * env(t));
    const cr = crackles(n, 110, r, 0.001, 0.006, 2); for (let i = 0; i < n; i++) cr[i] = lc(cr[i]) * env(i / SR);
    const hits = new Float32Array(n);
    for (const t0 of [0, 0.15, 0.32]) { burst(hits, t0, 1, 0.008, r); partial(hits, t0, 60, 0.8, 0.12); }
    for (let i = 0; i < 14; i++) partial(hits, 0.8 + r() * 2.4, 50 + r() * 40, 0.5 + 0.5 * r(), 0.12, 0.003);
    return normalize(mix(n, [[rum, 0.18], [cr, 0.07], [hits, 0.9, true]]), 0.95);
  };
  S.thunder = () => {
    const r = mulberry32(35), n = N(6), br = brown(r), pk = pink(r), l1 = BQ('lp', 85), l2 = BQ('lp', 300), c = new Float32Array(n);
    burst(c, 0.05, 1, 0.02, r); filt(c, BQ('hp', 1200));
    const lumps = Array.from({ length: 5 }, () => [0.1 + r() * 2.7, 0.25 + r() * 0.65, 0.4 + 0.6 * r()]);
    const env = (t) => lumps.reduce((s, [m, w, a]) => s + a * Math.exp(-Math.pow((t - m) / w, 2)), 0) * Math.exp(-t / 2.2);
    const roll = fill(n, (i, t) => (l1(br()) + 0.3 * l2(pk())) * env(t));
    return normalize(mix(n, [[roll, 0.2], [c, 0.6, true]]), 0.95);
  };
  S.screech = () => { // démarrage en trombe : crissement de pneus, moteur poussé
    const r = mulberry32(36), n = N(1.4), a = new Float32Array(n), wn = white(r), bp = BQ('bp', 2300, 1.2), lp = BQ('lp', 700), jl = BQ('lp', 30);
    let p1 = 0, p2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, e = Math.min(1, t / 0.03, Math.max(0, (1.15 - t) / 0.4)), f = 1850 + 900 * jl(wn());
      p1 += f / SR; const fe = 75 * Math.pow(190 / 75, Math.min(1, t / 1.2)); p2 += fe / SR; p2 -= Math.floor(p2);
      a[i] = e * (0.5 * Math.sin(TAU * p1) + 0.12 * Math.sin(TAU * 2 * p1) + 0.45 * bp(wn())) + 0.5 * lp(2 * p2 - 1) * Math.min(1, t / 0.05);
    }
    return normalize(a, 0.9);
  };
  S.bins = () => { // benne à ordures : vérin, bacs, déchets qui tombent
    const r = mulberry32(37), n = N(1.8), a = new Float32Array(n), lp = BQ('lp', 600), lc = BQ('lp', 2500);
    let ph = 0;
    for (let i = 0; i < N(1.5); i++) { const t = i / SR, f = 150 + 80 * Math.min(1, t / 1.3); ph += f / SR; ph -= Math.floor(ph); a[i] += lp(2 * ph - 1) * 0.25 * Math.min(1, t / 0.1, (1.5 - t) / 0.3) + 0.05 * Math.sin(TAU * 2 * f * t); }
    for (const t0 of [0.25, 1.35]) { [[180, 1, 0.07], [410, 0.5, 0.06], [760, 0.3, 0.05]].forEach(([f, am, tau]) => partial(a, t0, f, am * 0.6, tau, 0.001)); burst(a, t0, 0.4, 0.02, r); }
    const tb = crackles(n, 60, r, 0.002, 0.01, 2); for (let i = 0; i < n; i++) { const t = i / SR; a[i] += lc(tb[i]) * (t > 0.5 && t < 1.2 ? 0.35 : 0); }
    shards(a, r, 6, 0.6, 0.25, 0.15);
    return normalize(a, 0.9);
  };
  S.whoosh = () => { // embrasement
    const r = mulberry32(38), n = N(1.4), a = new Float32Array(n), wn = white(r), br = brown(r), lr = BQ('lp', 250);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, fc = t < 0.5 ? 200 + 3300 * t / 0.5 : 3500 - 2900 * Math.min(1, (t - 0.5) / 0.9), k = 1 - Math.exp(-TAU * fc / SR);
      y += (wn() - y) * k; const e = Math.min(1, t / 0.4) * Math.exp(-Math.max(0, t - 0.4) / 0.5);
      a[i] = y * e + lr(br()) * e * 0.8;
    }
    return normalize(a, 0.85);
  };
  const horn = (fs, segs) => {
    const n = N(segs[segs.length - 1][1] + 0.05), a = new Float32Array(n), bp = BQ('bp', 1100, 0.8), lp = BQ('lp', 3000);
    const ph = fs.map(() => 0);
    for (let i = 0; i < n; i++) {
      const t = i / SR, on = segs.find(([s, e]) => t >= s && t < e);
      const e = on ? Math.min(1, (t - on[0]) / 0.008, (on[1] - t) / 0.03) : 0;
      let s = 0; fs.forEach((f, j) => { ph[j] += f / SR; for (let k = 1; k <= 7; k += 2) s += Math.sin(TAU * k * ph[j]) / k; });
      a[i] = lp(bp(s) * 1.2 + s * 0.3) * e;
    }
    return normalize(a, 0.8);
  };
  S.horn1 = () => horn([410, 510], [[0, 0.14], [0.24, 0.5]]);
  S.horn2 = () => horn([400, 500], [[0, 0.65]]);
  S.horn3 = () => horn([520, 655], [[0, 0.09], [0.15, 0.24], [0.3, 0.39]]);
  return S;
})();

const LOOPS = ['birds', 'traffic', 'city', 'fire', 'sirenFire', 'sirenPolice', 'crowd', 'rain', 'water', 'industry', 'idle', 'crickets', 'river', 'wind', 'club', 'alarm', 'bell'];
const SHOTS = ['glass', 'whoosh', 'horn1', 'horn2', 'horn3', 'bins', 'crash', 'bang', 'collapse', 'thunder', 'screech'];
const BASE = { birds: 0.8, crickets: 0.6, traffic: 0.5, idle: 0.55, industry: 0.6, river: 0.38, city: 0.45, wind: 0.32, club: 0.25, fire: 0.9, crowd: 0.7, rain: 0.55, water: 0.6, sirenFire: 0.3, sirenPolice: 0.3, alarm: 0.22, bell: 0.5 };
const SHOT_VOL = { glass: 0.9, whoosh: 0.6, horn1: 0.35, horn2: 0.35, horn3: 0.35, bins: 0.55, crash: 0.8, bang: 0.7, collapse: 1, thunder: 0.8, screech: 0.6 };
const IND = { industry: 1, energy: 0.9, waste: 1, logistics: 0.45 };
const QUIET_IND = new Set(['power_line', 'power_solar', 'power_wind', 'power_battery']);
const T_FOREST = 2;
const T_WATER = 4;

/** Mixeur spatial : une voix par ambiance (gain et panoramique suivis en douceur), des sons ponctuels positionnés. */
export class Sound3D {
  /** @param {import('../audio/AudioEngine.js').AudioEngine} audio moteur audio du jeu (contexte, bus, réglages) */
  constructor(audio) {
    this.audio = audio;
    this.ctx = null;
    this.bufs = {};
    this.voices = {};
    this.levels = {};
    this.shotsN = 0;
    this.tick = 0;
    this.ready = false;
    this.active = false;
    this.cells = null;
  }

  /** Sources fixes par cellules de 4 × 4 cases : verdure, industrie, eau ; boîtes de nuit. */
  setMap(map) {
    this.map = map;
    const C4 = 4;
    const nx = Math.ceil(map.W / C4);
    const nz = Math.ceil(map.H / C4);
    const cells = Array.from({ length: nx * nz }, (_, i) => ({ x: (i % nx) * C4 + 2, z: ((i / nx) | 0) * C4 + 2, green: 0, ind: 0, water: 0, mv: 0, st: 0 }));
    const cell = (x, z) => cells[Math.min(nz - 1, (z / C4) | 0) * nx + Math.min(nx - 1, (x / C4) | 0)];
    for (let z = 0; z < map.H; z++) {
      for (let x = 0; x < map.W; x++) {
        const t = map.terr[map.idx(x, z)];
        if (t === T_FOREST) cell(x, z).green += 1 / 16;
        else if (t === T_WATER) cell(x, z).water += 1 / 16;
      }
    }
    this.clubs = [];
    for (const b of map.buildings) {
      if (b.state === 'rubble' || b.state === 'burnt') continue;
      const a = (b.w * b.h) / 16;
      const c = cell(b.x + b.w / 2, b.z + b.h / 2);
      const cat = b.def.cat;
      if (cat === 'parks') c.green += a * 1.4;
      else if (cat === 'residential_low') c.green += a * 0.35;
      if (/^agri/.test(b.def.id)) c.green += a * 0.3;
      else if (IND[cat] && !QUIET_IND.has(b.def.id) && b.state !== 'abandoned') c.ind += a * IND[cat] * 1.6;
      if (b.def.id === 'com_3_club' && !b.state) this.clubs.push({ x: b.x + b.w / 2, z: b.z + b.h / 2 });
    }
    Object.assign(this, { cells, nx, nz, C4 });
  }

  setCamera(camera, cam) {
    this.camera = camera;
    this.cam = cam;
  }

  /** Branche le mixeur sur le contexte du jeu dès qu'il existe (premier geste de l'utilisateur). */
  #ensure() {
    const A = this.audio;
    if (this.ctx || !A?.ready || !A.ctx) return;
    const ctx = (this.ctx = A.ctx);
    this.loopBus = ctx.createGain();
    this.shotBus = ctx.createGain();
    this.loopBus.gain.value = 0;
    this.shotBus.gain.value = 0;
    this.loopBus.connect(A.busAmb);
    this.shotBus.connect(A.busSfx);
    this.#generate();
  }

  /** Synthèse étalée sur plusieurs images pour ne pas figer l'affichage. */
  #generate() {
    const todo = [...LOOPS, ...SHOTS];
    const step = () => {
      if (!this.ctx) return;
      const name = todo.shift();
      if (!name) {
        this.ready = true;
        return;
      }
      try {
        const data = SYN[name]();
        const b = this.ctx.createBuffer(1, data.length, SR_A);
        b.getChannelData(0).set(data);
        this.bufs[name] = b;
        if (LOOPS.includes(name)) this.#startVoice(name);
      } catch (e) {
        console.warn('son', name, e);
      }
      setTimeout(step, 12);
    };
    setTimeout(step, 30);
  }

  #startVoice(name) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.buffer = this.bufs[name];
    src.loop = true;
    g.gain.value = 0;
    src.connect(g);
    if (p) {
      g.connect(p);
      p.connect(this.loopBus);
    } else g.connect(this.loopBus);
    src.start(0, Math.random() * src.buffer.duration);
    this.voices[name] = { src, g, p };
  }

  /** Vue 3D active ou non (en 2D, le mixeur se tait). */
  setActive(on) {
    this.active = !!on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.loopBus.gain.setTargetAtTime(on ? 1 : 0, t, 0.25);
    this.shotBus.gain.setTargetAtTime(on ? 1 : 0, t, 0.1);
  }

  /** Atténuation avec la distance à la caméra et panoramique gauche/droite. */
  geo(x, z, ref) {
    const c = this.camera.position;
    const dx = x - c.x;
    const dz = z - c.z;
    const d = Math.sqrt(dx * dx + dz * dz + c.y * c.y);
    const e = this.camera.matrixWorld.elements;
    const rx = e[0];
    const rz = e[2];
    const rl = Math.hypot(rx, rz) || 1;
    return { g: 1 / (1 + Math.pow(d / ref, 2)), pan: Math.max(-1, Math.min(1, (dx * rx + dz * rz) / rl / (Math.hypot(dx, dz) + 1.5))) * 0.85 };
  }

  /** Son ponctuel, placé dans la scène (ou non positionné si x est nul). */
  shot(name, x, z, vol = 1, ref = 10) {
    if (!this.active || !this.ctx || !this.bufs[name] || this.ctx.state !== 'running' || this.shotsN > 10 || !this.camera) return;
    let g = vol * (SHOT_VOL[name] || 0.7);
    let pan = 0;
    if (x != null) {
      const G = this.geo(x, z, ref);
      g *= G.g;
      pan = G.pan;
    }
    if (g < 0.015) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const gn = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.buffer = this.bufs[name];
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    gn.gain.value = g;
    src.connect(gn);
    if (p) {
      p.pan.value = pan;
      gn.connect(p);
      p.connect(this.shotBus);
    } else gn.connect(this.shotBus);
    this.shotsN++;
    src.onended = () => {
      this.shotsN--;
    };
    src.start();
  }

  /**
   * Mixage (appelé à chaque image ; calculs complets cinq fois par seconde).
   * @param {number} dt secondes
   * @param {{weather?:string, paused?:boolean, season?:string}} env
   */
  update(dt, env = {}) {
    this.#ensure();
    if (!this.ctx || !this.active || !this.cells || !this.camera || this.ctx.state !== 'running') return;
    this.tick += dt;
    if (this.tick < 0.2) return;
    const step = this.tick;
    this.tick = 0;
    const cam = this.cam;
    const night = STATE.night;
    const zf = Math.max(0, Math.min(1, (cam.d - 6) / 50));
    const L = {};
    const P = {};
    const set = (k, g, pan = 0) => {
      L[k] = Math.max(0, Math.min(1, g));
      P[k] = pan;
    };
    // circulation par cellule
    for (const c of this.cells) c.mv = c.st = 0;
    for (const v of TRAFFIC.veh ?? []) {
      if (v.emergency || v.rx == null) continue;
      const c = this.cells[Math.min(this.nz - 1, (v.rz / this.C4) | 0) * this.nx + Math.min(this.nx - 1, (v.rx / this.C4) | 0)];
      if (!c) continue;
      if (v.spd < 0.08) c.st += 1 / 10;
      else c.mv += 1 / 10;
    }
    // ce qu'on entend = moyenne des sources dans la zone regardée, zone qui s'élargit quand on dézoome
    const Rl = 2.2 + cam.d * 0.38;
    const acc = { green: [0, 0], ind: [0, 0], mv: [0, 0], st: [0, 0], water: [0, 0] };
    let wsum = 0;
    const e = this.camera.matrixWorld.elements;
    const rx = e[0];
    const rz = e[2];
    const rlen = Math.hypot(rx, rz) || 1;
    for (const c of this.cells) {
      const dx = c.x - cam.tx;
      const dz = c.z - cam.tz;
      const G = Math.exp(-(dx * dx + dz * dz) / (Rl * Rl));
      if (G < 0.01) continue;
      wsum += G;
      const pn = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / rlen / (Math.hypot(dx, dz) + Rl * 0.5))) * 0.8;
      for (const k of ['green', 'ind', 'mv', 'st', 'water']) {
        const w = c[k] * G;
        if (w) {
          acc[k][0] += w;
          acc[k][1] += w * pn;
        }
      }
    }
    const dens = (k) => acc[k][0] / (wsum || 1);
    const sat = (x) => 1 - Math.exp(-x);
    const pan = (k) => (acc[k][0] > 1e-6 ? acc[k][1] / acc[k][0] : 0);
    const near = 1 / (1 + Math.pow(Math.max(0, cam.d - 5) / 22, 2)); // détails audibles de près seulement
    const aG = sat(dens('green') * 2.2);
    const aI = sat(dens('ind') * 2.5);
    const aM = sat(dens('mv') * 2);
    const aS = sat(dens('st') * 2.2);
    const aW = sat(dens('water') * 2.5);
    const calm = Math.max(0.12, Math.min(1, 1 - 0.8 * Math.max(aM, aS) - 0.9 * aI));
    const winter = env.season === 'winter';
    const wet = FX.rain > 0.2 || FX.snow > 0.2;
    this.dbg = { aG, aI, aM, aS, aW, calm, near };
    set('birds', aG * calm * (0.25 + 0.75 * near) * (night || wet ? 0 : 1) * (winter ? 0.35 : 1), pan('green'));
    set('crickets', aG * Math.sqrt(calm) * (0.3 + 0.7 * near) * (night && !winter && !wet ? 1 : 0), pan('green'));
    set('traffic', aM * (0.35 + 0.65 * near) * (night ? 0.7 : 1), pan('mv'));
    set('idle', aS * (0.3 + 0.7 * near), pan('st'));
    set('industry', aI * (0.35 + 0.65 * near) * (night ? 0.75 : 1), pan('ind'));
    set('river', aW * (0.4 + 0.6 * near) * (1 - 0.6 * zf) * (FX.flood ? 0.3 : 1), pan('water'));
    set('city', (0.1 + 0.6 * zf) * (night ? 0.7 : 1) * (1 - 0.5 * aG * near));
    set('wind', zf * zf + (env.weather === 'storm' ? 0.5 : 0));
    let club = 0;
    let cp = 0;
    if (night) {
      for (const c of this.clubs) {
        const G = this.geo(c.x, c.z, 5);
        club += G.g;
        cp += G.g * G.pan;
      }
    }
    set('club', club, club ? cp / club : 0);
    // événements des crises
    const sum = { fire: [0, 0], crowd: [0, 0], alarm: [0, 0], bell: [0, 0], water: [0, 0] };
    const add = (k, g, p) => {
      sum[k][0] += g;
      sum[k][1] += g * p;
    };
    for (const ev of FX.list) {
      if (ev.type === 'fire' && !ev.ended) {
        const b = ev.box;
        const G = this.geo((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, 12);
        add('fire', ev.k * G.g * (0.6 + 0.3 * (ev.size || 1)), G.pan);
      } else if ((ev.type === 'riot' || ev.type === 'protest') && !ev.ended) {
        const G = this.geo(ev.cx, ev.cz, 14);
        add('crowd', ev.crowd * G.g * (ev.type === 'riot' ? 1 : 0.6), G.pan);
        if (ev.type === 'riot' && ev.crowd > 0.3 && Math.random() < 0.5 * step) {
          this.shot(['bang', 'crash', 'glass', 'bang'][(Math.random() * 4) | 0], ev.cx + (Math.random() - 0.5) * ev.len, ev.cz + (Math.random() - 0.5) * 0.8, 0.8, 12);
        }
      } else if (ev.type === 'burglary' && ev.alarm) {
        const G = this.geo(ev.door.x, ev.door.z, 9);
        add('alarm', G.g, G.pan);
      } else if (ev.type === 'robbery' && ev.bell) {
        const G = this.geo(ev.door.x, ev.door.z, 10);
        add('bell', G.g, G.pan);
      }
    }
    if (FX.flood) {
      const f = FX.flood;
      const G = this.geo(f.cx, f.cz, 12 + Math.max(f.rx, f.rz));
      add('water', f.L * G.g, G.pan);
    }
    for (const k in sum) set(k, sum[k][0], sum[k][0] ? sum[k][1] / sum[k][0] : 0);
    set('rain', FX.rain * (0.7 + 0.3 * (1 - zf)));
    if (env.weather === 'storm' && FX.rain > 0.5 && Math.random() < step / 9) this.shot('thunder', null, null, 0.5 + 0.5 * Math.random());
    for (const [k, type] of [['sirenFire', 'firetruck'], ['sirenPolice', 'police']]) {
      let best = 0;
      let bp = 0;
      for (const v of TRAFFIC.sirens?.() ?? []) {
        if (v.type !== type || v.rx == null) continue;
        const G = this.geo(v.rx, v.rz, 10);
        if (G.g > best) {
          best = G.g;
          bp = G.pan;
        }
      }
      set(k, best, bp);
    }
    // klaxons dans les bouchons
    if (aS > 0.05 && Math.random() < aS * near * 0.8 * step) {
      const R = 3 + cam.d * 0.4;
      const jam = (TRAFFIC.veh ?? []).filter((v) => !v.emergency && v.spd < 0.08 && Math.abs(v.rx - cam.tx) < R && Math.abs(v.rz - cam.tz) < R);
      if (jam.length) {
        const v = jam[(Math.random() * jam.length) | 0];
        this.shot(['horn1', 'horn2', 'horn3'][(Math.random() * 3) | 0], v.rx, v.rz, 1, 7);
      }
    }
    // application en douceur ; en pause, la ville se fait plus discrète
    const now = this.ctx.currentTime;
    const k0 = env.paused ? 0.45 : 1;
    for (const k of LOOPS) {
      const v = this.voices[k];
      if (!v) continue;
      const g = (L[k] || 0) * BASE[k] * k0;
      this.levels[k] = Math.round(g * 1000) / 1000;
      v.g.gain.setTargetAtTime(g, now, 0.25);
      if (v.p) v.p.pan.setTargetAtTime(P[k] || 0, now, 0.25);
    }
  }

  dispose() {
    for (const v of Object.values(this.voices)) {
      try {
        v.src.stop();
        v.src.disconnect();
      } catch {
        /* voix déjà arrêtée */
      }
    }
    this.voices = {};
    this.loopBus?.disconnect();
    this.shotBus?.disconnect();
    this.ctx = null;
    this.ready = false;
  }
}

export const SOUND_LOOPS = LOOPS;
export const SOUND_SHOTS = SHOTS;
