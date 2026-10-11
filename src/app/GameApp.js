import { EventBus } from './EventBus.js';
import { GameSession } from './GameSession.js';
import { GameLoop } from './GameLoop.js';
import { InputController } from './InputController.js';
import { ToolController } from './ToolController.js';
import { buildStarterTown, placeNear } from './scenarios.js';
import { SimulationClock } from '../simulation/SimulationClock.js';
import { Renderer } from '../rendering/Renderer.js';
import { SaveService } from '../persistence/SaveService.js';
import { SettingsService } from '../persistence/SettingsService.js';
import { HUD } from '../ui/HUD.js';
import { Toolbar } from '../ui/Toolbar.js';
import { InspectorPanel } from '../ui/InspectorPanel.js';
import { PanelHost } from '../ui/PanelHost.js';
import { FinancePanel } from '../ui/FinancePanel.js';
import { TechPanel } from '../ui/TechPanel.js';
import { CityPanel } from '../ui/CityPanel.js';
import { OverlayManager } from '../ui/OverlayManager.js';
import { Notifications } from '../ui/Notifications.js';
import { HelpPanel, SavesPanel, SettingsPanel, StartMenu } from '../ui/MenuPanels.js';
import { ObjectivesCard } from '../ui/ObjectivesCard.js';
import { DebugPanel } from '../ui/DebugPanel.js';
import { formatMoney } from '../util/money.js';
import { confirmDialog } from '../ui/Dialog.js';
import { FullscreenController } from './Fullscreen.js';
import { h, icon, setChildren } from '../ui/dom.js';
import { buildingSummary } from '../ui/BuildingSheet.js';

/**
 * Application : relie la session de jeu (simulation pure), le rendu, l'interface et la persistance.
 */
export class GameApp {
  /**
   * @param {{root: HTMLElement, catalog: import('../data/Catalog.js').Catalog}} p
   */
  constructor({ root, catalog }) {
    this.root = root;
    this.catalog = catalog;
    this.session = null;
    this.bus = null;
    this.clock = new SimulationClock();
    this.settings = new SettingsService();
    this.saves = new SaveService();
    this.renderer = new Renderer({ catalog });
    this.lastAutosave = performance.now();
    this.uiTimers = { hud: 0, inspector: 0, panel: 0, preview: 0 };
  }

  $(sel) {
    return this.root.querySelector(sel);
  }

