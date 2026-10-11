import { h, icon, setChildren } from './dom.js';
import { objectivesProgress } from '../app/Objectives.js';

/**
 * Carte « Objectifs » : le tutoriel intégré. Affiche l'objectif en cours, son explication,
 * et la liste complète sur demande. L'état d'affichage est enregistré avec la partie.
 */
export class ObjectivesCard {
  /**
   * @param {HTMLElement} root
   * @param {{notify:(level:string, msg:string)=>void}} deps
   */
  constructor(root, { notify }) {
    this.root = root;
    this.notify = notify;
    this.session = null;
    this.doneIds = null;
  }

  attach(session) {
    this.session = session;
    this.doneIds = null;
    session.state.meta.objectives ??= { hidden: false, expanded: false };
    this.update(true);
  }

  #prefs() {
    return this.session.state.meta.objectives;
  }

  show() {
    if (!this.session) return;
    this.#prefs().hidden = false;
    this.update(true);
  }

  update(force = false) {
    const s = this.session;
    if (!s) return;
    const prefs = this.#prefs();
    const p = objectivesProgress(s.state, { catalog: s.catalog, network: s.sim.network });
    // Objectifs nouvellement atteints : notification (sauf au premier affichage)
    const ids = new Set(p.items.filter((o) => o.done).map((o) => o.id));
    if (this.doneIds) {
      for (const o of p.items) if (o.done && !this.doneIds.has(o.id)) this.notify('success', `Objectif atteint : ${o.title}`);
    }
    const changed = !this.doneIds || ids.size !== this.doneIds.size;
    this.doneIds = ids;
    if (!changed && !force) return;
    this.root.hidden = prefs.hidden;
    if (prefs.hidden) return;
    const toggle = () => {
      prefs.expanded = !prefs.expanded;
      this.update(true);
    };
    setChildren(
      this.root,
      h('header.obj-head',
        h('button.obj-title', { 'aria-expanded': String(!!prefs.expanded), on: { click: toggle } },
          h('span', 'Objectifs'), h('small', `${p.done} / ${p.total}`)),
        h('button.obj-close', { 'aria-label': 'Masquer les objectifs', title: 'Masquer (réaffichables depuis l\'aide)', on: { click: () => { prefs.hidden = true; this.update(true); } } }, icon('close', 14))
      ),
      h('div.obj-bar', h('div', { style: { width: `${(p.done / p.total) * 100}%` } })),
      p.current
        ? h('div.obj-current', h('strong', p.current.title), h('p', p.current.hint))
        : h('div.obj-current', h('strong', 'Tous les objectifs sont atteints'), h('p', 'La ville est à vous. Visez l\'ère « Ville symbiotique » !')),
      prefs.expanded
        ? h('ul.checks.obj-list', p.items.map((o) => h('li', { class: o.done ? 'ok' : 'ko' }, h('span', o.done ? '✓' : '○'), h('span', o.title))))
        : null
    );
  }
}
