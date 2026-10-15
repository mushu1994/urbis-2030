import { Application, Graphics } from 'pixi.js';
import { LayerManager, ChunkedLayer } from './LayerManager.js';
import { Camera } from './Camera.js';
import { SelectionRenderer } from './SelectionRenderer.js';
import { VehicleRenderer } from './VehicleRenderer.js';
import { TrainRenderer } from './TrainRenderer.js';
import { AirSeaRenderer } from './AirSeaRenderer.js';
import { LineRenderer } from './LineRenderer.js';
import { isOwned, fullyOwned } from '../world/Land.js';
import { drawRailTile, drawTramTracks } from './art/GroundArt.js';
import { drawTerrainTile, drawRoadTile, drawBridgeTile, drawZoneTile, drawDeliveryZoneTile, forestTrees, corners, foliageTint } from './art/GroundArt.js';
import { EffectsRenderer } from './EffectsRenderer.js';
import { drawConstructionSite, drawRuins } from './art/EffectsArt.js';
import { seasonKey } from '../simulation/WeatherSystem.js';
import { SPEEDS } from '../simulation/SimulationClock.js';
import { drawBuilding, drawTree } from './art/BuildingArt.js';
import { gridToWorld, screenToTile } from './IsometricProjection.js';
import { OVERLAY_BY_ID } from './Overlays.js';
import { TERRAIN } from '../world/Terrain.js';
import { ROAD_REACH } from '../world/Grid.js';

/**
 * Moteur de rendu isométrique (PixiJS / WebGL).
 * Il lit l'état du jeu et réagit aux événements du bus ; il ne décide d'aucune règle et ne modifie pas le monde.
 */
export class Renderer {
  /** @param {{catalog: import('../data/Catalog.js').Catalog}} deps */
  constructor({ catalog }) {
    this.catalog = catalog;
    this.app = null;
    this.layers = new LayerManager();
    this.camera = new Camera();
    this.view = { width: 800, height: 600 };
    this.selection = new SelectionRenderer(this.layers.selection, this.layers.ghost);
    this.vehicles = new VehicleRenderer(this.layers.vehicles);
    this.trains = new TrainRenderer(this.layers.objects);
    this.airsea = new AirSeaRenderer(this.layers.objects);
    this.transitLines = new LineRenderer(this.layers.transitVehicles, this.layers.routes);
    this.buildingGfx = new Map();
    this.treeGfx = new Map();
    this.overlayId = null;
    this.hover = null;
    this.preview = null;
    this.selectedId = 0;
    this.xray = false;
    this.gridLines = false;
    this.unsub = [];
    this.dirtyTrees = new Set();
    this.dirtyBuildings = new Set();
    this.overlayDirty = false;
    this.selectionDirty = true;
    this.lastCameraVersion = -1;
    this.alertTimer = 0;
    this.stats = { fps: 0, frameMs: 0, drawCalls: 0 };
    /** Chantiers en cours : identifiant → jour de fin (le bâtiment est redessiné à la livraison). */
    this.constructing = new Map();
    /** Modèle dessiné pour chaque bâtiment (détecte les montées de niveau). */
    this.drawnDef = new Map();
    this.snowLevel = 0;
    this.season = 'summer';
  }

