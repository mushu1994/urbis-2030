import { h, setChildren } from './dom.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { confirmDialog, textDialog, pasteDialog } from './Dialog.js';

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
      h('li', h('strong', 'Faites entrer la ville dans le futur. '), 'Technologies (I), puis ères « Ville autonome » et « Ville symbiotique » (C → Progression) : elles débloquent des bâtiments et des niveaux d\'habitation futuristes.')
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
  constructor({ settings, apply, onShowObjectives, onDebug }) {
    this.onShowObjectives = onShowObjectives;
    this.onDebug = onDebug;
    this.id = 'settings';
    this.title = 'Paramètres';
    this.static = true;
    this.settings = settings;
    this.apply = apply;
  }

  render() {
    const toggle = (key, label) => h('label.check', h('input', { type: 'checkbox', checked: !!this.settings.get(key), on: { change: (e) => { this.settings.set(key, e.target.checked); this.apply(); } } }), label);
    const select = (key, label, options) =>
      h('label.setting', h('span', label),
        h('select', { 'aria-label': label, on: { change: (e) => { this.settings.set(key, e.target.value === 'auto' ? 'auto' : Number(e.target.value)); this.apply(); } } },
          options.map(([v, l]) => h('option', { value: v, selected: String(this.settings.get(key)) === String(v) }, l))));
    return h('div.settings',
      h('h3', 'Affichage'),
      select('uiScale', 'Taille de l\'interface', [[0.9, '90 %'], [1, '100 %'], [1.15, '115 %'], [1.3, '130 %']]),
      select('renderScale', 'Qualité graphique (résolution)', [['auto', 'Automatique'], [1, 'Haute'], [0.75, 'Moyenne'], [0.5, 'Économie']]),
      toggle('showVehicles', 'Afficher les véhicules et les drones'),
      toggle('showGridLines', 'Afficher le quadrillage'),
      toggle('showFps', 'Afficher le compteur d\'images'),
      h('h3', 'Commandes'),
      toggle('edgeScroll', 'Défilement de la carte au bord de l\'écran'),
      toggle('confirmDemolish', 'Demander confirmation avant une démolition coûteuse'),
      h('h3', 'Aide et développement'),
      h('div.debug-actions',
        this.onShowObjectives ? h('button.btn', { on: { click: () => this.onShowObjectives() } }, 'Afficher les objectifs guidés') : null,
        this.onDebug ? h('button.btn', { on: { click: () => this.onDebug() } }, 'Outils de débogage (F3)') : null
      )
    );
  }
}

/**
 * Écran d'accueil : nouvelle partie, reprise, chargement.
 */
export class StartMenu {
  constructor(root, { onNew, onContinue, onLoad, onClose, saves }) {
    this.root = root;
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
    let latest = null;
    let items = [];
    try {
      items = await this.saves.list();
      latest = items[0] ?? null;
    } catch {
      /* IndexedDB indisponible : on propose seulement une nouvelle partie */
    }
    setChildren(this.root,
      h('div.menu-card',
        h('div.menu-brand', h('h1', 'URBIS', h('span', '2030')), h('p', 'Bâtissez, financez et administrez une ville transformée par l\'intelligence artificielle.')),
        h('div.menu-cols',
          h('form.menu-new', { on: { submit: (e) => { e.preventDefault(); this.hide(); this.onNew({ name: name.value.trim() || 'Nouvelle-Rive', seed: Number(seed.value) || 2030, size: Number(size.value), mode: mode.value }); } } },
            h('h2', 'Nouvelle partie'),
            h('label', 'Nom de la ville', name),
            h('div.row2', h('label', 'Carte', size), h('label', 'Graine', seed)),
            h('label', 'Départ', mode),
            h('button.btn.primary.big', { type: 'submit' }, 'Fonder la ville')
          ),
          h('div.menu-load',
            h('h2', 'Reprendre'),
            canResume ? h('button.btn.big', { on: { click: () => { this.hide(); this.onClose(); } } }, 'Retour à la partie en cours') : null,
            latest ? h('button.btn.big', { on: { click: () => { this.hide(); this.onContinue(latest.id); } } }, `Continuer « ${latest.name} »`, h('small', `${latest.summary.date} · ${formatNumber(latest.summary.population)} hab.`)) : h('p.hint', 'Aucune partie sauvegardée dans ce navigateur.'),
            items.slice(1, 5).map((it) => h('button.btn.ghost', { on: { click: () => { this.hide(); this.onLoad(it.id); } } }, it.name, h('small', ` ${it.summary.date}`)))
          )
        ),
        h('p.menu-foot', 'Toutes les données restent dans votre navigateur. Aucun compte, aucun service distant.')
      )
    );
  }

  hide() {
    this.root.classList.remove('open');
  }

  get visible() {
    return this.root.classList.contains('open');
  }
}
