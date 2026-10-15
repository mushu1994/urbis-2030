import { h, setChildren } from './dom.js';
import { GUIDE } from './GuideContent.js';
import { contentDialog } from './Dialog.js';

const READ_KEY = 'urbis2030.guideRead';

function readSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function markRead(id) {
  try {
    const s = readSet();
    s.add(id);
    localStorage.setItem(READ_KEY, JSON.stringify([...s]));
  } catch {
    /* stockage indisponible : la progression n'est simplement pas retenue */
  }
}

/**
 * Contenu du guide : sommaire (chapitres lus cochés) et chapitre courant, avec boutons « Montre-moi ».
 * @param {{chapter:string, onChapter:(id:string)=>void, onAction?:((a:any)=>void)|null}} p
 */
export function renderGuide({ chapter, onChapter, onAction = null }) {
  const k = Math.max(0, GUIDE.findIndex((c) => c.id === chapter));
  const c = GUIDE[k];
  markRead(c.id);
  const read = readSet();
  const toc = h('nav.guide-toc', { 'aria-label': 'Chapitres du guide' },
    GUIDE.map((g, i) => h('button.guide-chapter', {
      type: 'button',
      class: [g.id === c.id ? 'active' : '', read.has(g.id) ? 'read' : ''].join(' '),
      'aria-current': g.id === c.id ? 'page' : 'false',
      on: { click: () => onChapter(g.id) }
    }, h('span.num', String(i + 1)), h('span', g.title), read.has(g.id) ? h('span.check', { 'aria-label': 'lu' }, '✓') : null)));
  const body = h('article.guide-body',
    h('p.guide-step', `Chapitre ${k + 1} sur ${GUIDE.length} · ${read.size} lu${read.size > 1 ? 's' : ''}`),
    h('h3', c.title),
    h('p.guide-intro', c.intro),
    c.sections.map((s) => h('section.guide-section',
      h('h4', s.title),
      h('ul', s.items.map((it) => h('li', it))),
      s.show?.length
        ? h('div.guide-show', onAction
          ? s.show.map((a) => h('button.btn.small', { type: 'button', on: { click: () => onAction(a) } }, `Montre-moi : ${a.label}`))
          : h('small.hint', `En partie : ${s.show.map((a) => a.label).join(', ')}.`))
        : null)),
    h('footer.guide-nav',
      h('button.btn', { type: 'button', disabled: k === 0, on: { click: () => onChapter(GUIDE[k - 1].id) } }, '← Précédent'),
      k < GUIDE.length - 1
        ? h('button.btn.primary', { type: 'button', on: { click: () => onChapter(GUIDE[k + 1].id) } }, `Suivant : ${GUIDE[k + 1].title} →`)
        : h('span.hint', 'Fin du guide. Bonne gestion, Monsieur le maire !')));
  return h('div.guide', toc, body);
}

/**
 * Guide du maire (v0.9, touche G) : tutoriel détaillé en chapitres, dans un panneau de gestion.
 * « Montre-moi » ferme le panneau et ouvre l'outil, le panneau ou la couche concernés.
 */
export class GuidePanel {
  constructor({ onAction }) {
    this.id = 'guide';
    this.title = 'Guide du maire — comment fonctionne le jeu';
    this.static = true;
    this.onAction = onAction;
    this.chapter = GUIDE[0].id;
  }

  render(_session, _tab, rerender) {
    return renderGuide({
      chapter: this.chapter,
      onChapter: (id) => {
        this.chapter = id;
        rerender();
        // Nouveau chapitre : retour en haut de la page
        if (typeof document !== 'undefined') document.querySelector('#panel-host .win-body')?.scrollTo?.(0, 0);
      },
      onAction: (a) => this.onAction(a)
    });
  }
}

/** Guide affiché depuis l'écran d'accueil (hors partie) : même contenu, sans actions. */
export function openGuideDialog(chapter = GUIDE[0].id) {
  const host = h('div.guide-dialog');
  let d = null;
  const close = h('button.btn.small', { type: 'button', on: { click: () => d?.close() } }, 'Fermer');
  const show = (id) => {
    setChildren(host, h('div.guide-dialog-head', h('h2', 'Guide du maire'), close), renderGuide({ chapter: id, onChapter: show }));
    host.closest('.dialog')?.scrollTo?.(0, 0);
  };
  show(chapter);
  d = contentDialog(host, { wide: true });
  return d;
}