  async init(parent) {
    this.app = new Application();
    await this.app.init({
      resizeTo: parent,
      antialias: true,
      background: 0x7aa6c9,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      preference: 'webgl',
      powerPreference: 'high-performance'
    });
    parent.appendChild(this.app.canvas);
    this.app.canvas.setAttribute('aria-label', 'Carte de la ville');
    this.app.stage.addChild(this.layers.world);
    this.effects = new EffectsRenderer(this.layers, this.app.stage);
    this.vehicles.lightsG = this.effects.headlightsLayer;
    this.app.ticker.stop(); // la boucle est pilotée par GameLoop
    this.#resize();
    window.addEventListener('resize', () => this.#resize());
    // Le conteneur change de taille sans redimensionnement de fenêtre (mode immersif, rotation, plein écran).
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        this.app?.resize();
        this.#resize();
      }).observe(parent);
    }
  }

  #resize() {
    if (!this.app) return;
    this.view.width = this.app.screen.width;
    this.view.height = this.app.screen.height;
    this.camera.version++;
  }

  get canvas() {
    return this.app?.canvas;
  }

  /** Associe une partie : construit toutes les couches et s'abonne aux événements. */
  attach(session) {
    this.detach();
    this.session = session;
    const state = session.state;
    const grid = state.grid;
    const bus = session.bus;
    this.effects?.reset();
    this.layers.clear();
    this.trains.reset();
    this.airsea.reset();
    this.transitLines.reset();
    this.buildingGfx.clear();
    this.treeGfx.clear();
    this.constructing.clear();
    this.drawnDef.clear();
    this.#updateSeason(state, false);

    this.terrainLayer = new ChunkedLayer(this.layers.terrain, grid.width, grid.height, (g, x0, y0, x1, y1) => this.#drawTerrainChunk(g, x0, y0, x1, y1));
    this.groundLayer = new ChunkedLayer(this.layers.ground, grid.width, grid.height, (g, x0, y0, x1, y1) => this.#drawGroundChunk(g, x0, y0, x1, y1));
    this.terrainLayer.flush();
    this.groundLayer.flush();

    for (let d = 0; d <= grid.width + grid.height - 2; d++) this.dirtyTrees.add(d);
    for (const b of state.buildings.values()) this.dirtyBuildings.add(b.id);

    this.camera.setWorldSize(grid.width, grid.height);
    const entry = state.entries[0];
    if (entry !== undefined) this.camera.centerOnTile(grid.xOf(entry) + 7, grid.yOf(entry) - 3);
    else this.camera.centerOnTile(grid.width / 2, grid.height / 2);

    const markTiles = (tiles) => {
      for (const i of tiles) {
        const x = grid.xOf(i);
        const y = grid.yOf(i);
        this.terrainLayer.markTile(x, y);
        this.groundLayer.markTile(x, y);
        // Les arbres des cases voisines dépendent aussi de ce qui est construit ici
        this.dirtyTrees.add(x + y);
        this.dirtyTrees.add(x + y + 1);
        this.dirtyTrees.add(x + y + 2);
      }
    };
    this.unsub.push(
      bus.on('world:changed', ({ tiles }) => {
        if (tiles) markTiles(tiles);
        this.overlayDirty = true;
        this.selectionDirty = true;
      }),
      bus.on('building:added', ({ building }) => {
        this.dirtyBuildings.add(building.id);
        this.#markTreesAround(building);
      }),
      bus.on('building:changed', ({ building }) => this.dirtyBuildings.add(building.id)),
      bus.on('building:removed', ({ building }) => {
        this.dirtyBuildings.add(building.id);
        this.#markTreesAround(building);
      }),
      bus.on('network:rebuilt', () => {
        this.groundLayer.markAll();
        this.effects?.markStreets();
      }),
      // Simulation dans un Web Worker : cases et bâtiments modifiés depuis le dernier instantané
      bus.on('sync:dirty', ({ tiles, buildings, all }) => {
        if (all || !tiles) {
          this.terrainLayer.markAll();
          this.groundLayer.markAll();
          for (let d = 0; d <= grid.width + grid.height - 2; d++) this.dirtyTrees.add(d);
          for (const id of this.buildingGfx.keys()) this.dirtyBuildings.add(id);
          for (const b of this.session.state.buildings.values()) this.dirtyBuildings.add(b.id);
        } else markTiles(tiles);
        for (const id of buildings ?? []) this.dirtyBuildings.add(id);
        this.overlayDirty = true;
        this.selectionDirty = true;
        this.effects?.markStreets();
        this.effects?.markEmitters();
        this.vehicles.refresh(this.session.state);
      }),
      bus.on('weather:changed', () => this.#updateSeason(this.session.state, true)),
      bus.on('land:changed', () => this.terrainLayer.markAll()),
      bus.on('sim:month', () => this.#updateSeason(this.session.state, true)),
      bus.on('crisis:started', () => this.effects?.markEmitters()),
      bus.on('crisis:ended', ({ crisis }) => {
        for (const id of crisis?.burnt ?? []) this.dirtyBuildings.add(id);
        for (const id of crisis?.buildings ?? []) this.dirtyBuildings.add(id);
        this.effects?.markEmitters();
      }),
      bus.on('era:changed', () => {
        this.groundLayer.markAll();
        this.#applyEraTheme();
      }),
      bus.on('fields:updated', ({ fields }) => {
        if (fields.includes('traffic')) this.vehicles.refresh(this.session.state);
        this.overlayDirty = true;
      }),
      bus.on('world:changed', () => this.effects?.markStreets())
    );
    this.vehicles.refresh(state);
    this.overlayDirty = true;
    this.#applyEraTheme();
  }

  /** Saison et neige au sol : le terrain et les arbres sont redessinés quand l'une ou l'autre change. */
  #updateSeason(state, redraw) {
    const month = Math.floor(state.time.tick / 30) % 12;
    const season = seasonKey(month);
    const cover = state.weather?.snowCover ?? 0;
    const level = cover >= 0.7 ? 2 : cover >= 0.3 ? 1 : 0;
    if (season === this.season && level === this.snowLevel) return;
    this.season = season;
    this.snowLevel = level;
    if (!redraw || !this.terrainLayer) return;
    this.terrainLayer.markAll();
    const grid = state.grid;
    for (let d = 0; d <= grid.width + grid.height - 2; d++) this.dirtyTrees.add(d);
  }

  /** Options des effets visuels (paramètres). */
  setEffects(options) {
    this.effects?.setOptions(options);
  }

  /** Ambiance de l'ère : ciel légèrement plus bleuté à mesure que la ville se transforme. */
  #applyEraTheme() {
    const era = this.session?.state.progression?.era ?? 1;
    const sky = { 1: 0x7aa6c9, 2: 0x76a2cf, 3: 0x7b9ad6 }[era] ?? 0x7aa6c9;
    if (this.app?.renderer?.background) this.app.renderer.background.color = sky;
  }

  detach() {
    for (const off of this.unsub) off();
    this.unsub = [];
    this.session = null;
  }

  // ───────────────────────────── Dessin des couches ─────────────────────────────

  #forEachDiagonal(x0, y0, x1, y1, fn) {
    for (let d = x0 + y0; d <= x1 - 1 + y1 - 1; d++) {
      for (let x = Math.max(x0, d - (y1 - 1)); x <= Math.min(x1 - 1, d - y0); x++) fn(x, d - x);
    }
  }

  #drawTerrainChunk(g, x0, y0, x1, y1) {
    const grid = this.session.state.grid;
    const snow = [0, 0.5, 0.85][this.snowLevel];
    const state = this.session.state;
    const all = fullyOwned(state);
    this.#forEachDiagonal(x0, y0, x1, y1, (x, y) => drawTerrainTile(g, grid, x, y, { gridLines: this.gridLines, snow, season: this.season, locked: !all && !isOwned(state, x, y) }));
  }

  #drawGroundChunk(g, x0, y0, x1, y1) {
    const state = this.session.state;
    const grid = state.grid;
    const cat = this.catalog;
    this.#forEachDiagonal(x0, y0, x1, y1, (x, y) => {
      const i = grid.idx(x, y);
      const alt = grid.surfaceAlt(i);
      if (grid.road[i]) {
        const road = cat.roadByCode(grid.road[i]);
        let conn = 0;
        const linked = (n) => grid.road[n] && Math.abs(grid.surfaceAlt(n) - alt) <= 1;
        if (y > 0 && linked(i - grid.width)) conn |= 1;
        if (x < grid.width - 1 && linked(i + 1)) conn |= 2;
        if (y < grid.height - 1 && linked(i + grid.width)) conn |= 4;
        if (x > 0 && linked(i - 1)) conn |= 8;
        // Accès régionaux : la chaussée file vers l'extérieur de la carte
        if (x === 0 && road.id === 'road_highway') conn |= 8;
        if (state.entries.includes(i)) {
          if (x === 0) conn |= 8;
          else if (x === grid.width - 1) conn |= 2;
          else if (y === 0) conn |= 1;
          else if (y === grid.height - 1) conn |= 4;
        }
        if (grid.bridge[i]) drawBridgeTile(g, x, y, alt, conn, road.visual);
        else {
          // Dénivelé vers chaque voisin relié (rampe dessinée côté case basse)
          const d = (n) => grid.surfaceAlt(n) - alt;
          const rise = [conn & 1 ? d(i - grid.width) : 0, conn & 2 ? d(i + 1) : 0, conn & 4 ? d(i + grid.width) : 0, conn & 8 && x > 0 ? d(i - 1) : 0];
          drawRoadTile(g, x, y, alt, conn, road.visual, { era: state.progression?.era ?? 1, rise: rise.some((r) => r > 0) ? rise : null });
        }
        if (grid.tram?.[i]) {
          // Rails de tramway (v0.8) : reliés aux cases voisines équipées
          const on = (n) => grid.tram[n] && Math.abs(grid.surfaceAlt(n) - alt) <= 1;
          let tc = 0;
          if (y > 0 && on(i - grid.width)) tc |= 1;
          if (x < grid.width - 1 && on(i + 1)) tc |= 2;
          if (y < grid.height - 1 && on(i + grid.width)) tc |= 4;
          if (x > 0 && on(i - 1)) tc |= 8;
          drawTramTracks(g, x, y, alt, tc);
        }
      }
      if (grid.rail[i]) {
        // Voie ferrée : reliée aux rails voisins d'au plus un niveau d'écart
        const ra = grid.surfaceAlt(i);
        const on = (n) => grid.rail[n] && Math.abs(grid.surfaceAlt(n) - ra) <= 1;
        let rc = 0;
        if (y > 0 && on(i - grid.width)) rc |= 1;
        if (x < grid.width - 1 && on(i + 1)) rc |= 2;
        if (y < grid.height - 1 && on(i + grid.width)) rc |= 4;
        if (x > 0 && on(i - 1)) rc |= 8;
        // Au bord de la carte, la voie file vers la région
        if (x === 0) rc |= 8;
        if (x === grid.width - 1) rc |= 2;
        if (y === 0) rc |= 1;
        if (y === grid.height - 1) rc |= 4;
        drawRailTile(g, x, y, ra, rc, { bridge: !!grid.bridge[i] && grid.terrain[i] === 1, crossing: !!grid.road[i] });
      } else if (grid.zone[i] && !grid.building[i] && !grid.road[i]) {
        const z = cat.zoneByCode.get(grid.zone[i]);
        drawZoneTile(g, x, y, alt, z.color, { reachable: grid.roadDist[i] <= ROAD_REACH });
      }
      if (grid.deliveryZone[i]) drawDeliveryZoneTile(g, x, y, alt);
    });
  }

  #redrawTrees(d) {
    const state = this.session.state;
    const grid = state.grid;
    if (d < 0 || d > grid.width + grid.height - 2) return;
    let g = this.treeGfx.get(d);
    if (!g) {
      g = new Graphics();
      g.zIndex = d * 10 + 6;
      this.treeGfx.set(d, g);
      this.layers.objects.addChild(g);
    }
    g.clear();
    const tint = foliageTint(this.season, [0, 0.5, 0.9][this.snowLevel]);
    for (let x = Math.max(0, d - (grid.height - 1)); x <= Math.min(grid.width - 1, d); x++) {
      const y = d - x;
      const i = grid.idx(x, y);
      if (grid.terrain[i] !== TERRAIN.FOREST || grid.building[i] || grid.road[i]) continue;
      // Pas d'arbre collé aux façades avant d'un grand bâtiment : l'ordre d'affichage par diagonale les ferait
      // passer derrière le bâtiment alors qu'ils sont devant (arbres « coupés » ou flottants)
      if (this.#besideLargeBuilding(state, x, y)) continue;
      // Parcelle zonée : quelques arbres seulement, la couleur de la zone reste lisible
      const trees = forestTrees(x, y, grid.altitude[i]);
      for (let k = 0; k < trees.length; k++) {
        if (grid.zone[i] && k % 2 === 1) continue;
        const t = trees[k];
        drawTree(g, t.x, t.y, t.s, tint);
      }
    }
  }

  #markTreesAround(b) {
    for (let d = b.x + b.y; d <= b.x + b.w + b.y + b.h; d++) this.dirtyTrees.add(d);
  }

  /** Case juste devant la façade gauche ou droite d'un bâtiment de plusieurs cases. */
  #besideLargeBuilding(state, x, y) {
    const grid = state.grid;
    for (const [nx, ny] of [[x - 1, y], [x, y - 1], [x - 1, y - 1]]) {
      if (nx < 0 || ny < 0) continue;
      const id = grid.building[grid.idx(nx, ny)];
      if (!id) continue;
      const b = state.buildings.get(id);
      if (b && (b.w > 1 || b.h > 1)) return true;
    }
    return false;
  }

  #redrawBuilding(id) {
    const state = this.session.state;
    const b = state.buildings.get(id);
    let g = this.buildingGfx.get(id);
    if (!b) {
      if (g) {
        g.destroy();
        this.buildingGfx.delete(id);
      }
      this.constructing.delete(id);
      this.drawnDef.delete(id);
      this.effects?.removeBuilding(id);
      return;
    }
    if (!g) {
      g = new Graphics();
      this.buildingGfx.set(id, g);
      this.layers.objects.addChild(g);
    }
    g.clear();
    const def = this.catalog.building(b.defId);
    const alt = state.grid.altitude[state.grid.idx(b.x, b.y)];
    const tick = state.time.tick;
    this.drawnDef.set(id, b.defId);
    g.zIndex = (b.x + b.w - 1 + b.y + b.h - 1) * 10 + 5;
    // Chantier simulé (bâtiment de zone neuf ou en travaux de montée de niveau), sinon chantier décoratif
    // des équipements posés par le joueur
    let end = 0;
    let start = b.builtTick;
    let target = def;
    if (b.ruins) {
      drawRuins(g, def, b, alt);
      this.constructing.delete(id);
      this.effects?.setCrane(b, def, alt, false, g.zIndex);
      const Lr = gridToWorld(b.x, b.y + b.h, alt);
      const Rr = gridToWorld(b.x + b.w, b.y, alt);
      const Br = gridToWorld(b.x + b.w, b.y + b.h, alt);
      const Tr = gridToWorld(b.x, b.y, alt);
      g.__bounds = { x0: Lr.x, x1: Rr.x, y0: Tr.y - 30, y1: Br.y };
      g.__depth = b.x + b.w - 1 + b.y + b.h - 1;
      return;
    }
    if (b.repairUntil > tick) {
      end = b.repairUntil;
      start = b.repairStart ?? tick;
    } else if (b.constructionUntil > tick) {
      end = b.constructionUntil;
      start = b.constructionStart ?? b.builtTick;
      if (b.upgradeTo) target = this.catalog.building(b.upgradeTo);
    } else if (def.kind !== 'growable') {
      end = this.effects?.constructionEnd(def, b, tick) ?? 0;
    }
    if (end) {
      const progress = Math.max(0, Math.min(1, (tick - start) / Math.max(1, end - start)));
      drawConstructionSite(g, target, b, alt, progress);
      this.constructing.set(id, { end, drawn: tick });
    } else {
      drawBuilding(g, def, b, alt);
      this.constructing.delete(id);
    }
    this.effects?.setCrane(b, target, alt, !!end, g.zIndex);
    this.effects?.drawLights(b, def, alt);
    const L = gridToWorld(b.x, b.y + b.h, alt);
    const R = gridToWorld(b.x + b.w, b.y, alt);
    const B = gridToWorld(b.x + b.w, b.y + b.h, alt);
    const T = gridToWorld(b.x, b.y, alt);
    g.__bounds = { x0: L.x, x1: R.x, y0: T.y - def.visual.height - 40, y1: B.y };
    g.__depth = b.x + b.w - 1 + b.y + b.h - 1;
  }

  #drawOverlay() {
    const g = this.layers.overlay;
    g.clear();
    const ov = this.overlayId ? OVERLAY_BY_ID.get(this.overlayId) : null;
    this.layers.objects.alpha = ov ? 0.28 : 1;
    if (!ov) return;
    const state = this.session.state;
    const grid = state.grid;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const i = grid.idx(x, y);
        const c = ov.color(state, i, this.catalog);
        if (c < 0) continue;
        const [T, R, B, L] = corners(x, y, grid.surfaceAlt(i));
        g.poly([T.x, T.y, R.x, R.y, B.x, B.y, L.x, L.y]).fill({ color: c, alpha: 0.78 });
      }
    }
  }

  /** Icônes d'alerte : bâtiments sans électricité, sans eau ou abandonnés. */
  #drawAlerts() {
    const g = this.layers.alerts;
    g.clear();
    const state = this.session.state;
    const blink = Math.floor(performance.now() / 600) % 2 === 0;
    for (const b of state.buildings.values()) {
      const def = this.catalog.building(b.defId);
      // Pas d'alerte pendant le chantier ni dans les jours qui suivent la livraison (raccordement en cours)
      const settling = b.constructionUntil > state.time.tick && !b.upgradeTo ? true : state.time.tick - (b.deliveredTick ?? b.builtTick) < 10;
      const needPower = !settling && (b.powerNeed ?? def.networks.power) > 0 && !b.powered;
      const needWater = !settling && (b.waterNeed ?? 0) > 0 && !b.watered;
      if (!needPower && !needWater && !b.abandoned) continue;
      const alt = state.grid.altitude[state.grid.idx(b.x, b.y)];
      const top = gridToWorld(b.x + b.w / 2, b.y + b.h / 2, alt);
      const y = top.y - def.visual.height - 16;
      if (needPower && blink) {
        g.circle(top.x, y, 7).fill({ color: 0x222222, alpha: 0.75 });
        g.poly([top.x + 1, y - 5, top.x - 3, y + 1, top.x, y + 1, top.x - 1, y + 5, top.x + 3, y - 1, top.x, y - 1]).fill(0xffd23f);
      } else if (needWater && blink) {
        g.circle(top.x, y, 7).fill({ color: 0x222222, alpha: 0.75 });
        g.poly([top.x, y - 5, top.x + 3.5, y + 1, top.x, y + 4.5, top.x - 3.5, y + 1]).fill(0x5cb7ff);
      } else if (b.abandoned) {
        g.circle(top.x, y, 5).fill({ color: 0x444444, alpha: 0.7 });
        g.rect(top.x - 3, y - 0.8, 6, 1.6).fill(0xdddddd);
      }
    }
  }

  // ───────────────────────────── Interaction ─────────────────────────────

  /** Position écran (pixels CSS relatifs au canevas) du centre d'une case. */
  tileToScreen(x, y) {
    const grid = this.session.state.grid;
    const w = gridToWorld(x + 0.5, y + 0.5, grid.surfaceAlt(grid.idx(x, y)));
    return { x: (w.x - this.camera.x) * this.camera.zoom + this.view.width / 2, y: (w.y - this.camera.y) * this.camera.zoom + this.view.height / 2 };
  }

  /**
   * Bâtiment dont la silhouette (volume dessiné) contient le point écran, le plus en avant d'abord.
   * Permet de cliquer sur une tour même si sa base est masquée. Désactivé en mode transparence.
   * @returns {number} identifiant, ou 0
   */
  buildingAtScreen(sx, sy) {
    if (!this.session || this.xray || this.overlayId) return 0;
    const state = this.session.state;
    const wx = (sx - this.view.width / 2) / this.camera.zoom + this.camera.x;
    const wy = (sy - this.view.height / 2) / this.camera.zoom + this.camera.y;
    let best = 0;
    let bestDepth = -1;
    for (const [id, g] of this.buildingGfx) {
      const bb = g.__bounds;
      if (!bb || wx < bb.x0 || wx > bb.x1 || wy < bb.y0 || wy > bb.y1 || g.__depth <= bestDepth) continue;
      const b = state.buildings.get(id);
      if (!b) continue;
      const def = this.catalog.building(b.defId);
      const alt = state.grid.altitude[state.grid.idx(b.x, b.y)];
      const H = def.visual.height;
      const T = gridToWorld(b.x, b.y, alt);
      const R = gridToWorld(b.x + b.w, b.y, alt);
      const B = gridToWorld(b.x + b.w, b.y + b.h, alt);
      const L = gridToWorld(b.x, b.y + b.h, alt);
      const poly = [T.x, T.y - H, R.x, R.y - H, R.x, R.y, B.x, B.y, L.x, L.y, L.x, L.y - H];
      if (pointInPolygon(wx, wy, poly)) {
        best = id;
        bestDepth = g.__depth;
      }
    }
    return best;
  }

  tileAtScreen(sx, sy) {
    if (!this.session) return null;
    return screenToTile(this.session.state.grid, sx, sy, this.camera, this.view);
  }

  setHover(tile) {
    const same = tile && this.hover && tile.x === this.hover.x && tile.y === this.hover.y;
    if (same || (!tile && !this.hover)) return;
    this.hover = tile;
    this.selectionDirty = true;
    if (this.xray) this.#applyXray();
  }

  /** Affiche les tracés des lignes de transport (outil de tracé, panneau des lignes), avec une ligne en évidence. */
  setShowRoutes(on, highlight = 0) {
    this.showRoutes = !!on;
    this.transitLines.highlight = highlight;
  }

  setPreview(preview) {
    this.preview = preview;
    this.selectionDirty = true;
  }

  setSelected(id) {
    this.selectedId = id || 0;
    this.selectionDirty = true;
  }

  setOverlay(id) {
    this.overlayId = id;
    this.overlayDirty = true;
  }

  setXray(on) {
    this.xray = on;
    if (!on) for (const g of this.buildingGfx.values()) g.alpha = 1;
    else this.#applyXray();
  }

  setGridLines(on) {
    this.gridLines = on;
    this.terrainLayer?.markAll();
  }

  setVehicles(on) {
    this.vehicles.enabled = on;
  }

  /**
   * Résolution de rendu (qualité graphique) : 'auto' suit l'écran (plafonné à 2), sinon facteur 0..1.
   */
  setRenderScale(scale) {
    if (!this.app) return;
    const base = Math.min(2, window.devicePixelRatio || 1);
    const res = scale === 'auto' || !scale ? base : Math.max(0.5, base * Number(scale));
    try {
      this.app.renderer.resize(this.app.screen.width, this.app.screen.height, res);
    } catch {
      /* certaines implémentations n'acceptent pas le changement à chaud */
    }
    this.camera.version++;
  }

  /** Bâtiments situés devant le point survolé et le masquant : rendus translucides. */
  #applyXray() {
    if (!this.session) return;
    const h = this.hover;
    if (!h) {
      for (const g of this.buildingGfx.values()) g.alpha = 1;
      return;
    }
    const grid = this.session.state.grid;
    const p = gridToWorld(h.x + 0.5, h.y + 0.5, grid.altitude[grid.idx(h.x, h.y)]);
    const depth = h.x + h.y;
    for (const g of this.buildingGfx.values()) {
      const b = g.__bounds;
      const occludes = g.__depth > depth && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
      g.alpha = occludes ? 0.25 : 1;
    }
  }

  // ───────────────────────────── Boucle d'affichage ─────────────────────────────

  /**
   * Met à jour les éléments modifiés et dessine une image.
   * @param {number} dtMs
   * @param {{paused:boolean}} opts
   */
  render(dtMs, { paused = false, speedIndex = 1 } = {}) {
    if (!this.app || !this.session) return;
    this.speedIndex = speedIndex;
    const t0 = performance.now();
    const state = this.session.state;

    this.terrainLayer.flush(8);
    this.groundLayer.flush(8);
    for (const d of this.dirtyTrees) this.#redrawTrees(d);
    this.dirtyTrees.clear();
    if (this.dirtyBuildings.size) {
      for (const id of this.dirtyBuildings) this.#redrawBuilding(id);
      this.dirtyBuildings.clear();
      if (this.xray) this.#applyXray();
    }
    if (this.overlayDirty) {
      this.#drawOverlay();
      this.overlayDirty = false;
    }
    this.alertTimer -= dtMs;
    if (this.alertTimer <= 0) {
      this.#drawAlerts();
      this.alertTimer = 300;
    }
    if (this.selectionDirty) {
      const selected = this.selectedId ? state.buildings.get(this.selectedId) : null;
      this.selection.draw(state, { hover: this.hover, preview: this.preview, selected, catalog: this.catalog });
      this.selectionDirty = false;
    }

    // Caméra et masquage hors champ
    const cam = this.camera;
    const w = this.layers.world;
    w.scale.set(cam.zoom);
    w.position.set(this.view.width / 2 - cam.x * cam.zoom, this.view.height / 2 - cam.y * cam.zoom);
    const rect = cam.viewRect(this.view, 80);
    if (cam.version !== this.lastCameraVersion) {
      this.terrainLayer.cull(rect);
      this.groundLayer.cull(rect);
      for (const g of this.buildingGfx.values()) {
        const b = g.__bounds;
        g.visible = !(b.x1 < rect.x0 || b.x0 > rect.x1 || b.y1 < rect.y0 || b.y0 > rect.y1);
      }
      this.lastCameraVersion = cam.version;
    }
    // Chantiers livrés : le bâtiment définitif remplace l'échafaudage
    if (this.constructing.size) {
      // Livraison, ou avancement visible de la structure tous les 3 jours
      for (const [id, c] of this.constructing) if (state.time.tick >= c.end || state.time.tick - c.drawn >= 3) this.dirtyBuildings.add(id);
    }
    this.vehicles.night = this.effects?.night ?? 0;
    this.vehicles.update(state, dtMs, rect, paused);
    this.trains.update(state, this.catalog, rect, dtMs, paused);
    this.airsea.update(state, this.catalog, rect, dtMs, paused);
    this.transitLines.showRoutes = this.showRoutes || this.overlayId === 'transit';
    this.transitLines.update(state, rect, dtMs, paused);
    this.effects?.update({ state, catalog: this.catalog, camera: cam, view: this.view, rect, dtMs, paused, speedIndex: this.speedIndex ?? 1, ticksPerSecond: SPEEDS[this.speedIndex ?? 1]?.ticksPerSecond ?? 0.5, buildingGfx: this.buildingGfx });
    this.app.renderer.render(this.app.stage);
    const frame = performance.now() - t0;
    this.stats.frameMs = this.stats.frameMs * 0.9 + frame * 0.1;
    this.stats.fps = this.stats.fps * 0.9 + (dtMs > 0 ? 1000 / dtMs : 0) * 0.1;
  }

  /** Centre la vue sur une case. */
  focus(x, y) {
    this.camera.centerOnTile(x, y);
  }

  destroy() {
    this.detach();
    this.app?.destroy(true, { children: true });
    this.app = null;
  }
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