  async init() {
    await this.renderer.init(this.$('#viewport'));
    this.notifications = new Notifications(this.$('#toasts'), { onLocate: (x, y) => this.focus(x, y) });
    this.hud = new HUD(this.$('#hud'), {
      onSpeed: (i) => this.setSpeed(i),
      onMenu: () => this.showMenu(),
      onUndo: () => this.undo(),
      onOpenPanel: (id) => this.togglePanel(id),
      onFullscreen: () => this.fullscreen.toggle()
    });
    this.toolbar = new Toolbar(this.$('#toolbar'), {
      catalog: this.catalog,
      onTool: (t) => this.tools.setTool(t),
      onPanel: (id) => this.togglePanel(id),
      getState: () => this.session?.state
    });
    this.inspector = new InspectorPanel(this.$('#inspector'), {
      onDemolish: (b) => this.demolishBuilding(b),
      onUpgrade: (b, upgradeId) => this.upgradeBuilding(b, upgradeId),
      onFocus: (x, y) => this.focus(x, y),
      onClose: () => this.select(null)
    });
    this.panelHost = new PanelHost(this.$('#panel-host'));
    this.overlays = new OverlayManager(this.$('#overlays'), { onChange: (id) => this.renderer.setOverlay(id) });
    const execute = (cmd) => this.execute(cmd);
    const notify = (level, message) => this.notifications.push({ level, message });
    this.fullscreen = new FullscreenController(this.root, {
      notify,
      onChange: ({ active }) => this.hud.setFullscreen(active)
    });
    this.panels = {
      finance: new FinancePanel({ execute, notify }),
      ai: new TechPanel({ execute, notify }),
      city: new CityPanel({ onFocus: (x, y) => this.focus(x, y), getRenderStats: () => this.renderer.stats }),
      saves: new SavesPanel({ saves: this.saves, settings: this.settings, onSave: (o) => this.save(o), onLoad: (id) => this.load(id), notify }),
      settings: new SettingsPanel({
        settings: this.settings,
        apply: () => this.applySettings(),
        onShowObjectives: () => this.objectives.show(),
        onDebug: () => this.togglePanel('debug')
      }),
      help: new HelpPanel({ onShowObjectives: () => this.objectives.show() }),
      debug: new DebugPanel({ getRenderer: () => this.renderer, getLoop: () => this.loop, settings: this.settings, apply: () => this.applySettings(), notify })
    };
    this.objectives = new ObjectivesCard(this.$('#objectives'), { notify });
    this.menu = new StartMenu(this.$('#menu'), {
      saves: this.saves,
      onNew: (o) => this.newGame(o),
      onContinue: (id) => this.load(id),
      onLoad: (id) => this.load(id),
      onClose: () => {}
    });

    const tooltip = this.$('#cursor-tip');
    this.tools = new ToolController({
      getSession: () => this.session,
      renderer: this.renderer,
      tooltip,
      onSelect: (t) => this.select(t),
      notify,
      needsConfirm: (cents) => this.settings.get('confirmDemolish') && cents >= 500000,
      confirm: (message) => confirmDialog(message, { confirmLabel: 'Démolir', danger: true }),
      onChange: (tool) => this.#updateToolChip(tool)
    });
    this.input = new InputController({
      canvas: this.renderer.canvas,
      renderer: this.renderer,
      tools: this.tools,
      settings: this.settings,
      isBlocked: () => !this.session || this.menu.visible || !!document.querySelector('.dialog-backdrop'),
      shortcuts: this.#shortcuts()
    });

    // Toucher la carte referme les menus ouverts (utile au doigt, où il n'y a pas de survol).
    this.renderer.canvas.addEventListener('pointerdown', () => {
      if (this.toolbar.openCat) this.toolbar.closeFlyout();
      if (this.overlays.expanded) this.overlays.toggleExpanded(false);
    });

    this.loop = new GameLoop({
      clock: this.clock,
      step: () => this.session && this.session.sim.step(this.session.state),
      frame: (dt) => this.#frame(dt)
    });
    this.loop.onError = (err) => this.#fatal(err);
    this.applySettings();
    this.loop.start();
    window.addEventListener('beforeunload', () => {
      if (this.session && this.settings.get('autosaveMinutes') > 0) this.saves.autosave(this.session.state).catch(() => {});
    });
    await this.showMenu();
  }

