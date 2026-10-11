import { h, setChildren } from './dom.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { confirmDialog, textDialog, pasteDialog } from './Dialog.js';
import { CHALLENGES } from '../app/challenges.js';
import { DISASTER_LEVEL_LABELS } from '../simulation/CrisisSystem.js';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export const SHORTCUTS = [
  ['Flèches, ZQSD ou WASD', 'Déplacer la caméra'],
  ['Clic droit ou molette enfoncée + glisser', 'Déplacer la caméra'],
  ['Molette', 'Zoomer / dézoomer'],
  ['Clic gauche', 'Sélectionner, construire ; glisser pour tracer routes et zones'],
  ['Maj (en traçant une route)', 'Tracer d\'abord à la verticale'],
  ['R', 'Faire pivoter le bâtiment (si compatible)'],
  ['Échap', 'Revenir à l\'outil de sélection / fermer'],
  ['Suppr', 'Outil de démolition'],
  ['Ctrl+Z', 'Annuler la dernière action'],
  ['Espace', 'Pause / reprise'],
  ['1, 2, 3', 'Vitesse normale, rapide, très rapide'],
  ['B', 'Finances'],
  ['C', 'Tableau de bord de la ville'],
  ['I', 'IA urbaine et politiques'],
  ['L', 'Couche de données suivante'],
  ['X', 'Rendre translucides les bâtiments devant le curseur'],
  ['Ctrl+S', 'Sauvegarde rapide'],
  ['F', 'Plein écran (ou mode immersif quand le navigateur l\'interdit)'],
  ['F3', 'Outils de débogage'],
  ['M', 'Menu principal'],
  ['N', 'Couper ou rétablir le son'],
  ['H', 'Aide']
];

export const TOUCH = [
  ['Pincer', 'Zoomer / dézoomer'],
  ['Glisser à deux doigts', 'Déplacer la carte, quel que soit l\'outil'],
  ['Glisser à un doigt', 'Avec l\'outil Sélection : déplacer la carte. Avec une route ou une zone : tracer'],
  ['Toucher un bâtiment', 'L\'inspecter (outil Sélection)'],
  ['Toucher deux fois au même endroit', 'Poser un bâtiment : le premier appui montre l\'aperçu et le coût'],
  ['Bandeau de l\'outil', 'Pivoter le bâtiment ou revenir à la sélection'],
  ['Bouton plein écran (en haut à droite)', 'Plein écran, ou interface réduite sur iPhone']
];

export class HelpPanel {
  constructor({ onShowObjectives } = {}) {
    this.onShowObjectives = onShowObjectives;
    this.id = 'help';
    this.title = 'Aide';
    this.static = true;
    this.tabs = [
      { id: 'start', label: 'Bien démarrer' },
      { id: 'touch', label: 'Au doigt' },
      { id: 'keys', label: 'Raccourcis clavier' }
    ];
  }

