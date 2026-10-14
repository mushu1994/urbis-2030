import { h, setChildren } from './dom.js';
import { OVERLAYS, OVERLAY_BY_ID } from '../rendering/Overlays.js';

/** Couches regroupées par thème, dans l'ordre d'apparition. */
function groupsOf(list) {
  const m = new Map();
  for (const o of list) {
    const k = o.group ?? 'Autres';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(o);
  }
  return [...m];
}

const css = (c) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Sélecteur de couches cartographiques et légende.
 */
export class OverlayManager {
  /**
   * @param {HTMLElement} root
   * @param {{onChange:(id:string|null)=>void}} p
   */
  constructor(root, { onChange, onUser = null }) {
    this.root = root;
    this.onChange = onChange;
    this.onUser = onUser;
    this.current = null;
    this.expanded = false;
    this.render();
  }

  /** Choix fait par le joueur (liste, croix, raccourci). */
  pick(id) {
    this.onUser?.();
    this.set(id);
  }

  set(id) {
    this.current = id;
    this.onChange(id);
    this.render();
  }

  toggleExpanded(force) {
    this.expanded = force ?? !this.expanded;
    this.render();
  }

  /** Couche suivante (raccourci clavier). */
  cycle() {
    const ids = [null, ...OVERLAYS.map((o) => o.id)];
    const k = ids.indexOf(this.current);
    this.pick(ids[(k + 1) % ids.length]);
    this.expanded = true;
    this.render();
  }

  render() {
    const ov = this.current ? OVERLAY_BY_ID.get(this.current) : null;
    const legend = ov ? this.#legend(ov) : null;
    setChildren(
      this.root,
      this.expanded
        ? h('div.ov-list', { role: 'listbox', 'aria-label': 'Couches de données' },
          h('button.ov-item', { class: !this.current ? 'active' : '', on: { click: () => this.pick(null) } }, 'Vue normale'),
          groupsOf(OVERLAYS).flatMap(([group, list]) => [
            h('div.ov-group', group),
            ...list.map((o) => h('button.ov-item', { class: this.current === o.id ? 'active' : '', dataset: { ov: o.id }, on: { click: () => this.pick(o.id) } }, o.label))
          ]))
        : null,
      h('div.ov-bar',
        h('button.ov-toggle', { 'aria-expanded': String(this.expanded), on: { click: () => this.toggleExpanded() } }, ov ? ov.label : 'Couches de données'),
        ov ? h('button.ov-clear', { 'aria-label': 'Masquer la couche', on: { click: () => this.pick(null) } }, '×') : null
      ),
      legend
    );
  }

  #legend(ov) {
    const L = ov.legend ?? {};
    const swatches = (L.swatches ?? []).map(([c, label]) => h('span.sw', h('i', { style: { background: css(c) } }), label));
    if (!L.ramp) return h('div.ov-legend', swatches, L.note ? h('small', L.note) : null);
    const grad = `linear-gradient(90deg, ${L.ramp.map(css).join(', ')})`;
    return h('div.ov-legend', h('div.ov-ramp', { style: { background: grad } }), h('div.ov-scale', h('span', L.min), h('span', L.max)), swatches, L.note ? h('small', L.note) : null);
  }
}
