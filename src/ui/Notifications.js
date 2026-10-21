import { h, icon } from './dom.js';

/** Notifications importantes (décision à prendre, problème à voir) affichées en permanence : deux au plus. */
const MAX_STICKY = 2;
/** Notifications ordinaires affichées en même temps (une seule sur téléphone, voir mobile.css). */
const MAX_FLOW = 2;
/** Taille de l'historique (déroulé des notifications de la partie). */
const MAX_LOG = 200;

/**
 * Notifications (v1.6 : coin supérieur droit, plus grandes, historique).
 *
 * - Une notification **importante** (décision à prendre, danger localisé, ou `decision`/`sticky` explicite) reste
 *   affichée tant qu'elle n'est pas traitée : deux au plus ; la plus ancienne retourne dans l'historique (toujours
 *   « à traiter ») quand une troisième arrive. Elle se résout en suivant son action (« Voir », « Ouvrir »), en la
 *   fermant, ou quand le joueur règle la question ailleurs (`resolve`).
 * - Les autres disparaissent après 7 à 14 secondes selon leur niveau (le pointeur posé dessus les retient).
 * - Toutes sont consignées dans le **déroulé** (bouton cloche de la barre du haut), avec la date de jeu.
 * - Les messages identiques sont fusionnés (×2, ×3…) ; un glissement latéral ferme une notification.
 * - Elles restent sous les menus et les panneaux : elles ne bloquent jamais un choix.
 */
export class Notifications {
  /**
   * @param {HTMLElement} root
   * @param {{onLocate?:(x:number,y:number)=>void, onPanel?:(id:string, tab?:string)=>void, getDate?:()=>string, onChange?:()=>void}} [opts]
   */
  constructor(root, { onLocate, onPanel, getDate, onChange } = {}) {
    this.root = root;
    this.onLocate = onLocate;
    this.onPanel = onPanel;
    this.getDate = getDate;
    this.onChange = onChange;
    this.lastByKey = new Map();
    /** @type {any[]} notifications affichées */
    this.items = [];
    /** @type {any[]} déroulé (plus récent en tête) */
    this.log = [];
    this.nextId = 1;
    /** Durée d'affichage (ms) des notifications ordinaires, par niveau. */
    this.ttl = { info: 7000, success: 7000, warning: 10000, danger: 14000 };
    this.root.setAttribute('aria-live', 'polite');
    this.stickyBox = h('div.toast-sticky');
    this.flowBox = h('div.toast-flow');
    this.clearBtn = h('button.toast-clear', { type: 'button', on: { click: () => this.clear() } }, 'Tout effacer');
    this.root.append(this.stickyBox, this.flowBox);
  }

  /** Une notification est-elle importante (affichée tant qu'elle n'est pas traitée) ? */
  static isImportant(n) {
    if (n.sticky === false) return false;
    if (n.decision || n.sticky) return true;
    const actionable = (Number.isInteger(n.x) && Number.isInteger(n.y)) || !!n.panel;
    return n.level === 'danger' && actionable;
  }

