import { h, icon, setChildren } from './dom.js';

const FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'pending', label: 'À traiter' },
  { id: 'alerts', label: 'Alertes' }
];

const ago = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return 'à l\'instant';
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const hr = Math.round(m / 60);
  return `il y a ${hr} h`;
};

/**
 * v1.6 : déroulé des notifications (bouton cloche, en haut à droite). Liste la plus récente en tête, avec la date
 * de jeu, les notifications encore à traiter et leurs actions (« Voir », « Ouvrir »).
 */
export class NotificationHistory {
  /**
   * @param {HTMLElement} host conteneur (zone de jeu)
   * @param {import('./Notifications.js').Notifications} notifications
   * @param {{onToggle?:(open:boolean)=>void}} [opts]
   */
  constructor(host, notifications, { onToggle } = {}) {
    this.notifications = notifications;
    this.onToggle = onToggle;
    this.filter = 'all';
    this.list = h('div.nh-list');
    this.tabs = h('div.nh-filters', { role: 'tablist' });
    this.root = h('section#notif-history', { 'aria-label': 'Déroulé des notifications', hidden: true },
      h('header.nh-head',
        h('h3', 'Notifications'),
        h('button.btn.small', { type: 'button', on: { click: () => { this.notifications.clearLog(); this.render(); } } }, 'Vider'),
        h('button.toast-close', { type: 'button', 'aria-label': 'Fermer le déroulé', on: { click: () => this.close() } }, icon('close', 16))),
      this.tabs,
      this.list);
    host.append(this.root);
    // Un appui hors du déroulé le referme (sauf sur le bouton cloche, qui gère lui-même la bascule)
    document.addEventListener('pointerdown', (e) => {
      if (!this.isOpen) return;
      if (this.root.contains(e.target) || e.target.closest?.('.hud-bell')) return;
      this.close();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    }, true);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.root.hidden = false;
    this.render();
    this.notifications.markAllRead();
    this.onToggle?.(true);
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.onToggle?.(false);
  }

  /** Redessine si le déroulé est ouvert (appelé à chaque nouvelle notification). */
  refresh() {
    if (this.isOpen) {
      this.render();
      this.notifications.markAllRead();
    }
  }

  render() {
    const log = this.notifications.log;
    const pending = log.filter((e) => e.pending).length;
    setChildren(this.tabs, FILTERS.map((f) => h('button.nh-tab', {
      type: 'button',
      role: 'tab',
      'aria-selected': String(this.filter === f.id),
      class: this.filter === f.id ? 'active' : '',
      on: { click: () => { this.filter = f.id; this.render(); } }
    }, f.label, f.id === 'pending' && pending ? h('span.nh-count', String(pending)) : null)));
    const items = log.filter((e) => (this.filter === 'pending' ? e.pending : this.filter === 'alerts' ? e.level === 'warning' || e.level === 'danger' : true));
    if (!items.length) {
      setChildren(this.list, h('p.empty', this.filter === 'pending' ? 'Rien à traiter pour le moment.' : 'Aucune notification pour le moment.'));
      return;
    }
    const now = Date.now();
    setChildren(this.list, items.map((e) => h('article.nh-item', { class: `${e.level}${e.pending ? ' pending' : ''}` },
      h('div.nh-meta',
        e.pending ? h('span.toast-flag', 'À traiter') : null,
        h('small', [e.date, ago(now - e.at)].filter(Boolean).join(' · ')),
        e.count > 1 ? h('small.nh-times', `×${e.count}`) : null),
      h('p', e.message),
      h('div.toast-actions', this.notifications.actionsFor(e, () => this.close())))));
  }
}