  render(_session, tab) {
    if (tab === 'keys') {
      return h('table.fin.keys', h('tbody', SHORTCUTS.map(([k, d]) => h('tr', h('td', h('kbd', k)), h('td', d)))));
    }
    if (tab === 'touch') {
      return h('table.fin.keys', h('tbody', TOUCH.map(([k, d]) => h('tr', h('td', h('strong', k)), h('td', d)))));
    }
    return h('div',
      this.onShowObjectives ? h('p', h('button.btn.primary', { on: { click: () => this.onShowObjectives() } }, 'Afficher les objectifs guidés')) : null,
      h('ol.steps',
      h('li', h('strong', 'Reliez-vous à l\'autoroute. '), 'Tracez une rue depuis l\'accès autoroutier (bord ouest de la carte). Sans liaison, personne ne s\'installe.'),
      h('li', h('strong', 'Produisez de l\'électricité. '), 'Construisez une centrale le long d\'une route : routes et bâtiments contigus transportent le courant.'),
      h('li', h('strong', 'Zonez. '), 'Tracez des zones résidentielles, commerciales et industrielles à moins de 3 cases d\'une route alimentée. Les bâtiments apparaissent selon la demande (jauges R, C, B, I en haut).'),
      h('li', h('strong', 'Apportez l\'eau et traitez-la. '), 'Pompes au bord de l\'eau ou châteaux d\'eau, puis station d\'épuration. Sans eau, les bâtiments ne montent pas en gamme.'),
      h('li', h('strong', 'Équipez la ville. '), 'Police, pompiers, santé et écoles augmentent la satisfaction et la valeur foncière.'),
      h('li', h('strong', 'Pilotez le budget. '), 'Ouvrez les finances (B) : impôts, tarifs, emprunts, compte de résultat et prévision de trésorerie.'),
      h('li', h('strong', 'Gérez les déchets. '), 'Un centre de collecte près des quartiers et une décharge ou un incinérateur. Les déchets non collectés font baisser la satisfaction et bloquent les nouveaux niveaux.'),
      h('li', h('strong', 'Développez les transports en commun. '), 'Un dépôt de bus puis des arrêts reliés par la route ; plus tard métro, gare et hyperboucle. Moins de voitures, des trajets plus courts.'),
      h('li', h('strong', 'Franchissez l\'eau. '), 'Une rue tracée en ligne droite d\'une rive à l\'autre devient un pont.'),
      h('li', h('strong', 'Faites entrer la ville dans le futur. '), 'Technologies (I), puis ères « Ville autonome » et « Ville symbiotique » (C → Progression) : elles débloquent des bâtiments et des niveaux d\'habitation futuristes.'),
      h('li', h('strong', 'Suivez la météo. '), 'Pluie, neige, brouillard, orages et fortes chaleurs changent la consommation d\'énergie, la circulation, la production solaire et le coût du déneigement (icône météo en haut).'),
      h('li', h('strong', 'Préparez-vous aux crises. '), 'Inondations, canicules, incendies, pannes géantes, grèves et cyberattaques : chacune se prévient (casernes, parcs en bord de rivière, réserve électrique, politiques) et se gère par une décision chiffrée. Tableau de bord (C) → Risques et météo.')
    ));
  }
}

/**
 * Gestion des sauvegardes : liste, sauvegarde, chargement, suppression, export/import, sauvegarde automatique.
 */
export class SavesPanel {
  constructor({ saves, settings, onSave, onLoad, notify }) {
    this.id = 'saves';
    this.title = 'Sauvegardes';
    this.static = true;
    this.saves = saves;
    this.settings = settings;
    this.onSave = onSave;
    this.onLoad = onLoad;
    this.notify = notify;
  }

  render(session, _tab, rerender) {
    const list = h('div.save-list', h('p.hint', 'Chargement…'));
    const name = h('input', { type: 'text', value: session?.state.meta.name ?? 'Ma ville', maxLength: 40, 'aria-label': 'Nom de la sauvegarde' });
    const auto = h('select', { 'aria-label': 'Sauvegarde automatique', on: { change: (e) => this.settings.set('autosaveMinutes', Number(e.target.value)) } },
      [0, 2, 5, 10, 20].map((m) => h('option', { value: m, selected: this.settings.get('autosaveMinutes') === m }, m ? `toutes les ${m} min` : 'désactivée')));
    const importGame = async () => {
      const text = await pasteDialog('Importer une partie');
      if (!text) return;
      try {
        await this.saves.importRecord(text);
        this.notify('success', 'Partie importée');
      } catch (err) {
        this.notify('danger', err.message);
      }
      rerender();
    };
    this.saves.list().then((items) => {
      if (!items.length) return setChildren(list, h('p.empty', 'Aucune sauvegarde pour le moment.'));
      setChildren(list, items.map((it) => h('div.save-item',
        h('div', h('strong', it.name), h('small', `${it.kind === 'auto' ? 'automatique · ' : ''}${dateFmt.format(it.updatedAt)} · ${it.summary.date} · ${formatNumber(it.summary.population)} hab. · ${formatMoney(it.summary.treasury, { compact: true })} · ${it.summary.size} · ${it.sizeKb} Ko`)),
        h('div.save-actions',
          h('button.btn.primary', { on: { click: () => this.onLoad(it.id) } }, 'Charger'),
          session ? h('button.btn', { title: 'Remplacer par la partie en cours', on: { click: async () => { await this.onSave({ id: it.id, name: it.name }); rerender(); } } }, 'Écraser') : null,
          h('button.btn.danger', { on: { click: async () => { if (await confirmDialog(`Supprimer « ${it.name} » ?`, { confirmLabel: 'Supprimer', danger: true })) { await this.saves.remove(it.id); rerender(); } } } }, 'Supprimer')
        )
      )));
    }).catch((err) => setChildren(list, h('p.empty.neg', `Sauvegardes indisponibles : ${err.message}`)));

    return [
      session
        ? h('form.save-form', { on: { submit: async (e) => { e.preventDefault(); await this.onSave({ name: name.value.trim() || 'Ma ville' }); rerender(); } } },
          h('label', 'Nom', name), h('button.btn.primary', { type: 'submit' }, 'Sauvegarder la partie'),
          h('button.btn', { type: 'button', on: { click: () => {
            textDialog('Exporter la partie', this.saves.exportRecord(session.state), `${session.state.meta.name.replace(/[^\w-]+/g, '_')}.urbis.json`);
          } } }, 'Exporter'))
        : null,
      h('div.save-form', h('label', 'Sauvegarde automatique', auto), h('button.btn', { type: 'button', on: { click: importGame } }, 'Importer une partie')),
      h('h3', 'Parties enregistrées dans ce navigateur'),
      list
    ];
  }
}

