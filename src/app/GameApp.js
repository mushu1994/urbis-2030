import { EventBus } from './EventBus.js';
import { GameSession } from './GameSession.js';
import { GameLoop } from './GameLoop.js';
import { InputController } from './InputController.js';
import { ToolController } from './ToolController.js';
import { buildStarterTown, placeNear, ensureStartingCash } from './scenarios.js';
import { SimulationClock } from '../simulation/SimulationClock.js';
import { Renderer } from '../rendering/Renderer.js';
import { SaveService, serializeState, deserializeState } from '../persistence/SaveService.js';
import { expandSave } from '../persistence/WorldExpansion.js';
import { TerritoryPanel } from '../ui/TerritoryPanel.js';
import { LinesPanel } from '../ui/LinesPanel.js';
import { TrafficPanel } from '../ui/TrafficPanel.js';
import { GuidePanel } from '../ui/GuidePanel.js';
import { SettingsService } from '../persistence/SettingsService.js';
import { HUD } from '../ui/HUD.js';
import { Toolbar } from '../ui/Toolbar.js';
import { InspectorPanel } from '../ui/InspectorPanel.js';
import { PanelHost } from '../ui/PanelHost.js';
import { FinancePanel } from '../ui/FinancePanel.js';
import { TechPanel } from '../ui/TechPanel.js';
import { CityPanel } from '../ui/CityPanel.js';
import { OverlayManager } from '../ui/OverlayManager.js';
import { PoliticsPanel, electionDialog, secondRoundDialog } from '../ui/PoliticsPanel.js';
import { defaultPolitics } from '../simulation/PoliticsSystem.js';
import { applyDifficulty, MILESTONES } from '../simulation/Milestones.js';
import { DemandPanel } from '../ui/DemandPanel.js';
import { Notifications } from '../ui/Notifications.js';
import { NotificationHistory } from '../ui/NotificationHistory.js';
import { GoogleDriveSaves } from '../cloud/GoogleDrive.js';
import { isNative, setupNative } from '../native/NativeApp.js';
import { CloudSync } from '../cloud/CloudSync.js';
import { shareDialog, receivedGameDialog, cloudSection } from '../ui/CloudPanel.js';
import { formatDate } from '../simulation/config.js';
import { HelpPanel, SavesPanel, SettingsPanel, SoundPanel, StartMenu } from '../ui/MenuPanels.js';
import { ObjectivesCard } from '../ui/ObjectivesCard.js';
import { DebugPanel } from '../ui/DebugPanel.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { confirmDialog, contentDialog } from '../ui/Dialog.js';
import { FullscreenController } from './Fullscreen.js';
import { h, icon, setChildren } from '../ui/dom.js';
import { gridToWorld, setView } from '../rendering/IsometricProjection.js';
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
    // v1.6 : copie des parties sur Google Drive et partage (la notification n'existe qu'après init)
    // Application Android : la connexion Google par fenêtre n'est pas permise dans une WebView (Google la bloque)
    this.cloud = new GoogleDriveSaves({ settings: this.settings, ...(isNative ? { clientId: '', apiKey: '' } : {}) });
    this.cloud.nativeApp = isNative;
    this.cloudSync = new CloudSync({ cloud: this.cloud, saves: this.saves, settings: this.settings, notify: (n) => this.notifications?.push(n) });
    /** Vue isométrique 2D (PixiJS) et vue 3D (Three.js, chargée à la demande) : une seule est active. */
    this.renderer2d = new Renderer({ catalog });
    this.renderer3d = null;
    this.use3d = false;
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

  /** Moteur d'affichage actif (2D ou 3D). */
  get renderer() {
    return this.use3d && this.renderer3d ? this.renderer3d : this.renderer2d;
  }

  async init() {
    await this.renderer2d.init(this.$('#viewport'));
    // Les outils et les entrées parlent au moteur actif, quel qu'il soit (bascule 2D/3D à chaud)
    const app = this;
    this.view = new Proxy({}, {
      get(_, k) {
        const r = app.renderer;
        const v = r[k];
        return typeof v === 'function' ? v.bind(r) : v;
      }
    });
    this.notifications = new Notifications(this.$('#toasts'), {
      onLocate: (x, y) => this.focus(x, y),
      onPanel: (id, tab) => this.openPanel(id, tab),
      // v1.6 : date de jeu dans le déroulé, badge de la cloche
      getDate: () => (this.session ? formatDate(this.session.state.time.tick) : ''),
      onChange: () => this.#notifBadge()
    });
    this.hud = new HUD(this.$('#hud'), {
      onSpeed: (i) => this.setSpeed(i),
      onMenu: () => this.showMenu(),
      onUndo: () => this.undo(),
      onOpenPanel: (id) => this.togglePanel(id),
      onLoan: () => this.openPanel('finance', 'loans'),
      onFullscreen: () => this.fullscreen.toggle(),
      onMute: () => this.togglePanel('sound'),
      onAlert: (kind) => this.locateAlert(kind),
      onDemand: (k) => (this.panelHost.openId === 'demand' && this.panelHost.tab === k ? this.panelHost.close() : this.openPanel('demand', k)),
      onWeather: () => this.openPanel('city', 'risks'),
      onHistory: () => this.notifHistory?.toggle()
    });
    // v1.6 : déroulé des notifications
    this.notifHistory = new NotificationHistory(this.$('#stage'), this.notifications, { onToggle: () => this.#notifBadge() });
    // Navigation (v0.9) : faire tourner la carte d'un quart de tour, boussole, vue de dessus
    const needle = h('span.nav-needle', { 'aria-hidden': 'true' }, h('i'), h('b', 'N'));
    const compass = h('button.nav-btn.nav-compass', { type: 'button', 'aria-label': 'Boussole : revenir à l\'orientation d\'origine', on: { click: () => this.resetNorth() } }, needle);
    const view = h('button.nav-btn.nav-view', { type: 'button', 'aria-pressed': 'false', on: { click: () => this.toggleTopView() } });
    // v1.5 : bascule entre la vue 3D et la vue isométrique 2D
    const dim = h('button.nav-btn.nav-3d', { type: 'button', 'aria-pressed': 'false', on: { click: () => this.setView3d(!this.use3d) } });
    this.nav = {
      needle,
      compass,
      view,
      dim,
      root: h('div#nav-widget', { role: 'group', 'aria-label': 'Navigation de la carte' },
        h('button.nav-btn', { type: 'button', title: 'Tourner la carte vers la gauche (,)', 'aria-label': 'Tourner la carte vers la gauche', on: { click: () => this.rotateView(-1) } }, icon('rotl', 18)),
        compass,
        h('button.nav-btn', { type: 'button', title: 'Tourner la carte vers la droite (;)', 'aria-label': 'Tourner la carte vers la droite', on: { click: () => this.rotateView(1) } }, icon('rotr', 18)),
        view,
        dim)
    };
    this.$('#stage').append(this.nav.root);
    this.toolbar = new Toolbar(this.$('#toolbar'), {
      catalog: this.catalog,
      onTool: (t) => this.tools.setTool(t),
      onPanel: (id) => this.togglePanel(id),
      getState: () => this.session?.state
    });
    this.inspector = new InspectorPanel(this.$('#inspector'), {
      onDemolish: (b) => this.demolishBuilding(b),
      onUpgrade: (b, upgradeId) => this.upgradeBuilding(b, upgradeId),
      onRepair: (b) => {
        const r = this.execute({ type: 'repair', buildingId: b.id });
        if (!r?.ok) this.notifications.push({ level: 'warning', message: r?.reason ?? 'Reconstruction impossible' });
        else this.audio.play('build');
        this.inspector.update(this.session, { force: true });
      },
      onFocus: (x, y) => this.focus(x, y),
      // v1.2 : organiser un événement depuis le lieu (Mairie → Événements, lieu présélectionné)
      onEvent: (b) => {
        this.panels.politics.venue = b.id;
        this.openPanel('politics', 'events');
      },
      onClose: () => this.select(null)
    });
    this.panelHost = new PanelHost(this.$('#panel-host'));
    this.overlays = new OverlayManager(this.$('#overlays'), { onChange: (id) => this.renderer.setOverlay(id), onUser: () => { this.autoOverlay = false; } });
    const execute = (cmd) => this.execute(cmd);
    // v1.4 : un refus faute de budget propose d'emprunter (bouton de la notification)
    const notify = (level, message) => this.notifications.push({ level, message, ...(/Budget insuffisant/.test(message ?? '') ? { panel: 'finance', tab: 'loans', action: 'Emprunter' } : {}) });
    this.fullscreen = new FullscreenController(this.root, {
      notify,
      onChange: ({ active }) => this.hud.setFullscreen(active)
    });
    this.panels = {
      finance: new FinancePanel({ execute, notify, onPanel: (id, tab) => this.openPanel(id, tab) }),
      ai: new TechPanel({ execute, notify }),
      city: new CityPanel({ onFocus: (x, y) => this.focus(x, y), onPanel: (id, tab) => this.openPanel(id, tab), getRenderStats: () => this.renderer.stats, getHostStats: () => this.host?.stats, execute, notify }),
      saves: new SavesPanel({
        saves: this.saves,
        settings: this.settings,
        onSave: (o) => this.save(o),
        onLoad: (id) => this.load(id),
        notify,
        // v1.6 : sauvegarde en ligne et partage
        cloud: this.cloud,
        cloudSync: this.cloudSync,
        onShare: (source) => this.share(source),
        onImported: (id) => this.load(id)
      }),
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
      demand: new DemandPanel({ execute, notify }),
      politics: new PoliticsPanel({ execute, notify, onTool: (id) => { this.panelHost.close(); this.toolbar.selectById(id); } }),
      territory: new TerritoryPanel({ onBuy: (gx, gy, price) => this.buyParcel(gx, gy, price), onExit: (side, pv) => this.openExit(side, pv), onFocus: (x, y) => this.focus(x, y) }),
      lines: new LinesPanel({
        execute,
        notify,
        onTool: (id) => {
          this.panelHost.close();
          this.toolbar.selectById(id);
        },
        onFocus: (x, y) => this.focus(x, y),
        confirm: (message) => confirmDialog(message, { confirmLabel: 'Supprimer', danger: true })
      }),
      sound: new SoundPanel({ settings: this.settings, apply: () => this.applySettings(), audio: this.audio }),
      help: new HelpPanel({ onShowObjectives: () => this.objectives.show(), onPanel: (id) => this.openPanel(id) }),
      // v0.9 : conseiller circulation et pollution (P), guide du maire (G)
      traffic: new TrafficPanel({
        execute,
        notify,
        onTool: (id) => {
          this.panelHost.close();
          this.toolbar.selectById(id);
        },
        onFocus: (x, y) => {
          this.panelHost.close();
          this.focus(x, y);
        },
        onOverlay: (id) => {
          this.panelHost.close();
          this.overlays.set(id);
        },
        onPanel: (id, tab) => this.openPanel(id, tab)
      }),
      guide: new GuidePanel({ onAction: (a) => this.#guideAction(a) }),
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
      onClose: () => {},
      // v1.6 : villes en ligne et partie reçue (fichier) depuis l'écran d'accueil
      onCloud: () => this.cloudGames(),
      onImported: (id) => this.load(id),
      cloudConfigured: this.cloud.configured
    });

    const tooltip = this.$('#cursor-tip');
    this.tools = new ToolController({
      getSession: () => this.session,
      renderer: this.view,
      tooltip,
      onSelect: (t) => this.select(t),
      notify,
      needsConfirm: (cents) => this.settings.get('confirmDemolish') && cents >= 500000,
      confirm: (message) => confirmDialog(message, { confirmLabel: 'Démolir', danger: true }),
      onChange: (tool) => {
        this.#updateToolChip(tool);
        this.#autoServiceOverlay(tool);
      },
      confirmPlacement: () => !!this.settings.get('confirmPlacement')
    });
    this.input = new InputController({
      canvas: this.$('#viewport'),
      renderer: this.view,
      tools: this.tools,
      settings: this.settings,
      isBlocked: () => !this.session || this.menu.visible || !!document.querySelector('.dialog-backdrop'),
      shortcuts: this.#shortcuts(),
      onRotate: (dir) => this.rotateView(dir)
    });

    // Toucher la carte referme les menus ouverts (utile au doigt, où il n'y a pas de survol).
    this.$('#viewport').addEventListener('pointerdown', () => {
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
    this.renderer2d.effects.onThunder = () => this.audio.play('thunder');
    this.renderer2d.airsea.onSound = (name) => this.audio.play(name);
    // v1.5 : vue 3D par défaut (si l'appareil la permet) ; la vue 2D reste disponible
    if (this.settings.get('view3d') !== false) await this.setView3d(true, { persist: false, quiet: true });
    else this.#showCanvas();
    await this.showMenu();
    // v1.6 : stockage persistant (le navigateur évite d'effacer les sauvegardes), service Google préchargé,
    // ville reçue par lien (?partie=…)
    navigator.storage?.persist?.().catch(() => {});
    this.cloud.preload();
    await this.#openSharedLink();
    // v1.7 : application Android (bouton Retour, arrière-plan, plein écran)
    await setupNative(this).catch((err) => console.warn('Intégration Android :', err));
  }

  /**
   * v1.7 : bouton Retour d'Android. Ferme ce qui est ouvert, du plus récent au plus ancien.
   * @returns {boolean} true si l'appui a servi ; false s'il n'y a plus rien à fermer (proposer de quitter)
   */
  handleBack() {
    if (document.querySelector('.dialog-backdrop')) {
      // Les fenêtres se ferment avec Échap ; la soirée électorale attend un choix (l'appui est ignoré)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    }
    if (this.notifHistory?.isOpen) {
      this.notifHistory.close();
      return true;
    }
    if (this.menu.visible) {
      if (!this.session) return false;
      this.menu.hide();
      this.menu.onClose?.();
      return true;
    }
    if (!this.session) return false;
    if (this.tools.cancel()) return true;
    if (this.toolbar.openCat) {
      this.toolbar.closeFlyout();
      return true;
    }
    if (this.panelHost.openId) {
      this.panelHost.close();
      return true;
    }
    if (this.inspector.open) {
      this.select(null);
      return true;
    }
    if (this.overlays.expanded) {
      this.overlays.toggleExpanded(false);
      return true;
    }
    return false;
  }

  /** v1.7 : sauvegarde automatique avant de quitter l'application. */
  async saveBeforeExit() {
    if (!this.session) return;
    try {
      await this.host?.flush();
      const r = await this.saves.autosave(this.session.state);
      await this.cloudSync.afterSave(this.session.state, r, { kind: 'auto' });
    } catch {
      /* on quitte quand même */
    }
  }

  /** v1.7 : l'application passe en arrière-plan (appel, autre application) : pause et sauvegarde. */
  onBackground() {
    if (!this.session) return;
    if (!this.clock.paused) this.setSpeed(0);
    this.saveBeforeExit();
  }

  /** v1.6 : une ville partagée par lien (?partie=identifiant) : résumé, puis reprise dans ce navigateur. */
  async #openSharedLink() {
    let id = null;
    try {
      const url = new URL(location.href);
      id = url.searchParams.get('partie');
      if (!id) return;
      url.searchParams.delete('partie');
      history.replaceState(null, '', url.toString());
    } catch {
      return;
    }
    if (!/^[\w-]{10,200}$/.test(id)) return this.notifications.push({ level: 'warning', message: 'Lien de partage invalide.' });
    this.#busy('Récupération de la ville partagée…');
    let rec;
    try {
      rec = await this.cloud.downloadShared(id);
    } catch (err) {
      this.#busy(null);
      return this.notifications.push({ level: 'danger', message: `Ville partagée introuvable : ${err.message}` });
    }
    this.#busy(null);
    if (!(await receivedGameDialog(rec))) return;
    try {
      const saved = await this.saves.importRecordObject(rec, { suffix: ' (partagée)' });
      await this.load(saved.id);
    } catch (err) {
      this.notifications.push({ level: 'danger', message: `Impossible de reprendre cette ville : ${err.message}` });
    }
  }

  /**
   * v1.6 : partager une ville. `source` : la partie en cours ({ current: true }), une sauvegarde de ce navigateur
   * ({ localId, name }) ou une partie en ligne ({ cloudFileId, name }).
   */
  share(source = { current: true }) {
    const notify = (level, message) => this.notifications.push({ level, message });
    let getRecord;
    let name = source.name;
    if (source.localId) {
      getRecord = async () => {
        const rec = await this.saves.get(source.localId);
        if (!rec) throw new Error('Sauvegarde introuvable');
        return rec;
      };
    } else if (source.cloudFileId) {
      getRecord = () => this.cloud.download(source.cloudFileId);
    } else {
      if (!this.session) return;
      name = this.session.state.meta.name;
      getRecord = async () => {
        await this.host?.flush();
        return this.saves.buildRecord(this.session.state, { id: 'share', name, kind: 'manual' });
      };
    }
    return shareDialog({ getRecord, name: name ?? 'Ma ville', cloud: this.cloud, notify });
  }

  /** v1.6 : villes en ligne depuis l'écran d'accueil (nouvel appareil, navigateur effacé). */
  cloudGames() {
    let dlg = null;
    const box = h('div.cloud-dialog');
    const render = () => setChildren(box, cloudSection({
      cloud: this.cloud,
      sync: this.cloudSync,
      getSession: () => null,
      onLoad: (id) => {
        dlg?.close();
        this.menu.hide();
        this.load(id);
      },
      onShare: (src) => this.share(src),
      notify: (level, message) => this.notifications.push({ level, message }),
      rerender: render
    }), h('div.dialog-actions', h('button.btn', { type: 'button', on: { click: () => dlg?.close() } }, 'Fermer')));
    render();
    dlg = contentDialog(box);
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
      Enter: () => this.tools.confirmPending(),
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
      t: () => this.togglePanel('territory'),
      e: () => this.togglePanel('politics'),
      k: () => this.togglePanel('lines'),
      // v0.9 : orientation de la carte et vue de dessus
      ',': () => this.rotateView(-1),
      ';': () => this.rotateView(1),
      '.': () => this.rotateView(1),
      v: () => this.toggleTopView(),
      p: () => this.togglePanel('traffic'),
      g: () => this.togglePanel('guide'),
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
  /**
   * v0.7 : choisir un équipement de service public (école, commissariat, hôpital…) affiche la couche de ce service,
   * pour voir d'un coup d'œil les quartiers mal desservis ; la couche se retire quand on change d'outil.
   */
  #autoServiceOverlay(tool) {
    const type = tool?.defId ? this.catalog.building(tool.defId)?.capacity?.service?.type : null;
    if (type) {
      if (!this.overlays.current || this.autoOverlay) {
        this.autoOverlay = true;
        this.overlays.set(`svc_${type}`);
      }
    } else if (this.autoOverlay) {
      this.autoOverlay = false;
      if (this.overlays.current?.startsWith('svc_')) this.overlays.set(null);
    }
  }

  #updateToolChip(tool) {
    const chip = this.$('#tool-chip');
    if (!tool || tool.kind === 'select') {
      chip.hidden = true;
      return;
    }
    const hint = {
      road: 'Glissez pour tracer',
      rail: 'Glissez pour poser les rails',
      zone: 'Glissez pour délimiter',
      demolish: 'Glissez pour sélectionner',
      deliveryZone: 'Glissez pour délimiter',
      terraform: 'Glissez pour délimiter',
      move: this.tools.moveSource ? 'Choisissez le nouvel emplacement' : 'Touchez l\'équipement à déplacer',
      line: this.tools.lineStops?.length ? `${this.tools.lineStops.length} arrêt(s) : touchez le suivant, ou Valider` : 'Touchez les arrêts dans l\'ordre du parcours',
      building: 'Choisissez l\'emplacement'
    }[tool.kind];
    // Bâtiment : rappel des effets principaux pendant la pose
    const summary = tool.kind === 'building' && this.session ? buildingSummary(this.session.catalog.building(tool.defId), this.session.catalog) : null;
    // Pose en attente : bouton « Valider » avec le coût (désactivé si l'emplacement est impossible)
    const pv = this.tools.pending ? this.tools.pendingPreview : null;
    const validate = pv
      ? h('button.chip-btn.chip-validate', {
        type: 'button',
        'aria-label': `Valider${pv.ok ? ` (${pv.cost ? formatMoney(pv.cost) : 'gratuit'})` : ''}`,
        title: pv.ok ? 'Construire ici (Entrée)' : pv.messages?.filter(Boolean).join(' · '),
        disabled: !pv.ok,
        on: { click: () => this.tools.confirmPending() }
      }, icon('check', 16), h('span', pv.ok ? `Valider · ${pv.cost ? formatMoney(pv.cost, { compact: true }) : 'gratuit'}` : 'Impossible ici'))
      : null;
    const cancel = this.tools.pending
      ? h('button.chip-btn', { type: 'button', 'aria-label': 'Annuler la pose', title: 'Annuler la pose (Échap)', on: { click: () => this.tools.cancel() } }, h('span', 'Annuler'))
      : null;
    setChildren(chip,
      h('span.chip-label', h('strong', tool.label ?? ''), summary && !pv ? h('small.chip-summary', summary) : hint ? h('small', pv && !pv.ok ? pv.messages?.filter(Boolean).join(' · ') || hint : hint) : null),
      this.tools.canRotate ? h('button.chip-btn', { 'aria-label': 'Pivoter', title: 'Pivoter (R)', on: { click: () => { this.tools.rotate(); this.#updateToolChip(this.tools.tool); } } }, icon('rotate', 16), h('span', 'Pivoter')) : null,
      validate,
      cancel,
      h('button.chip-btn', { 'aria-label': 'Terminer', title: 'Revenir à la sélection (Échap)', on: { click: () => this.toolbar.selectById('select') } }, icon('close', 16))
    );
    chip.hidden = false;
  }

  applySettings() {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const r of [this.renderer2d, this.renderer3d]) {
      if (!r) continue;
      r.setEffects({
        dayNight: this.settings.get('dayNight') !== false,
        weather: this.settings.get('weatherFx') !== false,
        effects: this.settings.get('effects') !== false,
        reducedMotion: reduced
      });
      r.setVehicles(this.settings.get('showVehicles'));
      r.setGridLines(this.settings.get('showGridLines'));
      r.setRenderScale(this.settings.get('renderScale'));
    }
    this.renderer3d?.setShadows?.(this.settings.get('shadows3d'));
    this.audio.applyVolumes();
    this.hud?.setMuted(!!this.settings.get('muted'));
    // Bascule 2D/3D demandée depuis les paramètres
    const want3d = this.settings.get('view3d') !== false;
    if (this.nav && want3d !== this.use3d && !this.switching && !(want3d && this.renderer3dFailed)) this.setView3d(want3d, { persist: false });
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

  async newGame({ name, seed, size, mode, disasters = 'normal', elections = 'on', difficulty = 'normal', scenarioId, mapParams = null }) {
    this.#busy('Génération du territoire…');
    await new Promise((r) => setTimeout(r, 30));
    const bus = new EventBus();
    const challenge = mode === 'scenario' ? CHALLENGE_BY_ID.get(scenarioId) : null;
    if (challenge) {
      seed = challenge.seed ?? seed;
      size = challenge.size;
      name = challenge.name;
    }
    const session = GameSession.newGame({ catalog: this.catalog, seed, width: size, height: size, name, bus, mapParams: challenge ? null : mapParams });
    session.state.options.disasters = disasters;
    // v1.0 : difficulté (trésorerie initiale, dotations, capacité d'emprunt) ; les scénarios gardent leurs règles
    if (!challenge) applyDifficulty(session.state, difficulty);
    if (challenge) {
      this.#busy(`Préparation du scénario « ${challenge.name} »…`);
      await new Promise((r) => setTimeout(r, 30));
      setupChallenge(session, challenge.id);
    } else if (mode === 'town') {
      this.#busy('Construction du bourg selon les règles du jeu…');
      await new Promise((r) => setTimeout(r, 30));
      session.state.meta.preparing = true;
      const town = buildStarterTown(session, { size: size >= 96 ? 'large' : 'small' });
      session.run(120);
      for (const id of ['police', 'fire', 'school', 'clinic']) placeNear(session, id, town.xEnd - 6, town.row - 2);
      session.run(240);
      ensureStartingCash(session);
      delete session.state.meta.preparing;
      session.history.clear();
    }
    // Le mandat du joueur commence maintenant (après la préparation d'un bourg ou d'un scénario)
    session.state.options.elections = elections === 'off' ? 'off' : 'on';
    session.state.politics = defaultPolitics(session.state, { enabled: elections !== 'off' });
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

  /** Écran « Nouveau statut » : ce que débloque le palier atteint et la dotation de l'État. */
  #milestoneDialog({ rank, grant, unlocks }) {
    const m = MILESTONES[rank];
    if (!m) return;
    const items = [
      ...(unlocks?.features ?? []),
      ...(unlocks?.zones ?? []).map((z) => `Zone « ${z} »`),
      ...(unlocks?.roads ?? []),
      ...(unlocks?.buildings ?? [])
    ];
    const prev = MILESTONES[rank - 1];
    let dlg = null;
    const box = h('div.milestone-dialog',
      h('p.small', `${this.session?.state.meta.name ?? 'La ville'} change de statut`),
      h('h2', `Nouveau statut : ${m.name}`),
      h('p', `${formatNumber(m.population)} habitants atteints.${grant ? ` L'État verse une dotation de ${formatMoney(grant)}.` : ''}`),
      m.maxZoneLevel > (prev?.maxZoneLevel ?? 0) ? h('p.small', `Les bâtiments de zone peuvent désormais monter jusqu'au niveau ${m.maxZoneLevel}.`) : null,
      items.length ? h('div', h('h3', 'Désormais disponible'), h('ul', items.map((t) => h('li', t)))) : null,
      h('div.dialog-actions', h('button.btn.primary', { type: 'button', on: { click: () => dlg?.close() } }, 'Continuer'),
        h('button.btn', { type: 'button', on: { click: () => { dlg?.close(); this.openPanel('city', 'progression'); } } }, 'Voir la progression'))
    );
    dlg = contentDialog(box);
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
    // Orientation et vue de dessus mémorisées (v0.9)
    setView({ rot: Number(this.settings.get('viewRot')) || 0, top: !!this.settings.get('viewTop') });
    // Seul le moteur affiché est associé à la partie ; l'autre le sera au moment de la bascule
    for (const r of [this.renderer2d, this.renderer3d]) if (r && r !== this.renderer) r.detach();
    if (this.renderer.is3d) this.renderer.setViewMode({ rot: Number(this.settings.get('viewRot')) || 0, top: !!this.settings.get('viewTop') });
    this.renderer.attach(session);
    this.#updateNav();
    this.select(null);
    this.panelHost.close();
    this.toolbar.select({ id: 'select', kind: 'select', label: 'Sélection' });
    this.notifications.reset();
    this.notifHistory?.close();
    this.bus.on('notify', (n) => {
      // Les crises ont leur propre carte (avec « Voir ») : pas de notification en double
      if (n.kind === 'crisis') return;
      // v1.6 : le résultat d'un scrutin n'est annoncé qu'à la fin du dépouillement animé
      if (n.election) this.notifications.hold();
      this.notifications.push(n);
      if (n.kind !== 'crisis') this.audio.play(n.level === 'danger' ? 'danger' : n.level === 'warning' ? 'warning' : n.level === 'success' ? 'success' : 'info');
    });
    this.bus.on('sim:month', () => {
      this.panelHost.refresh();
      this.#trafficTip();
    });
    // v1.4 : ajustements faits au chargement d'une ancienne partie (lignes électriques retirées…)
    for (const message of session.state.loadNotes ?? []) this.notifications.push({ level: 'info', message });
    // v0.9 : une seule fois, on signale le guide du maire au nouveau joueur
    if (!this.settings.get('guideHint')) {
      this.settings.set('guideHint', true);
      this.notifications.push({ level: 'info', message: 'Premier mandat ? Le guide du maire explique tout le jeu, chapitre par chapitre (touche G).', panel: 'guide' });
    }
    this.bus.on('command:done', ({ cmd }) => {
      // v1.6 : une décision réglée depuis un panneau retire la notification « à traiter » correspondante
      const settled = cmd.type === 'council' && cmd.op === 'answer' ? 'council'
        : cmd.type === 'controversy' ? 'press'
          : cmd.type === 'politics' && cmd.op === 'programme' ? 'campaign'
            : cmd.type === 'politics' && cmd.op === 'secondRound' ? 'results' : null;
      if (settled) this.notifications.resolve((e) => e.panel === 'politics' && e.tab === settled);
      const sfx = { road: 'road', rail: 'road', buyParcel: 'money', building: 'build', zone: 'zone', deliveryZone: 'zone', demolish: 'demolish', upgrade: 'money', loan: 'money', research: 'tech', undo: 'undo', crisisResponse: 'money' }[cmd.type];
      if (sfx) this.audio.play(sfx);
    });
    this.bus.on('era:changed', () => this.audio.play('fanfare'));
    // v1.0 : nouveau statut de la ville (palier de population)
    this.bus.on('milestone:reached', (ev) => {
      this.audio.play('fanfare');
      this.#milestoneDialog(ev);
    });
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
    // v1.3 : soirée du premier tour, négociation des fusions (sans réponse, le second tour a lieu une semaine après)
    this.bus.on('politics:secondRound', ({ secondRound }) => {
      this.setSpeed(0);
      this.closeRoundOne?.();
      this.closeRoundOne = secondRoundDialog(secondRound, {
        onBeat: (k) => this.audio.play(k === 'drum' ? 'drum' : 'tick'),
        onReveal: () => this.notifications.release(),
        onChoose: (mergeWith) => {
          this.closeRoundOne = null;
          const r = this.execute({ type: 'politics', op: 'secondRound', mergeWith });
          if (!r?.ok) this.notifications.push({ level: 'warning', message: r?.messages?.[0] ?? r?.reason ?? 'Fusion impossible' });
        }
      });
    });
    this.bus.on('politics:election', ({ result }) => {
      this.closeRoundOne?.();
      this.closeRoundOne = null;
      this.setSpeed(0);
      // v1.6 : dépouillement animé, puis fanfare (ou échec) au moment du verdict
      electionDialog(result, {
        onBeat: (k) => this.audio.play(k === 'drum' ? 'drum' : 'tick'),
        onReveal: () => {
          this.audio.play(result.won ? 'fanfare' : 'fail');
          this.notifications.release();
        },
        onContinue: () => this.setSpeed(1),
        onFree: () => {
          this.execute({ type: 'politics', op: 'continue' });
          this.notifications.push({ level: 'info', message: 'Vous poursuivez sans élections : la popularité reste suivie, mais plus aucun scrutin n\'aura lieu.' });
          this.setSpeed(1);
        },
        onMenu: () => this.showMenu()
      });
    });
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

  /** v1.6 : badge de la cloche et rafraîchissement du déroulé ouvert. */
  #notifBadge() {
    if (!this.hud || !this.notifications) return;
    if (this.notifHistory?.isOpen && !this.notifRefreshing) {
      this.notifRefreshing = true;
      this.notifHistory.refresh();
      this.notifRefreshing = false;
    }
    this.hud.setNotifications({ unread: this.notifications.unread, pending: this.notifications.pending, open: !!this.notifHistory?.isOpen });
  }

  toggleMute() {
    const muted = !this.settings.get('muted');
    this.settings.set('muted', muted);
    this.audio.unlock();
    this.audio.applyVolumes();
    this.hud.setMuted(muted);
    this.notifications.push({ level: 'info', message: muted ? 'Son coupé (N pour le rétablir)' : 'Son activé', key: 'mute' });
  }

  /** v0.9 : au plus une fois par an, quand la circulation sature, on oriente vers le conseiller (touche P). */
  #trafficTip() {
    const st = this.session?.state;
    if (!st) return;
    const c = st.traffic?.stats?.avgCongestion ?? 0;
    const m = Math.floor(st.time.tick / 30);
    if (c < 0.6 || (st.stats.population ?? 0) < 1000) return;
    if (this.lastTrafficTip !== undefined && m - this.lastTrafficTip < 12) return;
    this.lastTrafficTip = m;
    this.notifications.push({ level: 'warning', message: `Circulation saturée (${Math.round(c * 100)} % de charge moyenne) : le conseiller circulation propose des solutions (touche P).`, panel: 'traffic' });
  }

  /** Boussole : retour au nord d'origine (en 3D, annule aussi une rotation libre). */
  resetNorth() {
    if (this.renderer.is3d) {
      this.renderer.setViewMode({ rot: 0, exact: true });
      this.settings.set('viewRot', 0);
      return;
    }
    this.rotateView(-this.renderer.viewMode.rot);
  }

  /**
   * v1.5 : affiche la vue 3D (Three.js, chargée à la première demande) ou la vue isométrique 2D. La case au centre
   * de l'écran, la sélection, la couche d'information et l'outil en cours sont conservés.
   */
  async setView3d(on, { persist = true, quiet = false } = {}) {
    if (this.switching) return;
    this.switching = true;
    try {
      if (on && !this.renderer3d) {
        try {
          this.#busy('Préparation de la vue 3D…');
          const { Renderer3D } = await import('../rendering3d/Renderer3D.js');
          const r = new Renderer3D({ catalog: this.catalog, audio: this.audio });
          await r.init(this.$('#viewport'));
          this.renderer3d = r;
          this.applySettings();
        } catch (err) {
          console.warn('Vue 3D indisponible :', err);
          this.renderer3dFailed = true;
          on = false;
          if (!quiet) this.notifications?.push({ level: 'warning', message: 'La vue 3D n\'est pas disponible sur cet appareil (WebGL) : la vue 2D reste active.' });
        } finally {
          this.#busy(null);
        }
      }
      const prev = this.renderer;
      const v = prev.view;
      const center = this.session ? prev.tileAtScreen(v.width / 2, v.height / 2) : null;
      this.use3d = !!on && !!this.renderer3d;
      if (persist) this.settings.set('view3d', this.use3d);
      const r = this.renderer;
      if (prev !== r) {
        prev.setPreview(null);
        prev.setHover(null);
      }
      this.#showCanvas();
      if (this.session && r.session !== this.session) {
        if (!r.is3d) setView({ rot: Number(this.settings.get('viewRot')) || 0, top: !!this.settings.get('viewTop') });
        else r.setViewMode({ rot: Number(this.settings.get('viewRot')) || 0, top: !!this.settings.get('viewTop') });
        r.attach(this.session);
      }
      if (this.session) {
        r.setOverlay(this.overlays?.current ?? null);
        r.setXray(!!this.xray);
        r.setSelected(this.inspector?.target?.buildingId ?? 0);
        if (center && prev !== r) {
          if (r.is3d) r.lookAt(center.x, center.y);
          else r.focus(center.x, center.y);
        }
        this.tools?.tickRefresh?.();
      }
      this.#updateNav();
      if (!quiet && prev !== r) this.notifications?.push({ level: 'info', message: this.use3d ? 'Vue 3D : un doigt pour déplacer, deux pour zoomer, tourner et incliner (clic droit à la souris).' : 'Vue isométrique 2D', key: 'view3d' });
    } finally {
      this.switching = false;
    }
  }

  /** Affiche le canevas du moteur actif, masque l'autre. */
  #showCanvas() {
    const c2 = this.renderer2d.canvas;
    if (c2) c2.style.display = this.use3d ? 'none' : 'block';
    this.renderer3d?.setActive(this.use3d);
    this.root.classList.toggle('view-3d', this.use3d);
  }

  /** Fait tourner la carte d'un quart de tour (+1 : sens des aiguilles d'une montre). */
  rotateView(dir = 1) {
    if (!this.session) return;
    const v = this.renderer.viewMode;
    this.renderer.setViewMode({ rot: v.rot + dir });
    this.settings.set('viewRot', this.renderer.viewMode.rot);
    this.#updateNav();
  }

  /** Bascule entre la vue isométrique et la vue de dessus. */
  toggleTopView(on = !this.renderer.viewMode.top) {
    if (!this.session) return;
    this.renderer.setViewMode({ top: on });
    this.settings.set('viewTop', !!on);
    this.#updateNav();
  }

  /** Boussole : l'aiguille montre le nord de la carte ; libellé du bouton de vue. */
  #updateNav() {
    const nav = this.nav;
    if (!nav) return;
    const v = this.renderer.viewMode;
    // Direction du nord (vers les y décroissants de la grille) à l'écran
    let deg;
    if (this.renderer.is3d) deg = this.renderer.northAngle();
    else {
      const a = gridToWorld(10, 10);
      const b = gridToWorld(10, 9);
      deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
    }
    const key = `${Math.round(deg)}:${v.rot}:${v.top}:${this.use3d}`;
    if (key === nav.key) return;
    nav.key = key;
    nav.needle.style.transform = `rotate(${deg}deg)`;
    nav.compass.title = `Nord de la carte · orientation ${v.rot * 90}° (clic : orientation d'origine)`;
    const persp = this.use3d ? 'Vue inclinée' : 'Vue isométrique';
    setChildren(nav.view, icon(v.top ? 'isoview' : 'topview', 18), h('span', v.top ? persp : 'Vue de dessus'));
    nav.view.setAttribute('aria-pressed', String(v.top));
    nav.view.title = v.top ? (this.use3d ? 'Revenir à la vue inclinée (V)' : 'Revenir à la vue isométrique (V)') : 'Vue de dessus : la ville en plan (V)';
    if (nav.dim) {
      setChildren(nav.dim, h('b', this.use3d ? '2D' : '3D'));
      nav.dim.setAttribute('aria-pressed', String(this.use3d));
      nav.dim.title = this.use3d ? 'Passer à la vue isométrique 2D' : 'Passer à la vue 3D (modèles 3D, navigation libre)';
      nav.dim.setAttribute('aria-label', nav.dim.title);
      nav.dim.hidden = !!this.renderer3dFailed && !this.use3d;
    }
  }

  /** Guide du maire : « Montre-moi » ouvre l'outil, le panneau, la couche ou le menu concernés. */
  #guideAction(a) {
    if (!this.session) return;
    this.panelHost.close();
    if (a.tool) this.toolbar.selectById(a.tool);
    else if (a.panel) this.openPanel(a.panel, a.tab);
    else if (a.overlay) this.overlays.set(a.overlay);
    else if (a.category) this.toolbar.openFlyout(a.category);
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
      this.notifications.push({ level: 'success', message: `Partie sauvegardée : ${r.name}${this.cloud.connected && this.cloudSync.auto ? ' (copie en ligne en cours)' : ''}` });
      // v1.6 : copie sur Google Drive si le joueur est connecté
      this.cloudSync.afterSave(this.session.state, r, { kind: 'manual' }).then((f) => {
        if (f) this.notifications.push({ level: 'success', message: `Copie en ligne à jour : ${f.name}`, key: 'cloud-ok' });
      });
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

  /** v1.4 : ouvre une sortie d'autoroute sur un côté de la carte (tracé le moins cher, après confirmation). */
  async openExit(side, pv) {
    if (!this.session) return;
    const where = { N: 'au nord', S: 'au sud', E: 'à l\'est', W: 'à l\'ouest' }[side];
    if (!(await confirmDialog(`Tracer une autoroute de sortie ${where} (${pv.length} cases) pour ${formatMoney(pv.cost)} ?`, { confirmLabel: 'Construire' }))) return;
    const r = this.execute({ type: 'exit', side });
    if (!r?.ok) return this.notifications.push({ level: 'warning', message: r?.messages?.join(' · ') || 'Sortie impossible' });
    this.focus(r.to.x, r.to.y);
    this.panelHost.refresh(true);
  }

  /**
   * Achète une parcelle (32 × 32) : paiement par commande, puis, si la carte doit grandir, la partie est
   * sérialisée, agrandie (WorldExpansion) et rechargée telle quelle — caméra recentrée au même endroit.
   */
  async buyParcel(gx, gy, price) {
    if (!this.session) return;
    if (!(await confirmDialog(`Acheter cette parcelle de 32 × 32 cases pour ${formatMoney(price)} ?`, { confirmLabel: 'Acheter' }))) return;
    const r = this.execute({ type: 'buyParcel', gx, gy });
    if (!r.ok) return this.notifications.push({ level: 'warning', message: r.messages?.join(' · ') || 'Achat impossible' });
    if (!r.grows) {
      this.notifications.push({ level: 'success', message: 'Parcelle achetée : elle est constructible tout de suite.' });
      this.panelHost.refresh(true);
      return;
    }
    const speed = this.clock.speedIndex;
    this.#busy('Agrandissement du territoire…');
    try {
      await this.host?.flush();
      const cam = this.renderer.tileAtScreen(this.renderer.view.width / 2, this.renderer.view.height / 2);
      const { data, offset } = expandSave(serializeState(this.session.state), { catalog: this.catalog, box: r.box });
      const state = deserializeState(data);
      const session = new GameSession({ catalog: this.catalog, state, bus: new EventBus() });
      await this.startSession(session);
      if (cam) this.focus(cam.x + offset.dx, cam.y + offset.dy);
      this.setSpeed(speed);
      this.openPanel('territory');
      this.notifications.push({ level: 'success', message: `Territoire agrandi : la carte fait maintenant ${state.grid.width} × ${state.grid.height} cases.` });
    } catch (err) {
      this.notifications.push({ level: 'danger', message: `Agrandissement impossible : ${err.message}` });
    } finally {
      this.#busy(null);
    }
  }

  async #autosave() {
    if (!this.session) return;
    try {
      await this.host?.flush();
      const r = await this.saves.autosave(this.session.state);
      this.notifications.push({ level: 'info', message: 'Sauvegarde automatique effectuée', key: 'autosave' });
      this.cloudSync.afterSave(this.session.state, r, { kind: 'auto' });
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
    if (this.renderer.is3d) return;
    // La carte des crises occupe le haut de l'écran : la cible est montrée un peu plus bas
    const crisis = this.$('#crisis');
    if (crisis && !crisis.hidden && window.innerWidth > 760) {
      this.renderer.camera.y -= 110 / this.renderer.camera.zoom;
      this.renderer.camera.version++;
    }
  }

  /**
   * Bouton d'alerte : centre la vue sur le bâtiment en défaut le plus proche du centre de l'écran.
   * Des clics successifs parcourent les bâtiments suivants (du plus proche au plus lointain).
   * @param {'power'|'water'|'abandoned'|'treasury'|'crisis'|null} kind
   */
  locateAlert(kind) {
    const state = this.session?.state;
    if (!state || !kind) return this.togglePanel('city');
    if (kind === 'treasury') return this.openPanel('finance', 'loans');
    if (kind === 'crisis') {
      const c = state.crises?.active?.[0];
      if (c && Number.isInteger(c.x)) this.focus(c.x, c.y);
      return;
    }
    const tick = state.time.tick;
    const matches = [];
    for (const b of state.buildings.values()) {
      const def = this.catalog.building(b.defId);
      const settling = (b.constructionUntil > tick && !b.upgradeTo) || tick - (b.deliveredTick ?? b.builtTick) < 10;
      const hit =
        kind === 'power' ? !settling && (b.powerNeed ?? def.networks.power) > 0 && !b.powered
          : kind === 'water' ? !settling && (b.waterNeed ?? 0) > 0 && !b.watered
            : kind === 'abandoned' ? b.abandoned : false;
      if (hit) matches.push(b);
    }
    if (!matches.length) return this.togglePanel('city');
    // Mémoire du parcours : réinitialisée si le type change ou après 20 s d'inactivité
    const now = performance.now();
    const cur = this.alertCursor;
    if (!cur || cur.kind !== kind || now - cur.at > 20_000) this.alertCursor = { kind, seen: new Set(), origin: null, at: now };
    const c = this.alertCursor;
    c.at = now;
    if (!c.origin) {
      const v = this.renderer.view;
      c.origin = this.renderer.tileAtScreen(v.width / 2, v.height / 2) ?? { x: state.grid.width / 2, y: state.grid.height / 2 };
    }
    let pool = matches.filter((b) => !c.seen.has(b.id));
    if (!pool.length) {
      c.seen.clear();
      pool = matches;
    }
    const d = (b) => (b.x + b.w / 2 - c.origin.x) ** 2 + (b.y + b.h / 2 - c.origin.y) ** 2;
    const target = pool.reduce((a, b) => (d(b) < d(a) ? b : a));
    c.seen.add(target.id);
    this.focus(target.x + Math.floor(target.w / 2), target.y + Math.floor(target.h / 2));
    this.select({ buildingId: target.id });
    const label = { power: 'sans électricité', water: 'sans eau', abandoned: 'abandonné' }[kind];
    this.notifications.push({ level: 'info', message: `Bâtiment ${label} (${c.seen.size}/${matches.length}) — vérifiez le raccordement au réseau le plus proche.`, key: `alert-${kind}-${target.id}` });
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
    // Tracés des lignes : pendant le tracé d'une ligne et tant que le panneau des lignes est ouvert (v0.8)
    this.renderer.setShowRoutes(this.tools.tool.kind === 'line' || this.panelHost.openId === 'lines', this.panels.lines.highlight);
    this.renderer.render(dt, { paused: this.clock.paused, speedIndex: this.clock.speedIndex });
    const now = performance.now();
    // Boussole : la caméra 3D tourne librement (gestes), l'aiguille suit
    if (this.use3d && now - (this.uiTimers.nav ?? 0) > 120) {
      this.uiTimers.nav = now;
      this.#updateNav();
    }
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
      inMenu: this.menu.visible,
      // v1.5 : en 3D, l'ambiance est spatialisée par la vue (sources placées dans la scène)
      spatial: this.use3d
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
