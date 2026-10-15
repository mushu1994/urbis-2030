import { h, icon } from './dom.js';

const MAX_VISIBLE = 3;

/**
 * Notifications éphémères.
 * - Un clic (ou un appui) n'importe où sur une notification la ferme ; « Voir » centre la carte puis la ferme.
 * - Un glissement latéral la ferme aussi (écrans tactiles).
 * - Les messages identiques sont fusionnés (compteur ×2, ×3…) au lieu de s'empiler.
 * - « Tout effacer » apparaît dès que plusieurs notifications sont affichées.
 * - Elles restent sous les menus et les panneaux : elles ne bloquent jamais un choix.
 */
export class Notifications {
  /**
   * @param {HTMLElement} root
   * @param {{onLocate?:(x:number,y:number)=>void}} [opts]
   */
  constructor(root, { onLocate, onPanel } = {}) {
    this.root = root;
    this.onLocate = onLocate;
    this.onPanel = onPanel;
    this.lastByKey = new Map();
    /** @type {{el:HTMLElement, message:string, count:number, timer:any}[]} */
    this.items = [];
    /** Durée d'affichage (ms) par niveau. */
    this.ttl = { info: 4500, success: 4500, warning: 6000, danger: 8000 };
    this.root.setAttribute('aria-live', 'polite');
    this.clearBtn = h('button.toast-clear', { type: 'button', on: { click: () => this.clear() } }, 'Tout effacer');
  }

  push({ level = 'info', message, x, y, key, panel, tab }) {
    const now = performance.now();
    if (key) {
      const last = this.lastByKey.get(key);
      if (last && now - last < 8000) return;
      this.lastByKey.set(key, now);
    }
    // Message déjà affiché : on incrémente son compteur et on prolonge son affichage
    const same = this.items.find((it) => it.message === message);
    if (same) {
      same.count++;
      same.el.querySelector('.toast-count').textContent = `×${same.count}`;
      this.root.prepend(same.el);
      this.#arm(same, level);
      return;
    }
    const hasPos = Number.isInteger(x) && Number.isInteger(y);
    const item = { el: null, message, count: 1, timer: null };
    const el = h('div.toast', { class: level, role: 'status', title: 'Cliquer pour fermer' },
      h('span.toast-msg', message),
      h('span.toast-count'),
      hasPos && this.onLocate
        ? h('button.link', { type: 'button', on: { click: (e) => { e.stopPropagation(); this.onLocate(x, y); this.dismiss(item); } } }, 'Voir')
        : null,
      panel && this.onPanel
        ? h('button.link', { type: 'button', on: { click: (e) => { e.stopPropagation(); this.onPanel(panel, tab); this.dismiss(item); } } }, 'Ouvrir')
        : null,
      h('button.toast-close', { type: 'button', 'aria-label': 'Fermer la notification', on: { click: (e) => { e.stopPropagation(); this.dismiss(item); } } }, icon('close', 12))
    );
    item.el = el;
    el.addEventListener('click', () => this.dismiss(item));
    this.#swipe(el, item);
    this.items.unshift(item);
    this.root.prepend(el);
    while (this.items.length > MAX_VISIBLE) this.dismiss(this.items[this.items.length - 1], true);
    this.#arm(item, level);
    this.#updateClear();
  }

  #arm(item, level) {
    clearTimeout(item.timer);
    const ttl = this.ttl[level] ?? this.ttl.info;
    const expire = () => {
      // Le joueur est en train de lire (pointeur sur la pile) : on patiente
      if (this.root.matches(':hover')) item.timer = setTimeout(expire, 1500);
      else this.dismiss(item);
    };
    item.timer = setTimeout(expire, ttl);
  }

  #swipe(el, item) {
    let x0 = null;
    el.addEventListener('pointerdown', (e) => {
      x0 = e.clientX;
    });
    el.addEventListener('pointermove', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 6) el.style.transform = `translateX(${dx}px)`;
      if (Math.abs(dx) > 60) {
        x0 = null;
        this.dismiss(item);
      }
    });
    const end = () => {
      x0 = null;
      if (el.isConnected && !el.classList.contains('leaving')) el.style.transform = '';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** Ferme une notification (immédiatement si `instant`). */
  dismiss(item, instant = false) {
    const k = this.items.indexOf(item);
    if (k < 0) return;
    this.items.splice(k, 1);
    clearTimeout(item.timer);
    if (instant) item.el.remove();
    else {
      item.el.classList.add('leaving');
      setTimeout(() => item.el.remove(), 300);
    }
    this.#updateClear();
  }

  /** Ferme toutes les notifications affichées. */
  clear() {
    for (const it of [...this.items]) this.dismiss(it, true);
  }

  #updateClear() {
    // Le bouton reste en place (en fin de pile) tant qu'il est utile : jamais détaché sous le pointeur
    if (this.items.length >= 2) {
      if (!this.clearBtn.isConnected) this.root.append(this.clearBtn);
    } else this.clearBtn.remove();
  }

  get count() {
    return this.items.length;
  }
}