export class SettingsPanel {
  constructor({ settings, apply, onShowObjectives, onDebug, execute, getSession, audio, onSound }) {
    this.onSound = onSound;
    this.onShowObjectives = onShowObjectives;
    this.onDebug = onDebug;
    this.execute = execute;
    this.getSession = getSession;
    this.audio = audio;
    this.id = 'settings';
    this.title = 'Paramètres';
    this.static = true;
    this.settings = settings;
    this.apply = apply;
  }

  render(_session, _tab, rerender) {
    const toggle = (key, label, def = false) => h('label.check', h('input', { type: 'checkbox', checked: this.settings.get(key) === undefined ? def : !!this.settings.get(key), on: { change: (e) => { this.settings.set(key, e.target.checked); this.apply(); } } }), label);
    const slider = (key, label, def) => {
      const v = Number(this.settings.get(key) ?? def);
      const out = h('output', `${Math.round(v * 100)} %`);
      return h('label.setting.slider', h('span', label),
        h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: v, 'aria-label': label, on: { input: (e) => { this.settings.set(key, Number(e.target.value)); out.textContent = `${Math.round(Number(e.target.value) * 100)} %`; this.apply(); } } }),
        out);
    };
    const session = this.getSession?.();
    const disasters = session
      ? h('label.setting', h('span', 'Catastrophes et crises (partie en cours)'),
        h('select', { 'aria-label': 'Fréquence des catastrophes', on: { change: (e) => { this.execute({ type: 'option', key: 'disasters', value: e.target.value }); rerender?.(); } } },
          Object.entries(DISASTER_LEVEL_LABELS).map(([v, l]) => h('option', { value: v, selected: session.state.options?.disasters === v }, l))))
      : null;
    const select = (key, label, options) =>
      h('label.setting', h('span', label),
        h('select', { 'aria-label': label, on: { change: (e) => { this.settings.set(key, e.target.value === 'auto' ? 'auto' : Number(e.target.value)); this.apply(); } } },
          options.map(([v, l]) => h('option', { value: v, selected: String(this.settings.get(key)) === String(v) }, l))));
    return h('div.settings',
      h('h3', 'Son'),
      this.onSound ? h('p', h('button.btn', { type: 'button', on: { click: () => this.onSound() } }, 'Réglages du son…')) : null,
      h('h3', 'Partie'),
      disasters,
      toggle('pauseOnCrisis', 'Mettre en pause quand une crise exige une décision', true),
      h('h3', 'Effets visuels'),
      toggle('dayNight', 'Cycle jour et nuit (fenêtres et lampadaires allumés)', true),
      toggle('weatherFx', 'Météo visible (pluie, neige, brouillard, éclairs)', true),
      toggle('effects', 'Chantiers animés, fumées et incendies', true),
      h('h3', 'Affichage'),
      select('uiScale', 'Taille de l\'interface', [[0.9, '90 %'], [1, '100 %'], [1.15, '115 %'], [1.3, '130 %']]),
      select('renderScale', 'Qualité graphique (résolution)', [['auto', 'Automatique'], [1, 'Haute'], [0.75, 'Moyenne'], [0.5, 'Économie']]),
      toggle('showVehicles', 'Afficher les véhicules et les drones'),
      toggle('showGridLines', 'Afficher le quadrillage'),
      toggle('showFps', 'Afficher le compteur d\'images'),
      h('h3', 'Commandes'),
      toggle('edgeScroll', 'Défilement de la carte au bord de l\'écran'),
      toggle('confirmDemolish', 'Demander confirmation avant une démolition coûteuse'),
      h('h3', 'Performances'),
      toggle('simWorker', 'Simulation en arrière-plan (Web Worker) : l\'affichage reste fluide pendant les calculs', true),
      h('p.hint', 'Prend effet au prochain chargement ou à la prochaine partie.'),
      h('h3', 'Aide et développement'),
      h('div.debug-actions',
        this.onShowObjectives ? h('button.btn', { on: { click: () => this.onShowObjectives() } }, 'Afficher les objectifs guidés') : null,
        this.onDebug ? h('button.btn', { on: { click: () => this.onDebug() } }, 'Outils de débogage (F3)') : null
      )
    );
  }
}

