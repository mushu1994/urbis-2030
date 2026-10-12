import { Container, Graphics } from 'pixi.js';
import { gridToWorld } from './IsometricProjection.js';
import { corners } from './art/GroundArt.js';
import { constructionDays, craneGeometry, drawCraneMast, drawCraneJib, drawBuildingLights, drawStreetLight, smokeEmitters, roofCenter } from './art/EffectsArt.js';
import { mix } from './art/color.js';

/**
 * Effets visuels, purement décoratifs (ils lisent l'état, ne le modifient jamais) :
 * - cycle jour/nuit (teinte de la scène, fenêtres et lampadaires allumés, phares) ;
 * - météo (pluie, neige, brouillard, orage et éclairs, chaleur) ;
 * - chantiers animés (grues), fumées des usines et centrales ;
 * - crises : eau des inondations, flammes et fumée noire des incendies.
 */

/** Part du cycle passée en journée (le reste est la nuit). */
export const DAYLIGHT_SHARE = 0.7;
const MAX_PARTICLES = 320;

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Nuit (0 = plein jour, 1 = pleine nuit) selon la phase du cycle, calé sur le mois de jeu :
 * phase 0 = début du mois (aube), 70 % du mois en journée, 30 % de nuit, avec crépuscule et aube progressifs.
 */
export function nightAt(phase) {
  const p = ((phase % 1) + 1) % 1;
  const dusk = smooth(DAYLIGHT_SHARE - 0.04, DAYLIGHT_SHARE + 0.03, p);
  const dawn = smooth(0.97, 1, p);
  return Math.max(0, dusk - dawn);
}

const WEATHER_TINT = { clear: 0xffffff, cloudy: 0xe4e8ee, rain: 0xc8d0db, storm: 0x98a2b4, snow: 0xeef2f8, fog: 0xf1f2f4, heat: 0xfff0d6 };

export class EffectsRenderer {
  /**
   * @param {import('./LayerManager.js').LayerManager} layers
   * @param {Container} stage
   */
  constructor(layers, stage) {
    this.layers = layers;
    this.stage = stage;
    // Monde, sous les bâtiments : eau des crues
    this.flood = new Graphics();
    layers.world.addChildAt(this.flood, layers.world.getChildIndex(layers.ground) + 1);
    // Montée des eaux : la rivière s'élève d'un cran pendant une inondation (sous les routes et les ponts)
    this.river = new Graphics();
    layers.world.addChildAt(this.river, layers.world.getChildIndex(layers.ground));
    this.riverLevel = 0;
    this.riverDrawn = -1;
    // Monde, au-dessus des bâtiments : fumées et flammes
    this.smoke = new Graphics();
    this.fire = new Graphics();
    layers.world.addChildAt(this.smoke, layers.world.getChildIndex(layers.alerts));
    layers.world.addChildAt(this.fire, layers.world.getChildIndex(layers.alerts));
    // Écran : teinte jour/nuit et météo (multiplication)
    this.tint = new Graphics();
    this.tint.blendMode = 'multiply';
    // Monde, au-dessus de la teinte : lumières (addition)
    this.lights = new Container();
    this.lights.blendMode = 'add';
    this.streetLights = new Graphics();
    this.headlights = new Graphics();
    this.lights.addChild(this.streetLights, this.headlights);
    this.buildingLights = new Map();
    // Écran : précipitations, brouillard, éclairs
    this.weather = new Graphics();
    this.fog = new Graphics();
    this.flash = new Graphics();
    stage.addChild(this.tint, this.lights, this.fog, this.weather, this.flash);

    this.cranes = new Map();
    this.particles = [];
    this.drops = [];
    this.emitters = [];
    this.emittersDirty = true;
    this.streetDirty = true;
    this.phase = 0.36;
    this.night = 0;
    this.time = 0;
    this.flashAlpha = 0;
    this.nextFlash = 6000;
    this.floodTimer = 0;
    this.options = { dayNight: true, weather: true, effects: true, reducedMotion: false };
    this.onThunder = null;
    this.seed = 7;
  }

