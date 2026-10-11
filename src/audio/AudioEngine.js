/**
 * Audio entièrement synthétisé (Web Audio API) : aucun fichier son, aucune ressource externe.
 *
 * - Effets d'interface et de jeu (construction, route, zonage, démolition, refus, notifications, crises).
 * - Ambiance urbaine continue qui suit la caméra : rumeur de la ville et circulation selon la densité visible
 *   et le zoom, oiseaux le jour dans les quartiers calmes, grillons les nuits d'été, pluie, vent, tonnerre.
 * - Musique générative propre à chaque ère (ville connectée, autonome, symbiotique), plus tendue pendant
 *   une crise.
 *
 * Les navigateurs (iPhone en particulier) n'autorisent le son qu'après un geste de l'utilisateur :
 * `unlock()` est appelé au premier appui ou à la première touche.
 */

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

/** Progressions (notes MIDI des accords) et caractère de chaque ère. */
const ERA_MUSIC = {
  1: { bpm: 72, chords: [[48, 55, 64, 67], [45, 52, 60, 64], [41, 48, 57, 64], [43, 50, 59, 62]], scale: [60, 62, 64, 67, 69, 72, 74, 76], wave: 'triangle', pluck: 'sine', density: 0.55 },
  2: { bpm: 96, chords: [[50, 57, 62, 65], [48, 55, 60, 64], [46, 53, 58, 62], [45, 52, 57, 60]], scale: [62, 64, 65, 67, 69, 71, 72, 74, 76], wave: 'sawtooth', pluck: 'square', density: 0.75 },
  3: { bpm: 60, chords: [[52, 59, 66, 68], [54, 61, 66, 70], [49, 56, 64, 68], [47, 54, 63, 66]], scale: [64, 66, 68, 70, 71, 73, 75, 76, 78, 80], wave: 'sine', pluck: 'sine', density: 0.45, bells: true }
};
const CRISIS_MUSIC = { bpm: 84, chords: [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 58], [40, 47, 52, 56]], scale: [57, 59, 60, 62, 64, 65, 67, 69], wave: 'sawtooth', pluck: 'triangle', density: 0.5 };

