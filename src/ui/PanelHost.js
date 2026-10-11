import { h, icon, setChildren } from './dom.js';

/**
 * Fenêtre de gestion (une à la fois), avec onglets.
 * Un panneau fournit : { id, title, tabs?: [{id,label}], render(session, tabId) → Node }.
 * Le contenu est rafraîchi périodiquement, sauf pendant une saisie de l'utilisateur.
 */
export class PanelHost {
  constructor(root) {
    this.root = root;
    this.panel = null;
    this.tab = null;
    this.session = null;
    this.body = h('div.win-body');
    this.tabsEl = h('nav.win-tabs', { role: 'tablist' });
    this.titleEl = h('h2.win-title');
    this.win = h('section.win', { role: 'dialog', 'aria-modal': 'false' },
      h('header.win-head', this.titleEl, h('button.panel-close', { 'aria-label': 'Fermer', on: { click: () => this.close() } }, icon('close', 16))),
      this.tabsEl,
      this.body
    );
    root.append(this.win);
    this.pressed = false;
    this.body.addEventListener('pointerdown', () => (this.pressed = true));
    window.addEventListener('pointerup', () => (this.pressed = false));
    window.addEventListener('pointercancel', () => (this.pressed = false));
  }

  get openId() {
    return this.panel?.id ?? null;
  }

  toggle(panel, session) {
    if (this.panel?.id === panel.id) this.close();
    else this.open(panel, session);
  }

  open(panel, session, tab) {
    this.panel = panel;
    this.session = session;
    this.tab = tab ?? panel.tabs?.[0]?.id ?? null;
    this.root.classList.add('open');
    this.titleEl.textContent = panel.title;
    this.#renderTabs();
    this.refresh(true);
  }

  #renderTabs() {
    setChildren(
      this.tabsEl,
      (this.panel.tabs ?? []).map((t) =>
        h('button.win-tab', {
          role: 'tab',
          'aria-selected': String(t.id === this.tab),
          class: t.id === this.tab ? 'active' : '',
          on: {
            click: () => {
              this.tab = t.id;
              this.#renderTabs();
              this.refresh(true);
            }
          }
        }, t.label)
      )
    );
  }

  close() {
    this.panel = null;
    this.root.classList.remove('open');
    setChildren(this.body);
  }

  /** @param {boolean} force rafraîchit même si l'utilisateur interagit avec un champ */
  refresh(force = false) {
    if (!this.panel || !this.session) return;
    const active = document.activeElement;
    if (!force && active && this.body.contains(active) && /INPUT|SELECT|TEXTAREA/.test(active.tagName)) return;
    if (!force && this.panel.static) return;
    // Pas de mise à jour automatique sous le pointeur (bouton survolé, clic en cours) : le clic ne doit pas être perdu.
    if (!force && (this.pressed || this.body.querySelector(':is(button, input, select, label, summary):hover'))) return;
    const scroll = this.body.scrollTop;
    setChildren(this.body, this.panel.render(this.session, this.tab, () => this.refresh(true)));
    this.body.scrollTop = scroll;
  }
}