  #rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  setOptions(o) {
    Object.assign(this.options, o);
    if (!this.options.effects) {
      this.particles.length = 0;
      this.smoke.clear();
      this.fire.clear();
      for (const c of this.cranes.values()) c.visible = false;
    }
    if (!this.options.weather) {
      this.drops.length = 0;
      this.weather.clear();
      this.fog.clear();
      this.flash.clear();
    }
  }

  reset() {
    for (const c of this.cranes.values()) c.destroy({ children: true });
    this.cranes.clear();
    for (const g of this.buildingLights.values()) g.destroy();
    this.buildingLights.clear();
    this.particles.length = 0;
    this.drops.length = 0;
    this.emittersDirty = true;
    this.streetDirty = true;
    this.flood.clear();
    this.river.clear();
    this.riverLevel = 0;
    this.riverDrawn = -1;
    this.smoke.clear();
    this.fire.clear();
    this.streetLights.clear();
    this.headlights.clear();
  }

  // ───────────────────────────── Chantiers ─────────────────────────────

  /** Jour de fin de chantier, ou 0 si le bâtiment est terminé. */
  constructionEnd(def, b, tick) {
    const days = def.kind === 'growable' ? 0 : constructionDays(def);
    if (!days || !this.options.effects) return 0;
    const end = b.builtTick + days;
    return tick < end && tick >= b.builtTick ? end : 0;
  }

  /** Associe (ou retire) une grue au chantier d'un bâtiment. */
  setCrane(b, def, alt, active, zIndex) {
    let c = this.cranes.get(b.id);
    if (!active || def.visual.height < 14) {
      if (c) {
        c.destroy({ children: true });
        this.cranes.delete(b.id);
      }
      return;
    }
    if (!c) {
      c = new Container();
      const mast = new Graphics();
      const jib = new Graphics();
      c.addChild(mast, jib);
      c.__geo = craneGeometry(def, b, alt);
      c.__phase = (b.id * 0.37) % 6.28;
      drawCraneMast(mast, c.__geo);
      this.layers.objects.addChild(c);
      this.cranes.set(b.id, c);
    }
    c.zIndex = zIndex + 1;
  }

  removeBuilding(id) {
    const c = this.cranes.get(id);
    if (c) {
      c.destroy({ children: true });
      this.cranes.delete(id);
    }
    const g = this.buildingLights.get(id);
    if (g) {
      g.destroy();
      this.buildingLights.delete(id);
    }
    this.emittersDirty = true;
  }

  /** Fenêtres allumées d'un bâtiment (redessinées avec lui). */
  drawLights(b, def, alt) {
    let g = this.buildingLights.get(b.id);
    if (!g) {
      g = new Graphics();
      this.buildingLights.set(b.id, g);
      this.lights.addChild(g);
    }
    g.clear();
    drawBuildingLights(g, def, b, alt, { burning: !!b.burning });
    this.emittersDirty = true;
  }

  markStreets() {
    this.streetDirty = true;
  }

  markEmitters() {
    this.emittersDirty = true;
  }

  // ───────────────────────────── Image ─────────────────────────────

  /**
   * @param {{state:any, catalog:any, camera:any, view:{width:number,height:number}, rect:any, dtMs:number, paused:boolean, speedIndex:number, buildingGfx: Map<number, any>}} ctx
   */
  update(ctx) {
    const { state, dtMs, paused } = ctx;
    const dt = Math.min(100, dtMs);
    const running = !paused;
    if (running) this.time += dt;
    // Horloge visuelle du jour (ralentie en pause, accélérée avec la vitesse du jeu)
    // Cycle jour/nuit calé sur le calendrier : un cycle par mois de jeu, interpolé entre deux jours
    const target = (state.time.tick % 30) / 30;
    if (running) this.phase = (this.phase + (dt / 1000) * ((ctx.ticksPerSecond ?? 0.5) / 30)) % 1;
    let err = target + 1 / 60 - this.phase;
    if (err > 0.5) err -= 1;
    if (err < -0.5) err += 1;
    if (Math.abs(err) > 0.08) this.phase = (target + 1) % 1;
    else this.phase = (this.phase + err * 0.04 + 1) % 1;
    this.night = this.options.dayNight ? nightAt(this.phase) : 0;

    // Les lumières suivent la transformation de la caméra
    const w = this.layers.world;
    this.lights.scale.set(w.scale.x);
    this.lights.position.set(w.position.x, w.position.y);
    this.lights.alpha = this.night;
    this.lights.visible = this.night > 0.02;
    for (const [id, g] of this.buildingLights) g.visible = ctx.buildingGfx.get(id)?.visible ?? false;
    if (this.streetDirty && this.night > 0.01) this.#drawStreets(state);

    this.#drawTint(state, ctx.view);
    if (this.options.effects) {
      this.#updateCranes(dt, running, ctx.rect);
      if (this.emittersDirty) this.#collectEmitters(state, ctx.catalog);
      this.#updateSmoke(state, dt, running, ctx.rect);
      this.#drawFire(state, ctx.catalog, ctx.rect);
    }
    this.floodTimer -= dt;
    if (this.floodTimer <= 0) {
      this.#drawFlood(state);
      this.floodTimer = 180;
    }
    this.#updateRiver(state, dt);
    if (this.options.weather) this.#updateWeather(state, dt, running, ctx.view);
  }

  #drawTint(state, view) {
    const g = this.tint;
    g.clear();
    const w = state.weather;
    let color = this.options.weather ? WEATHER_TINT[w?.kind] ?? 0xffffff : 0xffffff;
    if (this.night > 0) {
      // Crépuscule orangé puis nuit bleutée
      // v0.4 : nuit plus claire (≈ 65 % de luminosité au cœur de la nuit au lieu de 38 %)
      const dusk = Math.max(0, 1 - Math.abs(this.night - 0.45) * 2.6) * 0.4;
      const night = mix(0xffffff, 0x6f80b0, this.night * 0.62);
      color = multiply(color, mix(night, 0xffb070, dusk));
    }
    if (color === 0xffffff) return;
    g.rect(0, 0, view.width, view.height).fill(color);
  }

  #drawStreets(state) {
    const g = this.streetLights;
    g.clear();
    const grid = state.grid;
    const era = state.progression?.era ?? 1;
    for (let i = 0; i < grid.size; i++) {
      if (!grid.road[i]) continue;
      drawStreetLight(g, grid.xOf(i), grid.yOf(i), grid.surfaceAlt(i), era);
    }
    this.streetDirty = false;
  }

  #updateCranes(dt, running, rect) {
    for (const c of this.cranes.values()) {
      const geo = c.__geo;
      c.visible = !(geo.top.x + geo.reach < rect.x0 || geo.top.x - geo.reach > rect.x1 || geo.top.y > rect.y1 || geo.base.y < rect.y0);
      if (!c.visible) continue;
      if (running) c.__phase += dt * 0.0006;
      const jib = c.children[1];
      jib.clear();
      drawCraneJib(jib, geo, Math.cos(c.__phase), 10 + 8 * Math.sin(c.__phase * 2.3));
    }
  }

  #collectEmitters(state, catalog) {
    const out = [];
    const t = state.time.tick;
    for (const b of state.buildings.values()) {
      if (b.abandoned || b.disabledUntil > t) continue;
      const def = catalog.building(b.defId);
      if (!((def.environment?.pollution ?? 0) > 0 || def.visual.detail === 'cooling')) continue;
      if ((def.networks?.power ?? 0) > 0 && !b.powered) continue;
      if (def.capacity?.jobs && !(b.jobsFilled > 0)) continue;
      const alt = state.grid.altitude[state.grid.idx(b.x, b.y)];
      for (const e of smokeEmitters(def, b, alt)) out.push(e);
    }
    this.emitters = out;
    this.emittersDirty = false;
  }

  #spawn(x, y, dark, steam) {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({
      x: x + (this.#rand() - 0.5) * 3,
      y,
      vx: (this.#rand() - 0.3) * 4,
      vy: -(9 + this.#rand() * 7),
      age: 0,
      life: 2600 + this.#rand() * 1800,
      r: 2.4 + this.#rand() * 1.6,
      dark,
      steam
    });
  }

  #updateSmoke(state, dt, running, rect) {
    const g = this.smoke;
    g.clear();
    const wind = { storm: 22, rain: 9, snow: 6, clear: 5, cloudy: 6, fog: 2, heat: 3 }[state.weather?.kind] ?? 5;
    if (running) {
      for (const e of this.emitters) {
        if (e.x < rect.x0 || e.x > rect.x1 || e.y < rect.y0 - 80 || e.y > rect.y1) continue;
        if (this.#rand() < e.rate * dt * 0.0016) this.#spawn(e.x, e.y, e.dark, e.steam);
      }
      for (const b of this.burning ?? []) {
        if (this.#rand() < dt * 0.006) this.#spawn(b.x + (this.#rand() - 0.5) * b.w * 0.6, b.y, true, false);
      }
    }
    for (let k = this.particles.length - 1; k >= 0; k--) {
      const p = this.particles[k];
      if (running) {
        p.age += dt;
        const s = dt / 1000;
        p.x += (p.vx + wind) * s;
        p.y += p.vy * s;
        p.vy *= 0.995;
        if (p.age >= p.life) {
          this.particles.splice(k, 1);
          continue;
        }
      }
      if (p.x < rect.x0 || p.x > rect.x1 || p.y < rect.y0 || p.y > rect.y1) continue;
      const t = p.age / p.life;
      const r = p.r * (1 + t * 2.6);
      const alpha = (p.steam ? 0.35 : p.dark ? 0.55 : 0.42) * (1 - t) * Math.min(1, p.age / 250);
      const color = p.dark ? 0x2b2622 : p.steam ? 0xf4f6f8 : mix(0xd9d6d0, 0x9d9a95, t);
      g.circle(p.x, p.y, r).fill({ color, alpha });
    }
  }

  #drawFire(state, catalog, rect) {
    const g = this.fire;
    g.clear();
    const fires = (state.crises?.active ?? []).filter((c) => c.kind === 'fire');
    const list = [];
    for (const c of fires) {
      for (const id of Object.keys(c.burning ?? {})) {
        const b = state.buildings.get(Number(id));
        if (!b) continue;
        const def = catalog.building(b.defId);
        const alt = state.grid.altitude[state.grid.idx(b.x, b.y)];
        list.push(roofCenter(def, b, alt));
      }
    }
    this.burning = list;
    const now = this.time / 1000;
    for (const f of list) {
      if (f.x < rect.x0 || f.x > rect.x1 || f.y < rect.y0 || f.y > rect.y1 + 40) continue;
      const n = 5;
      for (let k = 0; k < n; k++) {
        const ox = (k - (n - 1) / 2) * (f.w / n) * 0.5;
        const h = 10 + 8 * Math.abs(Math.sin(now * 7 + k * 1.9));
        const wbase = 4 + (k % 2) * 2;
        g.poly([f.x + ox - wbase, f.y, f.x + ox + wbase, f.y, f.x + ox + Math.sin(now * 9 + k) * 2, f.y - h]).fill({ color: 0xff7a1a, alpha: 0.9 });
        g.poly([f.x + ox - wbase * 0.5, f.y, f.x + ox + wbase * 0.5, f.y, f.x + ox, f.y - h * 0.6]).fill({ color: 0xffd34d, alpha: 0.95 });
      }
      g.circle(f.x, f.y - 4, f.w * 0.35).fill({ color: 0xff8a2a, alpha: 0.12 });
    }
  }

  /** La rivière monte d'un cran (une hauteur de terrasse) en 3 secondes au début d'une crue, puis redescend. */
  #updateRiver(state, dt) {
    const flooding = (state.crises?.active ?? []).some((c) => c.kind === 'flood');
    const goal = flooding ? 1 : 0;
    if (this.riverLevel !== goal) {
      const step = dt / 3000;
      this.riverLevel = goal > this.riverLevel ? Math.min(goal, this.riverLevel + step) : Math.max(goal, this.riverLevel - step);
    }
    const level = Math.round(this.riverLevel * 40) / 40;
    if (level === this.riverDrawn) {
      if (level > 0) this.river.alpha = 0.82 + 0.06 * Math.sin(this.time / 600);
      return;
    }
    this.riverDrawn = level;
    const g = this.river;
    g.clear();
    if (level <= 0) return;
    const grid = state.grid;
    const surface = 0x4a87bd;
    for (let i = 0; i < grid.size; i++) {
      if (grid.terrain[i] !== 1) continue;
      const x = grid.xOf(i);
      const y = grid.yOf(i);
      const alt = grid.altitude[i] + level;
      const [T, R, B, L] = corners(x, y, alt);
      g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).fill(surface);
      // Faces visibles côté sud et est quand la case voisine est plus basse (bord de carte)
      const dh = level * 12;
      if (y + 1 >= grid.height) g.poly([L.x, L.y, B.x, B.y, B.x, B.y + dh, L.x, L.y + dh]).fill(0x3a6f9e);
      if (x + 1 >= grid.width) g.poly([B.x, B.y, R.x, R.y, R.x, R.y + dh, B.x, B.y + dh]).fill(0x2f5f8a);
      if ((x * 5 + y * 11) % 7 === 0) {
        const cx = (T.x + B.x) / 2;
        const cy = (T.y + B.y) / 2;
        g.moveTo(cx - 9, cy + 1).lineTo(cx + 6, cy - 1).stroke({ width: 1.2, color: 0xd6ecfb, alpha: 0.6 });
      }
    }
  }

  #drawFlood(state) {
    const g = this.flood;
    g.clear();
    const grid = state.grid;
    const now = this.time / 1000;
    for (const c of state.crises?.active ?? []) {
      if (c.kind !== 'flood' || !c.tiles?.length) continue;
      for (const i of c.tiles) {
        const x = grid.xOf(i);
        const y = grid.yOf(i);
        const [T, R, B, L] = corners(x, y, grid.altitude[i] + 0.35);
        const a = 0.62 + 0.08 * Math.sin(now * 2 + x * 0.7 + y * 0.4);
        g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).fill({ color: 0x4b86b8, alpha: a });
        if ((x * 7 + y * 3) % 5 === 0) {
          const cx = (T.x + B.x) / 2 + Math.sin(now + x) * 4;
          const cy = (T.y + B.y) / 2;
          g.moveTo(cx - 7, cy).lineTo(cx + 5, cy - 1).stroke({ width: 1, color: 0xcfe7fa, alpha: 0.55 });
        }
      }
    }
  }

  #updateWeather(state, dt, running, view) {
    const w = state.weather ?? { kind: 'clear', intensity: 0 };
    const g = this.weather;
    g.clear();
    const kind = w.kind;
    const area = view.width * view.height;
    const k = Math.max(0.3, w.intensity ?? 0.5);
    const want = kind === 'rain' ? Math.round((area / 7000) * k) : kind === 'storm' ? Math.round(area / 4200) : kind === 'snow' ? Math.round((area / 9000) * k) : 0;
    const target = Math.min(this.options.reducedMotion ? 60 : 420, want);
    const snow = kind === 'snow';
    while (this.drops.length < target) {
      this.drops.push({ x: this.#rand() * view.width, y: this.#rand() * view.height, s: 0.6 + this.#rand() * 0.8, ph: this.#rand() * 6.28 });
    }
    if (this.drops.length > target) this.drops.length = target;
    const s = dt / 1000;
    const windX = kind === 'storm' ? 190 : kind === 'rain' ? 70 : 25;
    const fall = snow ? 42 : kind === 'storm' ? 760 : 560;
    for (const d of this.drops) {
      if (running) {
        d.y += fall * d.s * s;
        d.x += (snow ? Math.sin(this.time / 900 + d.ph) * 16 + windX * 0.5 : windX) * s;
        if (d.y > view.height + 10) {
          d.y = -10;
          d.x = this.#rand() * view.width;
        }
        if (d.x > view.width + 10) d.x = -10;
      }
      if (snow) g.circle(d.x, d.y, 1.2 + d.s).fill({ color: 0xffffff, alpha: 0.85 });
      else g.moveTo(d.x, d.y).lineTo(d.x - windX * 0.025, d.y - 13 * d.s);
    }
    if (!snow && this.drops.length) g.stroke({ width: 1, color: 0xdce6f2, alpha: 0.5 });

    // Brouillard
    const f = this.fog;
    f.clear();
    if (kind === 'fog') {
      // v0.4 : voile plus léger, encore atténué la nuit pour ne pas « blanchir » l'écran
      const veil = (0.1 + 0.08 * k) * (1 - 0.5 * this.night);
      f.rect(0, 0, view.width, view.height).fill({ color: 0xf2f4f6, alpha: veil });
      for (let b = 0; b < 4; b++) {
        const x = ((this.time / 60 + b * view.width * 0.4) % (view.width * 1.6)) - view.width * 0.3;
        f.ellipse(x, view.height * (0.2 + b * 0.2), view.width * 0.35, 46).fill({ color: 0xffffff, alpha: 0.07 });
      }
    }

    // Orage : éclairs
    const fl = this.flash;
    fl.clear();
    if (kind === 'storm' && running && !this.options.reducedMotion) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flashAlpha = 0.55;
        this.nextFlash = 3500 + this.#rand() * 7000;
        this.onThunder?.();
      }
    }
    if (this.flashAlpha > 0.01) {
      fl.rect(0, 0, view.width, view.height).fill({ color: 0xffffff, alpha: this.flashAlpha });
      this.flashAlpha *= Math.pow(0.986, dt);
    }
  }

  /** Phares des véhicules la nuit (appelé par le rendu des véhicules). */
  get headlightsLayer() {
    return this.headlights;
  }
}

/** Multiplication de deux couleurs (composante par composante). */
function multiply(a, b) {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