  /** Retient les notifications (soirée électorale : rien ne doit dévoiler le résultat avant le dépouillement). */
  hold() {
    this.queue ??= [];
    // Filet de sécurité : jamais plus d'une minute de silence
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => this.release(), 60_000);
  }

  /** Libère les notifications retenues. */
  release() {
    clearTimeout(this.holdTimer);
    const q = this.queue ?? [];
    this.queue = null;
    for (const n of q) this.push(n);
  }

  push(n) {
    if (this.queue) {
      this.queue.push(n);
      return;
    }
    const { level = 'info', message, x, y, key, panel, tab, action } = n;
    if (!message) return;
    const now = performance.now();
    if (key) {
      const last = this.lastByKey.get(key);
      if (last && now - last < 8000) return;
      this.lastByKey.set(key, now);
    }
    const important = Notifications.isImportant(n);
    // Message déjà affiché : on incrémente son compteur et on prolonge son affichage
    const same = this.items.find((it) => it.message === message);
    if (same) {
      same.count++;
      same.entry.count = same.count;
      same.entry.read = false;
      same.el.querySelector('.toast-count').textContent = `×${same.count}`;
      (same.sticky ? this.stickyBox : this.flowBox).prepend(same.el);
      if (!same.sticky) this.#arm(same, level);
      this.#changed();
      return;
    }
    const hasPos = Number.isInteger(x) && Number.isInteger(y);
    const entry = {
      id: this.nextId++,
      level,
      message,
      count: 1,
      date: this.getDate?.() ?? '',
      at: Date.now(),
      x: hasPos ? x : null,
      y: hasPos ? y : null,
      panel: panel ?? null,
      tab: tab ?? null,
      action: action ?? null,
      important,
      pending: important,
      read: false
    };
    this.log.unshift(entry);
    if (this.log.length > MAX_LOG) this.log.length = MAX_LOG;
    const item = { el: null, message, count: 1, timer: null, sticky: important, entry };
    const primary = this.#primary(entry, () => this.dismiss(item));
    const el = h('div.toast', { class: `${level}${important ? ' important' : ''}`, role: important ? 'alert' : 'status', title: important ? 'Action requise' : 'Cliquer pour fermer' },
      important ? h('span.toast-flag', 'À traiter') : null,
      h('span.toast-msg', message),
      h('span.toast-count'),
      h('div.toast-actions', this.#actions(entry, () => this.dismiss(item, false, true))),
      h('button.toast-close', { type: 'button', 'aria-label': 'Fermer la notification', on: { click: (e) => { e.stopPropagation(); this.dismiss(item, false, true); } } }, icon('close', 14))
    );
    item.el = el;
    // Un clic sur une notification importante suit son action principale ; sinon il la ferme
    el.addEventListener('click', () => (important && primary ? primary() : this.dismiss(item, false, important)));
    this.#swipe(el, item);
    this.items.unshift(item);
    if (important) {
      this.stickyBox.prepend(el);
      const stickies = this.items.filter((it) => it.sticky);
      // Au plus deux : la plus ancienne retourne dans le déroulé, toujours à traiter
      while (stickies.length > MAX_STICKY) this.dismiss(stickies.pop(), true, false);
    } else {
      this.flowBox.prepend(el);
      const flow = this.items.filter((it) => !it.sticky);
      while (flow.length > MAX_FLOW) this.dismiss(flow.pop(), true);
      this.#arm(item, level);
    }
    this.#updateClear();
    this.#changed();
  }

  /** Action principale d'une entrée (suivre « Voir », puis « Ouvrir »). */
  #primary(entry, after) {
    if (entry.x !== null && this.onLocate) return () => { this.markDone(entry); this.onLocate(entry.x, entry.y); after?.(); };
    if (entry.panel && this.onPanel) return () => { this.markDone(entry); this.onPanel(entry.panel, entry.tab ?? undefined); after?.(); };
    return null;
  }

  /** Boutons d'action d'une entrée (notification ou ligne du déroulé). */
  #actions(entry, after) {
    const out = [];
    if (entry.x !== null && this.onLocate) {
      out.push(h('button.link', { type: 'button', on: { click: (e) => { e.stopPropagation(); this.markDone(entry); this.onLocate(entry.x, entry.y); after?.(); } } }, 'Voir'));
    }
    if (entry.panel && this.onPanel) {
      out.push(h('button.link', { type: 'button', on: { click: (e) => { e.stopPropagation(); this.markDone(entry); this.onPanel(entry.panel, entry.tab ?? undefined); after?.(); } } }, entry.action ?? 'Ouvrir'));
    }
    return out;
  }

  /** Actions d'une ligne du déroulé (utilisées par le panneau d'historique). */
  actionsFor(entry, after) {
    return this.#actions(entry, after);
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
        this.dismiss(item, false, item.sticky);
      }
    });
    const end = () => {
      x0 = null;
      if (el.isConnected && !el.classList.contains('leaving')) el.style.transform = '';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /**
   * Retire une notification de l'écran (immédiatement si `instant`). `done` : le joueur l'a traitée (fermée ou
   * suivie) — une notification importante écartée sans être traitée reste « à traiter » dans le déroulé.
   */
  dismiss(item, instant = false, done = false) {
    const k = this.items.indexOf(item);
    if (k < 0) return;
    this.items.splice(k, 1);
    clearTimeout(item.timer);
    if (done) this.markDone(item.entry);
    if (instant) item.el.remove();
    else {
      item.el.classList.add('leaving');
      setTimeout(() => item.el.remove(), 300);
    }
    this.#updateClear();
    this.#changed();
  }

  /** Marque une entrée comme traitée. */
  markDone(entry) {
    if (!entry) return;
    entry.pending = false;
    entry.read = true;
    this.#changed();
  }

  /**
   * Résout les notifications importantes qui répondent au critère (question réglée ailleurs : demande d'un adjoint
   * acceptée depuis le panneau, polémique traitée, programme déposé…).
   * @param {(entry:any)=>boolean} match
   */
  resolve(match) {
    for (const it of [...this.items]) if (it.sticky && match(it.entry)) this.dismiss(it, false, true);
    for (const e of this.log) if (e.pending && match(e)) e.pending = false;
    this.#changed();
  }

  /** Ferme toutes les notifications affichées (les importantes restent à traiter dans le déroulé). */
  clear() {
    for (const it of [...this.items]) this.dismiss(it, true, !it.sticky);
  }

  /** Nouvelle partie : écran et déroulé vidés. */
  reset() {
    this.queue = null;
    clearTimeout(this.holdTimer);
    for (const it of [...this.items]) this.dismiss(it, true);
    this.log = [];
    this.lastByKey.clear();
    this.#changed();
  }

  /** Marque tout le déroulé comme lu (ouverture du panneau d'historique). */
  markAllRead() {
    for (const e of this.log) e.read = true;
    this.#changed();
  }

  /** Vide le déroulé (les notifications à traiter restent). */
  clearLog() {
    this.log = this.log.filter((e) => e.pending);
    this.#changed();
  }

  #updateClear() {
    // Le bouton reste en place (en fin de pile) tant qu'il est utile : jamais détaché sous le pointeur
    if (this.items.length >= 2) {
      if (!this.clearBtn.isConnected) this.root.append(this.clearBtn);
    } else this.clearBtn.remove();
  }

  #changed() {
    this.onChange?.();
  }

  get unread() {
    return this.log.filter((e) => !e.read).length;
  }

  get pending() {
    return this.log.filter((e) => e.pending).length;
  }

  get count() {
    return this.items.length;
  }
}