  #shortcuts() {
    const sel = (id) => () => this.toolbar.selectById(id);
    return {
      Escape: () => {
        if (this.tools.cancel()) return;
        if (this.toolbar.openCat) return this.toolbar.closeFlyout();
        if (this.panelHost.openId) return this.panelHost.close();
        if (this.inspector.open) return this.select(null);
        sel('select')();
      },
      Delete: sel('demolish'),
      Backspace: sel('demolish'),
      r: () => this.tools.rotate(),
      ' ': () => this.setSpeed(this.clock.paused ? this.prevSpeed ?? 1 : 0),
      1: () => this.setSpeed(1),
      2: () => this.setSpeed(2),
      3: () => this.setSpeed(3),
      'Ctrl+z': () => this.undo(),
      'Ctrl+s': () => this.save({ id: 'quick', name: `${this.session?.state.meta.name} (rapide)` }),
      b: () => this.togglePanel('finance'),
      c: () => this.togglePanel('city'),
      i: () => this.togglePanel('ai'),
      h: () => this.togglePanel('help'),
      F1: () => this.togglePanel('help'),
      l: () => this.overlays.cycle(),
      x: () => {
        this.xray = !this.xray;
        this.renderer.setXray(this.xray);
        this.notifications.push({ level: 'info', message: this.xray ? 'Transparence des bâtiments activée' : 'Transparence désactivée' });
      },
      m: () => this.showMenu(),
      f: () => this.fullscreen.toggle(),
      F3: () => this.togglePanel('debug')
    };
  }

  /** Bandeau de l'outil actif : nom, bouton Pivoter (si possible) et bouton Terminer — utile surtout au doigt. */
  #updateToolChip(tool) {
    const chip = this.$('#tool-chip');
    if (!tool || tool.kind === 'select') {
      chip.hidden = true;
      return;
    }
    const hint = {
      road: 'Glissez pour tracer',
      zone: 'Glissez pour délimiter',
      demolish: 'Glissez pour sélectionner',
      deliveryZone: 'Glissez pour délimiter',
      building: 'Choisissez l\'emplacement'
    }[tool.kind];
    // Bâtiment : rappel des effets principaux pendant la pose
    const summary = tool.kind === 'building' && this.session ? buildingSummary(this.session.catalog.building(tool.defId), this.session.catalog) : null;
    setChildren(chip,
      h('span.chip-label', h('strong', tool.label ?? ''), summary ? h('small.chip-summary', summary) : hint ? h('small', hint) : null),
      this.tools.canRotate ? h('button.chip-btn', { 'aria-label': 'Pivoter', title: 'Pivoter (R)', on: { click: () => this.tools.rotate() } }, icon('rotate', 16), h('span', 'Pivoter')) : null,
      h('button.chip-btn', { 'aria-label': 'Terminer', title: 'Revenir à la sélection (Échap)', on: { click: () => this.toolbar.selectById('select') } }, icon('close', 16))
    );
    chip.hidden = false;
  }

  applySettings() {
    this.renderer.setVehicles(this.settings.get('showVehicles'));
    this.renderer.setGridLines(this.settings.get('showGridLines'));
    this.renderer.setRenderScale(this.settings.get('renderScale'));
    document.documentElement.style.setProperty('--ui-scale', String(this.settings.get('uiScale') || 1));
    this.$('#fps-meter').hidden = !this.settings.get('showFps');
  }

  // ───────────────────────────── Parties ─────────────────────────────

  async showMenu() {
    this.prevSpeedBeforeMenu = this.clock.speedIndex;
    if (this.session) this.clock.setSpeed(0);
    await this.menu.show({ canResume: !!this.session });
    this.menu.onClose = () => this.clock.setSpeed(this.prevSpeedBeforeMenu || 1);
  }

  #busy(text) {
    const el = this.$('#busy');
    el.textContent = text ?? '';
    el.hidden = !text;
  }

  async newGame({ name, seed, size, mode }) {
    this.#busy('Génération du territoire…');
    await new Promise((r) => setTimeout(r, 30));
    const bus = new EventBus();
    const session = GameSession.newGame({ catalog: this.catalog, seed, width: size, height: size, name, bus });
    if (mode === 'town') {
      this.#busy('Construction du bourg selon les règles du jeu…');
      await new Promise((r) => setTimeout(r, 30));
      const town = buildStarterTown(session, { size: size >= 96 ? 'large' : 'small' });
      session.run(120);
      for (const id of ['police', 'fire', 'school', 'clinic']) placeNear(session, id, town.xEnd - 6, town.row - 2);
      session.run(240);
      session.history.clear();
    }
    this.#busy(null);
    this.startSession(session);
    if (mode !== 'town') {
      this.notifications.push({ level: 'info', message: 'Commencez par tracer une rue depuis l\'accès autoroutier, à l\'ouest. Aide : touche H.' });
    }
  }

  startSession(session) {
    this.session = session;
    this.bus = session.bus;
    this.renderer.attach(session);
    this.select(null);
    this.panelHost.close();
    this.toolbar.select({ id: 'select', kind: 'select', label: 'Sélection' });
    this.bus.on('notify', (n) => this.notifications.push(n));
    this.bus.on('sim:month', () => this.panelHost.refresh());
    this.objectives.attach(session);
    this.setSpeed(1);
    this.lastAutosave = performance.now();
    document.title = `${session.state.meta.name} — URBIS 2030`;
  }

  async save({ id, name } = {}) {
    if (!this.session) return;
    try {
      const r = await this.saves.save(this.session.state, { id, name: name ?? this.session.state.meta.name });
      this.settings.set('lastSaveId', r.id);
      this.notifications.push({ level: 'success', message: `Partie sauvegardée : ${r.name}` });
    } catch (err) {
      this.notifications.push({ level: 'danger', message: `Échec de la sauvegarde : ${err.message}` });
    }
  }

  async load(id) {
    this.#busy('Chargement de la partie…');
    try {
      const state = await this.saves.load(id);
      const session = new GameSession({ catalog: this.catalog, state, bus: new EventBus() });
      this.startSession(session);
      this.menu.hide();
      this.notifications.push({ level: 'success', message: `Partie chargée : ${state.meta.name}` });
    } catch (err) {
      this.notifications.push({ level: 'danger', message: `Chargement impossible : ${err.message}` });
      if (!this.session) await this.showMenu();
    } finally {
      this.#busy(null);
    }
  }

  async #autosave() {
    if (!this.session) return;
    try {
      await this.saves.autosave(this.session.state);
      this.notifications.push({ level: 'info', message: 'Sauvegarde automatique effectuée', key: 'autosave' });
    } catch (err) {
      this.notifications.push({ level: 'danger', message: `Sauvegarde automatique impossible : ${err.message}` });
    }
  }

  // ───────────────────────────── Actions ─────────────────────────────

  execute(cmd) {
    if (!this.session) return { ok: false, reasons: ['Aucune partie'] };
    const r = this.session.execute(cmd);
    this.tools.tickRefresh();
    if (r?.ok && this.inspector.open) this.inspector.update(this.session, { force: true });
    return r;
  }

  undo() {
    if (!this.session) return;
    const r = this.session.execute({ type: 'undo' });
    this.notifications.push({ level: r.ok ? 'info' : 'warning', message: r.ok ? `Annulé : ${r.label}` : r.reason });
  }

  async demolishBuilding(b) {
    const cost = this.session.construction.demolitionCost(b);
    if (this.tools.needsConfirm(cost) && !(await this.tools.confirm(`Démolir ce bâtiment pour ${formatMoney(cost)} ?`))) return;
    const r = this.execute({ type: 'demolish', rect: { x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 } });
    if (!r.ok) this.notifications.push({ level: 'warning', message: r.messages?.join(' · ') });
    else this.select(null);
  }

  upgradeBuilding(b, upgradeId) {
    const r = this.execute({ type: 'upgrade', buildingId: b.id, upgradeId });
    if (r.ok) this.notifications.push({ level: 'success', message: `${r.upgrade.name} installé(e) : ${formatMoney(r.cost)}` });
    else this.notifications.push({ level: 'warning', message: r.messages?.join(' · ') });
    this.inspector.update(this.session, { force: true });
  }

  select(target) {
    this.inspector.show(target);
    this.renderer.setSelected(target?.buildingId ?? 0);
    if (target) this.inspector.update(this.session, { force: true });
  }

  focus(x, y) {
    this.renderer.focus(x, y);
  }

  setSpeed(i) {
    if (i === 0 && !this.clock.paused) this.prevSpeed = this.clock.speedIndex;
    this.clock.setSpeed(i);
    this.root.classList.toggle('paused', this.clock.paused);
  }

  togglePanel(id) {
    if (id === 'layers') {
      this.overlays.toggleExpanded();
      return;
    }
    const panel = this.panels[id];
    if (!panel) return;
    this.panelHost.toggle(panel, this.session);
  }

  // ───────────────────────────── Image ─────────────────────────────

  #frame(dt) {
    this.input.update(dt);
    if (!this.session) {
      return;
    }
    this.renderer.render(dt, { paused: this.clock.paused });
    const now = performance.now();
    if (now - this.uiTimers.hud > 250) {
      this.uiTimers.hud = now;
      this.hud.update(this.session.state, { speedIndex: this.clock.speedIndex, canUndo: this.session.construction.canUndo(this.session.state).ok });
    }
    // En pause, l'inspecteur n'est redessiné qu'après une action du joueur
    if (this.inspector.open && !this.clock.paused && now - this.uiTimers.inspector > 600) {
      this.uiTimers.inspector = now;
      this.inspector.update(this.session);
    }
    // En pause, les chiffres ne changent pas : inutile de redessiner les fenêtres de gestion.
    if (this.panelHost.openId && !this.clock.paused && now - this.uiTimers.panel > 2000) {
      this.uiTimers.panel = now;
      this.panelHost.refresh();
    }
    if (now - (this.uiTimers.objectives ?? 0) > 1000) {
      this.uiTimers.objectives = now;
      this.objectives.update();
    }
    if (this.settings.get('showFps') && now - (this.uiTimers.fps ?? 0) > 500) {
      this.uiTimers.fps = now;
      const t = this.session.sim.timings;
      const tick = Object.values(t).reduce((a, v) => a + v, 0);
      this.$('#fps-meter').textContent = `${Math.round(this.renderer.stats.fps)} i/s · image ${this.renderer.stats.frameMs.toFixed(1)} ms · simulation ${tick.toFixed(1)} ms`;
    }
    if (now - this.uiTimers.preview > 700) {
      this.uiTimers.preview = now;
      this.tools.tickRefresh();
    }
    const every = this.settings.get('autosaveMinutes');
    if (every > 0 && now - this.lastAutosave > every * 60000) {
      this.lastAutosave = now;
      this.#autosave();
    }
  }

  #fatal(err) {
    console.error(err);
    const el = this.$('#busy');
    el.hidden = false;
    el.textContent = `Erreur interne de la simulation : ${err.message}. Vos sauvegardes ne sont pas affectées ; rechargez la page.`;
  }
}