/**
 * Réglages du son (bouton haut-parleur de la barre du haut) : coupure, volumes, essai.
 */
export class SoundPanel {
  constructor({ settings, apply, audio }) {
    this.id = 'sound';
    this.title = 'Réglages du son';
    this.static = true;
    this.settings = settings;
    this.apply = apply;
    this.audio = audio;
  }

  render() {
    const set = (key, value) => {
      this.settings.set(key, value);
      this.apply();
    };
    const slider = (key, label, def, hint) => {
      const v = Number(this.settings.get(key) ?? def);
      const out = h('output', `${Math.round(v * 100)} %`);
      return h('div.sound-row',
        h('label.setting.slider', h('span', label),
          h('input', { type: 'range', id: `sound-${key}`, min: 0, max: 1, step: 0.05, value: v, 'aria-label': label, on: { input: (e) => { set(key, Number(e.target.value)); out.textContent = `${Math.round(Number(e.target.value) * 100)} %`; } } }),
          out),
        hint ? h('small.hint', hint) : null);
    };
    const muted = !!this.settings.get('muted');
    return h('div.settings.sound-panel',
      h('label.check', h('input', { type: 'checkbox', id: 'sound-muted', checked: muted, on: { change: (e) => { set('muted', e.target.checked); this.audio?.unlock(); } } }), 'Couper tout le son (touche N)'),
      slider('volumeMaster', 'Volume général', 0.8),
      slider('volumeMusic', 'Musique', 0.5, 'Thème différent à chaque ère, plus tendu pendant une crise.'),
      slider('volumeSfx', 'Effets sonores', 0.7, 'Construction, routes, zonage, démolition, notifications, sirènes.'),
      slider('volumeAmbience', 'Ambiance de la ville', 0.6, 'Rumeur, circulation, oiseaux, pluie et vent selon ce que montre la caméra.'),
      h('div.debug-actions',
        h('button.btn', { type: 'button', on: { click: () => { this.audio?.unlock(); setTimeout(() => this.audio?.play('success'), 60); } } }, 'Tester le son')),
      this.audio && !this.audio.supported ? h('p.hint', 'Ce navigateur ne permet pas de jouer du son.') : h('p.hint', 'Le son démarre au premier appui ou clic (règle des navigateurs, iPhone compris).')
    );
  }
}

/**
 * Écran d'accueil : nouvelle partie, reprise, chargement.
 */
export class StartMenu {
  constructor(root, { onNew, onContinue, onLoad, onClose, saves, install }) {
    this.root = root;
    this.install = install;
    this.tab = 'new';
    this.onNew = onNew;
    this.onContinue = onContinue;
    this.onLoad = onLoad;
    this.onClose = onClose;
    this.saves = saves;
  }