export class AudioEngine {
  /** @param {{get:(k:string)=>any}} settings */
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
    this.lastPlay = {};
    this.music = { era: 1, crisis: false, step: 0, nextTime: 0, timer: null, chord: 0 };
    this.ambience = null;
    this.env = { density: 0, traffic: 0, zoom: 1, weather: 'clear', intensity: 0, night: 0, season: 'summer', paused: false, inMenu: true, green: 0 };
  }

  get supported() {
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  /** À appeler lors d'un geste de l'utilisateur : crée ou réveille le contexte audio. */
  unlock() {
    if (!this.supported) return;
    try {
      if (!this.ctx) this.#create();
      if (this.ctx.state === 'suspended' && !this.#muted()) this.ctx.resume().catch(() => {});
    } catch {
      /* audio indisponible : le jeu reste muet */
    }
  }

  #create() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.busMusic = ctx.createGain();
    this.busSfx = ctx.createGain();
    this.busAmb = ctx.createGain();
    for (const b of [this.busMusic, this.busSfx, this.busAmb]) b.connect(this.master);
    // Réverbération légère et économe : deux lignes à retard bouclées et filtrées (pas de convolution)
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.28;
    for (const [time, fb] of [[0.113, 0.42], [0.171, 0.36]]) {
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = time;
      const feedback = ctx.createGain();
      feedback.gain.value = fb;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2400;
      this.reverbSend.connect(delay);
      delay.connect(tone);
      tone.connect(feedback);
      feedback.connect(delay);
      tone.connect(this.master);
    }
    this.noise = this.#noiseBuffer('white', 3);
    this.brown = this.#noiseBuffer('brown', 4);
    this.applyVolumes();
    this.#startAmbience();
    this.#startMusic();
    this.ready = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else if (!this.#muted()) this.ctx.resume().catch(() => {});
    });
  }

  #muted() {
    return !!this.settings.get('muted');
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = (k, d) => {
      const x = Number(this.settings.get(k));
      return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d;
    };
    const master = this.#muted() ? 0 : v('volumeMaster', 0.8);
    this.master.gain.setTargetAtTime(master * master, t, 0.05);
    // Silence complet : le moteur audio est mis en veille (aucun calcul, économie de batterie)
    if (master === 0 && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    else if (master > 0 && this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {});
    this.busMusic.gain.setTargetAtTime(v('volumeMusic', 0.5) * 0.55, t, 0.1);
    this.busSfx.gain.setTargetAtTime(v('volumeSfx', 0.7), t, 0.05);
    this.busAmb.gain.setTargetAtTime(v('volumeAmbience', 0.6) * 0.9, t, 0.1);
  }

  #noiseBuffer(kind, seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296 * 2 - 1;
    };
    for (let i = 0; i < len; i++) {
      const w = rnd();
      if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  // ───────────────────────────── Effets ─────────────────────────────

  #tone(dest, { freq, type = 'sine', start, dur, gain = 0.3, attack = 0.005, endFreq, detune = 0, reverb = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + dur);
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    g.connect(dest);
    if (reverb) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      g.connect(s);
      s.connect(this.reverbSend);
    }
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  #burst(dest, { start, dur, gain = 0.3, type = 'lowpass', freq = 800, endFreq, q = 0.8, buffer, attack = 0.005, reverb = 0 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer ?? this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, start);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    if (reverb) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      g.connect(s);
      s.connect(this.reverbSend);
    }
    src.start(start, Math.random() * 2);
    src.stop(start + dur + 0.05);
  }

  /**
   * Joue un effet sonore.
   * @param {string} name
   */
  play(name) {
    if (!this.ready || this.#muted() || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const minGap = { click: 0.04, build: 0.08, road: 0.12, zone: 0.12, info: 0.6, success: 0.5, warning: 0.5, danger: 0.8, thunder: 1.5 }[name] ?? 0.1;
    if (now - (this.lastPlay[name] ?? -9) < minGap) return;
    this.lastPlay[name] = now;
    const d = this.busSfx;
    const t = now + 0.01;
    switch (name) {
      case 'click':
        this.#tone(d, { freq: 1180, endFreq: 900, start: t, dur: 0.05, gain: 0.08, type: 'triangle' });
        break;
      case 'hover':
        this.#tone(d, { freq: 1500, start: t, dur: 0.03, gain: 0.025 });
        break;
      case 'build':
        this.#tone(d, { freq: 140, endFreq: 55, start: t, dur: 0.28, gain: 0.5 });
        this.#burst(d, { start: t, dur: 0.16, gain: 0.25, freq: 1800, endFreq: 300 });
        this.#tone(d, { freq: 660, start: t + 0.09, dur: 0.12, gain: 0.08, type: 'square', reverb: 0.3 });
        break;
      case 'road':
        this.#burst(d, { start: t, dur: 0.35, gain: 0.22, type: 'bandpass', freq: 500, endFreq: 1400, q: 1.2 });
        this.#tone(d, { freq: 220, start: t + 0.05, dur: 0.2, gain: 0.12, type: 'triangle' });
        break;
      case 'zone':
        this.#tone(d, { freq: 523, start: t, dur: 0.18, gain: 0.12, type: 'triangle', reverb: 0.4 });
        this.#tone(d, { freq: 784, start: t + 0.06, dur: 0.22, gain: 0.09, type: 'triangle', reverb: 0.4 });
        break;
      case 'demolish':
        this.#burst(d, { start: t, dur: 0.7, gain: 0.45, freq: 2400, endFreq: 120, q: 0.6 });
        this.#tone(d, { freq: 90, endFreq: 40, start: t, dur: 0.5, gain: 0.45 });
        for (let k = 0; k < 4; k++) this.#burst(d, { start: t + 0.15 + k * 0.09, dur: 0.08, gain: 0.12, type: 'highpass', freq: 2500 });
        break;
      case 'error':
        this.#tone(d, { freq: 200, start: t, dur: 0.12, gain: 0.12, type: 'square' });
        this.#tone(d, { freq: 150, start: t + 0.13, dur: 0.16, gain: 0.12, type: 'square' });
        break;
      case 'money':
        this.#tone(d, { freq: 1318, start: t, dur: 0.25, gain: 0.12, reverb: 0.3 });
        this.#tone(d, { freq: 1760, start: t + 0.08, dur: 0.35, gain: 0.1, reverb: 0.3 });
        break;
      case 'tech':
        [0, 4, 7, 12].forEach((s, k) => this.#tone(d, { freq: NOTE(72 + s), start: t + k * 0.07, dur: 0.4, gain: 0.08, type: 'sine', reverb: 0.5 }));
        break;
      case 'undo':
        this.#tone(d, { freq: 700, endFreq: 420, start: t, dur: 0.15, gain: 0.1, type: 'triangle' });
        break;
      case 'info':
        this.#tone(d, { freq: 880, start: t, dur: 0.3, gain: 0.06, reverb: 0.4 });
        break;
      case 'success':
        [0, 4, 7].forEach((s, k) => this.#tone(d, { freq: NOTE(76 + s), start: t + k * 0.08, dur: 0.35, gain: 0.08, type: 'triangle', reverb: 0.5 }));
        break;
      case 'warning':
        this.#tone(d, { freq: NOTE(74), start: t, dur: 0.22, gain: 0.1, type: 'triangle', reverb: 0.3 });
        this.#tone(d, { freq: NOTE(70), start: t + 0.18, dur: 0.3, gain: 0.1, type: 'triangle', reverb: 0.3 });
        break;
      case 'danger':
        for (let k = 0; k < 3; k++) this.#tone(d, { freq: 740, start: t + k * 0.22, dur: 0.16, gain: 0.12, type: 'square' });
        break;
      case 'siren': {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = 620;
        lfo.frequency.value = 0.9;
        lg.gain.value = 180;
        lfo.connect(lg);
        lg.connect(o.frequency);
        f.type = 'lowpass';
        f.frequency.value = 1600;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        o.connect(f);
        f.connect(g);
        g.connect(d);
        o.start(t);
        lfo.start(t);
        o.stop(t + 2.7);
        lfo.stop(t + 2.7);
        break;
      }
      case 'thunder':
        this.#burst(d, { start: t, dur: 0.25, gain: 0.35, freq: 3000, endFreq: 400 });
        this.#burst(d, { start: t + 0.1, dur: 2.8, gain: 0.55, freq: 260, endFreq: 60, buffer: this.brown, attack: 0.05, reverb: 0.6 });
        break;
      case 'fanfare':
        [[0, 0], [4, 0.14], [7, 0.28], [12, 0.42], [7, 0.62], [12, 0.76]].forEach(([s, dt]) =>
          this.#tone(d, { freq: NOTE(67 + s), start: t + dt, dur: 0.5, gain: 0.1, type: 'triangle', reverb: 0.5 })
        );
        break;
      case 'fail':
        [[0, 0], [-3, 0.3], [-7, 0.6]].forEach(([s, dt]) => this.#tone(d, { freq: NOTE(64 + s), start: t + dt, dur: 0.6, gain: 0.1, type: 'triangle', reverb: 0.5 }));
        break;
      default:
        break;
    }
  }

  // ───────────────────────────── Ambiance ─────────────────────────────

  /**
   * Boucle d'ambiance (bruit filtré) démarrée seulement quand elle doit s'entendre et arrêtée après
   * quelques secondes de silence : rien n'est calculé pour un son inaudible.
   */
  #loop(buffer, filterType, freq, q = 0.7) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    f.connect(g);
    g.connect(this.busAmb);
    const loop = { src: null, f, g, quiet: 0 };
    loop.set = (target, t, tc) => {
      if (target > 0.002) {
        loop.quiet = 0;
        if (!loop.src) {
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.loop = true;
          src.connect(f);
          src.start(0, Math.random() * 2);
          loop.src = src;
        }
      } else if (loop.src && ++loop.quiet > 12) {
        loop.src.stop();
        loop.src.disconnect();
        loop.src = null;
      }
      g.gain.setTargetAtTime(target, t, tc);
    };
    return loop;
  }

  #startAmbience() {
    this.ambience = {
      hum: this.#loop(this.brown, 'lowpass', 380),
      traffic: this.#loop(this.noise, 'bandpass', 900, 0.5),
      rain: this.#loop(this.noise, 'highpass', 2500, 0.4),
      wind: this.#loop(this.brown, 'bandpass', 500, 0.9),
      nextBird: 0,
      nextCricket: 0,
      nextHorn: 0
    };
  }

  /**
   * Met à jour l'ambiance (appelé quelques fois par seconde).
   * @param {Partial<typeof this.env>} env
   */
  update(env) {
    Object.assign(this.env, env);
    if (!this.ready || !this.ambience) return;
    const e = this.env;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const a = this.ambience;
    const near = Math.max(0, Math.min(1, (e.zoom - 0.45) / 1.2));
    const active = e.inMenu ? 0 : 1;
    const level = active * (e.paused ? 0.45 : 1);
    a.hum.set(level * (e.density > 0.02 ? 0.05 + 0.22 * e.density : 0) * (0.6 + 0.4 * (1 - near)), t, 0.6);
    a.traffic.set(level * e.traffic * (0.06 + 0.2 * near), t, 0.5);
    a.traffic.f.frequency.setTargetAtTime(700 + 500 * Math.random(), t, 0.8);
    const wet = e.weather === 'rain' ? 0.12 + 0.18 * e.intensity : e.weather === 'storm' ? 0.34 : 0;
    a.rain.set(active * wet, t, 0.8);
    const windy = e.weather === 'storm' ? 0.35 : e.weather === 'snow' ? 0.12 : e.weather === 'fog' ? 0.03 : 0;
    a.wind.set(active * windy * (0.6 + 0.4 * Math.sin(t * 0.3) ** 2), t, 1.2);
    a.wind.f.frequency.setTargetAtTime(380 + 260 * Math.sin(t * 0.23) ** 2, t, 1);
    if (!active || e.paused) return;
    // Oiseaux : le jour, beau temps, quartiers peu denses ou verts, caméra proche
    const calm = e.night < 0.4 && (e.weather === 'clear' || e.weather === 'cloudy') && e.season !== 'winter';
    if (calm && near > 0.25 && t > a.nextBird) {
      a.nextBird = t + 1.5 + Math.random() * (4 + 6 * e.density);
      if (Math.random() < 0.4 + 0.6 * (1 - e.density) + e.green) this.#bird(t);
    }
    // Grillons : nuits d'été
    if (e.night > 0.6 && e.season === 'summer' && e.weather === 'clear' && t > a.nextCricket) {
      a.nextCricket = t + 0.8 + Math.random() * 1.6;
      this.#cricket(t);
    }
    // Klaxons lointains quand la circulation est dense
    if (e.traffic > 0.55 && near > 0.3 && t > a.nextHorn) {
      a.nextHorn = t + 4 + Math.random() * 10;
      this.#tone(this.busAmb, { freq: 392 + Math.random() * 60, start: t, dur: 0.22, gain: 0.025, type: 'square' });
    }
  }

  #bird(t) {
    const base = 2400 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      this.#tone(this.busAmb, { freq: base * (1 + Math.random() * 0.2), endFreq: base * (0.75 + Math.random() * 0.6), start: t + k * 0.11, dur: 0.07 + Math.random() * 0.05, gain: 0.025, reverb: 0.4 });
    }
  }

  #cricket(t) {
    for (let k = 0; k < 3; k++) this.#tone(this.busAmb, { freq: 4300, start: t + k * 0.06, dur: 0.035, gain: 0.012, type: 'triangle' });
  }

  // ───────────────────────────── Musique ─────────────────────────────

  /** Choisit l'ère (thème) et l'humeur (crise) de la musique. */
  setMusic({ era = 1, crisis = false } = {}) {
    this.music.era = era;
    this.music.crisis = crisis;
  }

  #startMusic() {
    const m = this.music;
    m.nextTime = this.ctx.currentTime + 0.3;
    m.timer = setInterval(() => this.#schedule(), 90);
  }

  #schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const m = this.music;
    const theme = m.crisis ? CRISIS_MUSIC : ERA_MUSIC[m.era] ?? ERA_MUSIC[1];
    const beat = 60 / theme.bpm / 2; // croches
    const horizon = this.ctx.currentTime + 0.25;
    if (m.nextTime < this.ctx.currentTime - 1) m.nextTime = this.ctx.currentTime + 0.05;
    while (m.nextTime < horizon) {
      this.#musicStep(theme, m.step, m.nextTime, beat);
      m.step++;
      m.nextTime += beat;
    }
  }

  #musicStep(theme, step, t, beat) {
    const d = this.busMusic;
    const bar = Math.floor(step / 16);
    const chord = theme.chords[bar % theme.chords.length];
    const pos = step % 16;
    // Nappe : un accord par mesure
    if (pos === 0) {
      for (const n of chord) {
        this.#tone(d, { freq: NOTE(n), type: theme.wave === 'sawtooth' ? 'triangle' : theme.wave, start: t, dur: beat * 16, gain: 0.03, attack: beat * 3, detune: (Math.random() - 0.5) * 10, reverb: 0.6 });
      }
      this.#tone(d, { freq: NOTE(chord[0] - 12), type: 'sine', start: t, dur: beat * 15, gain: 0.05, attack: 0.08 });
    }
    // Pulsation (ère 2 et crise)
    if ((theme === ERA_MUSIC[2] || theme === CRISIS_MUSIC) && pos % 4 === 0) {
      this.#tone(d, { freq: 70, endFreq: 40, start: t, dur: 0.22, gain: theme === CRISIS_MUSIC ? 0.1 : 0.07 });
    }
    if (theme === ERA_MUSIC[2] && pos % 2 === 1) {
      this.#tone(d, { freq: NOTE(chord[(step >> 1) % chord.length] + 12), type: 'square', start: t, dur: beat * 0.9, gain: 0.012 });
    }
    // Mélodie générative (déterministe par pas, pour une phrase qui se répète un peu)
    const r = pseudo(step * 7 + bar * 13);
    if (pos % 2 === 0 && r < theme.density) {
      const idx = Math.floor(pseudo(step * 3 + 1) * theme.scale.length);
      const n = theme.scale[idx];
      if (theme.bells) {
        this.#tone(d, { freq: NOTE(n + 12), type: 'sine', start: t, dur: beat * 6, gain: 0.03, reverb: 0.8 });
        this.#tone(d, { freq: NOTE(n + 12) * 2.76, type: 'sine', start: t, dur: beat * 2, gain: 0.008, reverb: 0.8 });
      } else {
        this.#tone(d, { freq: NOTE(n), type: theme.pluck, start: t, dur: beat * 3, gain: theme.pluck === 'square' ? 0.018 : 0.045, reverb: 0.5 });
      }
    }
  }

  destroy() {
    clearInterval(this.music.timer);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.ready = false;
  }
}

function pseudo(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
