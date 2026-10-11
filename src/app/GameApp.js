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
import { HelpPanel, SavesPanel, SettingsPanel, SoundPanel, StartMenu } from '../ui/MenuPanels.js';
import { ObjectivesCard } from '../ui/ObjectivesCard.js';
import { DebugPanel } from '../ui/DebugPanel.js';
import { formatMoney } from '../util/money.js';
import { confirmDialog } from '../ui/Dialog.js';
import { FullscreenController } from './Fullscreen.js';
import { h, icon, setChildren } from '../ui/dom.js';
import { buildingSummary } from '../ui/BuildingSheet.js';
import { LocalSimHost, WorkerSimHost } from './SimHost.js';
import { setupChallenge, CHALLENGE_BY_ID } from './challenges.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { CrisisPanel } from '../ui/CrisisPanel.js';
import { scenarioEndDialog } from '../ui/ScenarioDialogs.js';
import { InstallPrompt } from './InstallPrompt.js';

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
    this.uiTimers = { hud: 0, inspector: 0, panel: 0, preview: 0, audio: 0 };
    /** Hôte de la simulation (fil principal ou Web Worker). */
    this.host = null;
    this.audio = new AudioEngine(this.settings);
    this.install = new InstallPrompt();
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
      onFullscreen: () => this.fullscreen.toggle(),
      onMute: () => this.togglePanel('sound'),
      onWeather: () => this.openPanel('city', 'risks')
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
      city: new CityPanel({ onFocus: (x, y) => this.focus(x, y), getRenderStats: () => this.renderer.stats, getHostStats: () => this.host?.stats, execute, notify }),
      saves: new SavesPanel({ saves: this.saves, settings: this.settings, onSave: (o) => this.save(o), onLoad: (id) => this.load(id), notify }),
      settings: new SettingsPanel({
        settings: this.settings,
        apply: () => this.applySettings(),
        execute,
        getSession: () => this.session,
        audio: this.audio,
        onSound: () => this.openPanel('sound'),
        onShowObjectives: () => this.objectives.show(),
        onDebug: () => this.togglePanel('debug')
      }),
      sound: new SoundPanel({ settings: this.settings, apply: () => this.applySettings(), audio: this.audio }),
      help: new HelpPanel({ onShowObjectives: () => this.objectives.show() }),
      debug: new DebugPanel({ getRenderer: () => this.renderer, getLoop: () => this.loop, settings: this.settings, apply: () => this.applySettings(), notify })
    };
    this.objectives = new ObjectivesCard(this.$('#objectives'), { notify });
    this.crisisPanel = new CrisisPanel(this.$('#crisis'), {
      execute,
      notify,
      onFocus: (x, y) => this.focus(x, y),
      onDecided: () => this.#resumeAfterCrisis(),
      play: (n) => this.audio.play(n)
    });
    this.menu = new StartMenu(this.$('#menu'), {
      saves: this.saves,
      install: this.install,
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
      step: () => this.host?.tick(),
      frame: (dt) => {
        this.host?.endFrame();
        this.#frame(dt);
      }
    });
    this.loop.onError = (err) => this.#fatal(err);
    this.applySettings();
    this.loop.start();
    window.addEventListener('beforeunload', () => {
      if (this.session && this.settings.get('autosaveMinutes') > 0) this.saves.autosave(this.session.state).catch(() => {});
    });
    // Son : déverrouillé au premier geste (exigence des navigateurs), clics des boutons
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('button, .btn, [role="tab"], select')) this.audio.play('click');
    }, { capture: true });
    this.renderer.effects.onThunder = () => this.audio.play('thunder');
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
      n: () => this.toggleMute(),
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
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer.setEffects({
      dayNight: this.settings.get('dayNight') !== false,
      weather: this.settings.get('weatherFx') !== false,
      effects: this.settings.get('effects') !== false,
      reducedMotion: reduced
    });
    this.audio.applyVolumes();
    this.hud?.setMuted(!!this.settings.get('muted'));
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

  async newGame({ name, seed, size, mode, disasters = 'normal', scenarioId }) {
    this.#busy('Génération du territoire…');
    await new Promise((r) => setTimeout(r, 30));
    const bus = new EventBus();
    const challenge = mode === 'scenario' ? CHALLENGE_BY_ID.get(scenarioId) : null;
    if (challenge) {
      seed = challenge.seed ?? seed;
      size = challenge.size;
      name = challenge.name;
    }
    const session = GameSession.newGame({ catalog: this.catalog, seed, width: size, height: size, name, bus });
    session.state.options.disasters = disasters;
    if (challenge) {
      this.#busy(`Préparation du scénario « ${challenge.name} »…`);
      await new Promise((r) => setTimeout(r, 30));
      setupChallenge(session, challenge.id);
    } else if (mode === 'town') {
      this.#busy('Construction du bourg selon les règles du jeu…');
      await new Promise((r) => setTimeout(r, 30));
      const town = buildStarterTown(session, { size: size >= 96 ? 'large' : 'small' });
      session.run(120);
      for (const id of ['police', 'fire', 'school', 'clinic']) placeNear(session, id, town.xEnd - 6, town.row - 2);
      session.run(240);
      session.history.clear();
    }
    // Pas de catastrophe aléatoire dans les premiers mois d'une partie (bourg existant ou scénario)
    session.state.crises.graceUntil = session.state.time.tick + (challenge?.risks ? 75 : mode === 'empty' ? 360 : 240);
    await this.startSession(session);
    this.#busy(null);
    if (challenge) {
      this.notifications.push({ level: 'info', message: `Scénario « ${challenge.name} » : ${challenge.years} ans pour atteindre les objectifs (carte en haut à gauche).` });
    } else if (mode !== 'town') {
      this.notifications.push({ level: 'info', message: 'Commencez par tracer une rue depuis l\'accès autoroutier, à l\'ouest. Aide : touche H.' });
    }
  }

  /** Démarre l'hôte de simulation : Web Worker si possible (et activé), sinon fil principal. */
  async #createHost(session) {
    this.host?.destroy();
    this.host = null;
    const wanted = this.settings.get('simWorker') !== false && typeof Worker !== 'undefined';
    if (wanted) {
      try {
        const host = new WorkerSimHost({
          session,
          createWorker: () => new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module', name: 'urbis-simulation' }),
          onError: (err) => this.#fatal(err)
        });
        return await host.start();
      } catch (err) {
        console.warn('Simulation dans le fil principal :', err);
        this.workerFailed = err.message;
      }
    }
    return new LocalSimHost(session);
  }

  async startSession(session) {
    this.#busy('Démarrage de la simulation…');
    this.session = session;
    this.bus = session.bus;
    this.host = await this.#createHost(session);
    this.renderer.attach(session);
    this.select(null);
    this.panelHost.close();
    this.toolbar.select({ id: 'select', kind: 'select', label: 'Sélection' });
    this.bus.on('notify', (n) => {
      // Les crises ont leur propre carte (avec « Voir ») : pas de notification en double
      if (n.kind === 'crisis') return;
      this.notifications.push(n);
      if (n.kind !== 'crisis') this.audio.play(n.level === 'danger' ? 'danger' : n.level === 'warning' ? 'warning' : n.level === 'success' ? 'success' : 'info');
    });
    this.bus.on('sim:month', () => this.panelHost.refresh());
    this.bus.on('command:done', ({ cmd }) => {
      const sfx = { road: 'road', building: 'build', zone: 'zone', deliveryZone: 'zone', demolish: 'demolish', upgrade: 'money', loan: 'money', research: 'tech', undo: 'undo', crisisResponse: 'money' }[cmd.type];
      if (sfx) this.audio.play(sfx);
    });
    this.bus.on('era:changed', () => this.audio.play('fanfare'));
    this.bus.on('crisis:started', ({ crisis }) => {
      this.audio.play(crisis.kind === 'fire' || crisis.kind === 'flood' ? 'siren' : 'danger');
      this.crisisPanel.update(this.session, { force: true });
      if (this.settings.get('pauseOnCrisis') !== false && !crisis.manual && !this.clock.paused) {
        this.speedBeforeCrisis = Math.min(1, this.clock.speedIndex);
        this.setSpeed(0);
      } else if (this.clock.speedIndex > 1) {
        // Le temps ralentit pendant un événement
        this.setSpeed(1);
      }
    });
    this.bus.on('crisis:ended', () => this.crisisPanel.update(this.session, { force: true }));
    this.bus.on('scenario:ended', ({ scenario }) => {
      this.audio.play(scenario.status === 'won' ? 'fanfare' : 'fail');
      this.setSpeed(0);
      scenarioEndDialog(scenario, {
        onContinue: () => this.setSpeed(1),
        onMenu: () => this.showMenu()
      });
      this.objectives.update(true);
    });
    this.objectives.attach(session);
    this.crisisPanel.attach(session);
    this.setSpeed(1);
    this.lastAutosave = performance.now();
    document.title = `${session.state.meta.name} — URBIS 2030`;
    this.#busy(null);
  }

  #resumeAfterCrisis() {
    if (this.speedBeforeCrisis && this.clock.paused) this.setSpeed(this.speedBeforeCrisis);
    this.speedBeforeCrisis = 0;
  }

  toggleMute() {
    const muted = !this.settings.get('muted');
    this.settings.set('muted', muted);
    this.audio.unlock();
    this.audio.applyVolumes();
    this.hud.setMuted(muted);
    this.notifications.push({ level: 'info', message: muted ? 'Son coupé (N pour le rétablir)' : 'Son activé', key: 'mute' });
  }

  openPanel(id, tab) {
    const panel = this.panels[id];
    if (panel && this.session) this.panelHost.open(panel, this.session, tab);
  }

  async save({ id, name } = {}) {
    if (!this.session) return;
    try {
      await this.host?.flush();
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
      await this.startSession(session);
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
      await this.host?.flush();
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
    // La carte des crises occupe le haut de l'écran : la cible est montrée un peu plus bas
    const crisis = this.$('#crisis');
    if (crisis && !crisis.hidden && window.innerWidth > 760) {
      this.renderer.camera.y -= 110 / this.renderer.camera.zoom;
      this.renderer.camera.version++;
    }
  }

  /** Une crise est-elle en cours ? (le temps est alors ralenti à la vitesse normale) */
  get crisisActive() {
    return (this.session?.state.crises?.active ?? []).length > 0;
  }

  setSpeed(i) {
    if (i > 1 && this.crisisActive) {
      i = 1;
      this.notifications?.push({ level: 'info', message: 'Crise en cours : le temps reste à vitesse normale jusqu\'à la fin de l\'événement', key: 'crisis-speed' });
    }
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
    this.renderer.render(dt, { paused: this.clock.paused, speedIndex: this.clock.speedIndex });
    const now = performance.now();
    if (now - this.uiTimers.audio > 300) {
      this.uiTimers.audio = now;
      this.#updateAudio();
    }
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
      this.crisisPanel.update(this.session);
    }
    if (this.settings.get('showFps') && now - (this.uiTimers.fps ?? 0) > 500) {
      this.uiTimers.fps = now;
      const t = this.session.sim.timings;
      const tick = Object.values(t).reduce((a, v) => a + v, 0);
      const hs = this.host?.stats;
      const where = hs?.kind === 'worker' ? ` (worker, synchro ${hs.applyMs.toFixed(1)} ms)` : '';
      this.$('#fps-meter').textContent = `${Math.round(this.renderer.stats.fps)} i/s · image ${this.renderer.stats.frameMs.toFixed(1)} ms · simulation ${tick.toFixed(1)} ms${where}`;
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

  /** Ambiance sonore : densité et circulation de la zone visible, zoom, météo, nuit, ère, crises. */
  #updateAudio() {
    const s = this.session?.state;
    if (!s) {
      this.audio.update({ inMenu: true });
      return;
    }
    const g = s.grid;
    const cam = this.renderer.camera;
    const c = this.renderer.tileAtScreen(this.renderer.view.width / 2, this.renderer.view.height / 2);
    let density = 0;
    let traffic = 0;
    let green = 0;
    if (c) {
      let n = 0;
      for (let dy = -6; dy <= 6; dy += 2) {
        for (let dx = -6; dx <= 6; dx += 2) {
          const x = c.x + dx;
          const y = c.y + dy;
          if (!g.inBounds(x, y)) continue;
          const i = g.idx(x, y);
          density += Math.min(1, (g.density[i] ?? 0) / 40) + (g.building[i] ? 0.3 : 0);
          traffic += g.road[i] ? Math.min(1, g.congestion[i] * 1.5 + (g.traffic[i] > 5 ? 0.2 : 0)) : 0;
          green += Math.min(1, (g.green[i] ?? 0) / 30);
          n++;
        }
      }
      if (n) {
        density = Math.min(1, density / n);
        traffic = Math.min(1, (traffic / n) * 3);
        green = green / n;
      }
    }
    const month = Math.floor(s.time.tick / 30) % 12;
    this.audio.update({
      density,
      traffic,
      green,
      zoom: cam.zoom,
      weather: s.weather?.kind ?? 'clear',
      intensity: s.weather?.intensity ?? 0,
      night: this.renderer.effects?.night ?? 0,
      season: month === 11 || month <= 1 ? 'winter' : month <= 4 ? 'spring' : month <= 7 ? 'summer' : 'autumn',
      paused: this.clock.paused,
      inMenu: this.menu.visible
    });
    this.audio.setMusic({ era: s.progression?.era ?? 1, crisis: (s.crises?.active ?? []).some((x) => x.kind !== 'strike') });
  }

  #fatal(err) {
    console.error(err);
    const el = this.$('#busy');
    el.hidden = false;
    el.textContent = `Erreur interne de la simulation : ${err.message}. Vos sauvegardes ne sont pas affectées ; rechargez la page.`;
  }
}
