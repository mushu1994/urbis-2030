import { h, icon, setChildren } from './dom.js';
import { objectivesProgress } from '../app/Objectives.js';
import { formatMonths } from '../simulation/ScenarioSystem.js';

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
    this.sig = '';
    this.root.classList.toggle('scenario', !!session.state.scenario);
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
    if (s.state.scenario) return this.#scenario(force);
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

  /** Carte du scénario en cours : objectifs chiffrés, échéance, règles d'échec. */
  #scenario(force) {
    const s = this.session;
    const sc = s.state.scenario;
    const prefs = this.#prefs();
    const p = s.sim.scenario.progress(s.state);
    const sig = `${sc.status}:${p.monthsLeft}:${p.goals.map((g) => `${g.ok}${g.text}`).join(',')}:${p.fails.map((f) => f.streak).join(',')}:${prefs.hidden}:${prefs.expanded}`;
    if (!force && sig === this.sig) return;
    this.sig = sig;
    this.root.hidden = prefs.hidden;
    this.root.classList.add('scenario');
    if (prefs.hidden) return;
    const expanded = prefs.expanded ?? (typeof window === 'undefined' || window.innerWidth > 760);
    const toggle = () => {
      prefs.expanded = !expanded;
      this.update(true);
    };
    const status = sc.status === 'won' ? h('p.obj-result.ok', '★ Scénario réussi') : sc.status === 'lost' ? h('p.obj-result.ko', `✕ Scénario échoué — ${sc.reason}`) : null;
    const urgent = sc.status === 'active' && p.monthsLeft <= 6;
    setChildren(
      this.root,
      h('header.obj-head',
        h('button.obj-title', { 'aria-expanded': String(expanded), on: { click: toggle } },
          h('span', sc.name), h('small', `${p.done} / ${p.total}`)),
        h('button.obj-close', { 'aria-label': 'Masquer le scénario', title: 'Masquer (réaffichable depuis l\'aide)', on: { click: () => { prefs.hidden = true; this.update(true); } } }, icon('close', 14))
      ),
      h('div.obj-bar', h('div', { style: { width: `${(p.done / p.total) * 100}%` } })),
      status ?? h('p.obj-deadline', { class: urgent ? 'urgent' : '' }, `Échéance : ${formatMonths(p.monthsLeft)}`),
      expanded
        ? h('ul.checks.obj-list.scenario-goals', p.goals.map((g) => h('li', { class: g.ok ? 'ok' : 'ko' },
          h('span', g.ok ? '✓' : '○'),
          h('span', g.label, h('small', g.metric === 'policy' ? ` — ${g.text}` : ` — actuellement ${g.text}`)))))
        : null,
      expanded
        ? p.fails.filter((f) => f.streak > 0 && sc.status === 'active').map((f) => h('p.obj-fail', `⚠ ${f.label} (${f.streak} / ${f.months} mois)`))
        : null
    );
  }
}
