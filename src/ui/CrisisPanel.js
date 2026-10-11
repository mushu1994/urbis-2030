import { h, icon, setChildren } from './dom.js';
import { CRISIS_TYPES, responseCost } from '../simulation/CrisisSystem.js';
import { formatMoney } from '../util/money.js';
import { toCents } from '../util/money.js';

/**
 * Bandeau des crises en cours : décision à prendre (deux réponses chiffrées), puis suivi compact
 * (jours restants, réponse choisie, bouton « Voir »).
 */
export class CrisisPanel {
  /**
   * @param {HTMLElement} root
   * @param {{execute:(cmd:any)=>any, notify:(l:string,m:string)=>void, onFocus:(x:number,y:number)=>void, onDecided:()=>void, play:(n:string)=>void}} deps
   */
  constructor(root, deps) {
    this.root = root;
    this.deps = deps;
    this.session = null;
    this.sig = '';
    this.collapsed = new Set();
  }

  attach(session) {
    this.session = session;
    this.sig = '';
    this.collapsed.clear();
    this.update(session, { force: true });
  }

  update(session = this.session, { force = false } = {}) {
    if (!session) return;
    const s = session.state;
    const active = s.crises?.active ?? [];
    const t = s.time.tick;
    const sig = active.map((c) => `${c.id}:${c.response ?? ''}:${Math.max(0, c.until - t)}:${this.collapsed.has(c.id)}`).join('|');
    if (!force && sig === this.sig) return;
    this.sig = sig;
    this.root.hidden = active.length === 0;
    if (!active.length) {
      setChildren(this.root);
      return;
    }
    setChildren(this.root, active.map((c) => this.#card(s, c)));
  }

  #card(s, c) {
    const type = CRISIS_TYPES[c.kind];
    const left = Math.max(0, c.until - s.time.tick);
    const leftText = c.kind === 'fire' ? `${Object.keys(c.burning ?? {}).length} bâtiment(s) en feu` : `${left} jour${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}`;
    const locate = Number.isInteger(c.x)
      ? h('button.btn.small', { type: 'button', on: { click: () => this.deps.onFocus(c.x, c.y) } }, icon('focus', 14), 'Voir')
      : null;
    if (c.response || this.collapsed.has(c.id)) {
      const chosen = type.responses.find((r) => r.id === c.response);
      return h('div.crisis-pill', { class: type.level, role: 'status' },
        h('span.crisis-icon', { 'aria-hidden': 'true' }, type.icon),
        h('strong', type.name),
        h('span.crisis-left', leftText),
        chosen ? h('span.crisis-choice', chosen.label) : h('button.link', { type: 'button', on: { click: () => { this.collapsed.delete(c.id); this.update(this.session, { force: true }); } } }, 'Décider'),
        locate
      );
    }
    const options = type.responses.map((r) => {
      const euros = responseCost(s, c, r.id);
      const cost = euros > 0 ? formatMoney(toCents(euros)) : 'gratuit';
      const affordable = euros <= 0 || s.economy.treasury >= toCents(euros);
      return h('button.crisis-option', {
        type: 'button',
        disabled: !affordable,
        title: affordable ? r.detail : 'Trésorerie insuffisante',
        on: {
          click: () => {
            const res = this.deps.execute({ type: 'crisisResponse', crisisId: c.id, option: r.id });
            if (!res?.ok) this.deps.notify('warning', res?.reason ?? 'Décision impossible');
            else {
              this.deps.notify('info', `${type.name} : ${r.label}`);
              this.deps.onDecided();
            }
            this.update(this.session, { force: true });
          }
        }
      }, h('strong', r.label), h('small', r.detail), h('span.crisis-cost', cost));
    });
    return h('section.crisis-card', { class: type.level, role: 'alertdialog', 'aria-label': type.name },
      h('header',
        h('span.crisis-icon', { 'aria-hidden': 'true' }, type.icon),
        h('div', h('h3', type.name), h('small', leftText)),
        locate,
        h('button.crisis-later', { type: 'button', title: 'Décider plus tard', 'aria-label': 'Réduire', on: { click: () => { this.collapsed.add(c.id); this.deps.onDecided(); this.update(this.session, { force: true }); } } }, icon('close', 14))
      ),
      h('p', type.summary),
      h('p.crisis-hint', h('strong', 'Prévention : '), type.mitigation),
      h('div.crisis-options', options)
    );
  }
}