  async show({ canResume = false } = {}) {
    this.root.classList.add('open');
    const name = h('input', { type: 'text', value: 'Nouvelle-Rive', maxLength: 40, 'aria-label': 'Nom de la ville' });
    const seed = h('input', { type: 'number', value: Math.floor(Math.random() * 9000) + 1000, min: 1, 'aria-label': 'Graine du terrain' });
    const size = h('select', { 'aria-label': 'Taille de la carte' }, [64, 96, 128].map((n) => h('option', { value: n, selected: n === 64 }, `${n} × ${n}`)));
    const mode = h('select', { 'aria-label': 'Départ' },
      h('option', { value: 'empty' }, 'Terrain vierge'),
      h('option', { value: 'town' }, 'Bourg existant (déjà construit selon les règles du jeu)'));
    const disasters = h('select', { 'aria-label': 'Catastrophes' },
      Object.entries(DISASTER_LEVEL_LABELS).map(([v, l]) => h('option', { value: v, selected: v === 'normal' }, l)));
    let latest = null;
    let items = [];
    try {
      items = await this.saves.list();
      latest = items[0] ?? null;
    } catch {
      /* IndexedDB indisponible : on propose seulement une nouvelle partie */
    }
    const stars = (n) => h('span.stars', { 'aria-label': `Difficulté ${n} sur 4` }, '★'.repeat(n), h('span.off', '★'.repeat(4 - n)));
    const scenarios = h('div.scenario-list',
      CHALLENGES.map((c) => h('article.scenario-card',
        h('header', h('h3', c.name), stars(c.difficulty)),
        h('p', c.pitch),
        h('ul', c.goalsText.map((g) => h('li', g))),
        h('p.hint', `${c.years} ans · ${c.size} × ${c.size}${c.failText ? ` · ${c.failText}` : ''}`),
        h('button.btn.primary', { type: 'button', on: { click: () => { this.hide(); this.onNew({ mode: 'scenario', scenarioId: c.id, name: c.name, seed: c.seed ?? (Number(seed.value) || 2030), size: c.size, disasters: c.disasters }); } } }, 'Relever le défi')
      ))
    );
    const installBox = this.#installBox();
    const tabs = h('nav.menu-tabs', { role: 'tablist' },
      [['new', 'Nouvelle partie'], ['scenarios', 'Scénarios et défis']].map(([id, label]) =>
        h('button.menu-tab', { type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), class: this.tab === id ? 'active' : '', on: { click: () => { this.tab = id; this.show({ canResume }); } } }, label)));
    const newForm = h('form.menu-new', { on: { submit: (e) => { e.preventDefault(); this.hide(); this.onNew({ name: name.value.trim() || 'Nouvelle-Rive', seed: Number(seed.value) || 2030, size: Number(size.value), mode: mode.value, disasters: disasters.value }); } } },
      h('h2', 'Nouvelle partie'),
      h('label', 'Nom de la ville', name),
      h('div.row2', h('label', 'Carte', size), h('label', 'Graine', seed)),
      h('label', 'Départ', mode),
      h('label', 'Catastrophes', disasters),
      h('button.btn.primary.big', { type: 'submit' }, 'Fonder la ville')
    );
    setChildren(this.root,
      h('div.menu-card',
        h('div.menu-brand', h('h1', 'URBIS', h('span', '2030')), h('p', 'Bâtissez, financez et administrez une ville transformée par l\'intelligence artificielle.')),
        tabs,
        this.tab === 'scenarios' ? scenarios : null,
        h('div.menu-cols', { hidden: this.tab === 'scenarios' },
          newForm,
          h('div.menu-load',
            h('h2', 'Reprendre'),
            canResume ? h('button.btn.big', { on: { click: () => { this.hide(); this.onClose(); } } }, 'Retour à la partie en cours') : null,
            latest ? h('button.btn.big', { on: { click: () => { this.hide(); this.onContinue(latest.id); } } }, `Continuer « ${latest.name} »`, h('small', `${latest.summary.date} · ${formatNumber(latest.summary.population)} hab.`)) : h('p.hint', 'Aucune partie sauvegardée dans ce navigateur.'),
            items.slice(1, 5).map((it) => h('button.btn.ghost', { on: { click: () => { this.hide(); this.onLoad(it.id); } } }, it.name, h('small', ` ${it.summary.date}`)))
          )
        ),
        installBox,
        h('p.menu-foot', 'Toutes les données restent dans votre navigateur. Aucun compte, aucun service distant.')
      )
    );
    this.offInstall?.();
    this.offInstall = this.install?.onChange(() => {
      const box = this.#installBox();
      this.root.querySelector('.install-box')?.replaceWith(box ?? h('span.install-box'));
    });
  }

  /** Encart d'installation de l'application (Android / ordinateur : bouton ; iPhone : marche à suivre). */
  #installBox() {
    const mode = this.install?.mode;
    if (mode === 'prompt') {
      return h('div.install-box',
        h('div', h('strong', 'Installer URBIS 2030'), h('small', 'Jeu en plein écran, disponible hors ligne, lancé depuis l\'écran d\'accueil.')),
        h('button.btn.primary', { type: 'button', on: { click: () => this.install.prompt() } }, 'Installer'));
    }
    if (mode === 'ios') {
      return h('div.install-box',
        h('div', h('strong', 'Installer sur iPhone ou iPad'), h('small', 'Dans Safari : bouton Partager ', h('span.ios-share', { 'aria-hidden': 'true' }, '⬆'), ' puis « Sur l\'écran d\'accueil ». Le jeu s\'ouvrira en plein écran, même hors ligne.')));
    }
    return h('span.install-box', { hidden: true });
  }

  hide() {
    this.root.classList.remove('open');
  }

  get visible() {
    return this.root.classList.contains('open');
  }
}
