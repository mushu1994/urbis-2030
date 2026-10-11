import { h, setChildren } from './dom.js';
import { OVERLAYS, OVERLAY_BY_ID } from '../rendering/Overlays.js';

const css = (c) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Sélecteur de couches cartographiques et légende.
 */
export class OverlayManager {
  /**
   * @param {HTMLElement} root
   * @param {{onChange:(id:string|null)=>void}} p
   */
  constructor(root, { onChange }) {
    this.root = root;
    this.onChange = onChange;
    this.current = null;
    this.expanded = false;
    this.render();
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
    this.set(ids[(k + 1) % ids.length]);
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
          h('button.ov-item', { class: !this.current ? 'active' : '', on: { click: () => this.set(null) } }, 'Vue normale'),
          OVERLAYS.map((o) => h('button.ov-item', { class: this.current === o.id ? 'active' : '', on: { click: () => this.set(o.id) } }, o.label)))
        : null,
      h('div.ov-bar',
        h('button.ov-toggle', { 'aria-expanded': String(this.expanded), on: { click: () => this.toggleExpanded() } }, ov ? ov.label : 'Couches de données'),
        ov ? h('button.ov-clear', { 'aria-label': 'Masquer la couche', on: { click: () => this.set(null) } }, '×') : null
      ),
      legend
    );
  }

  #legend(ov) {
    const L = ov.legend ?? {};
    if (L.swatches) return h('div.ov-legend', L.swatches.map(([c, label]) => h('span.sw', h('i', { style: { background: css(c) } }), label)));
    const grad = `linear-gradient(90deg, ${L.ramp.map(css).join(', ')})`;
    return h('div.ov-legend', h('div.ov-ramp', { style: { background: grad } }), h('div.ov-scale', h('span', L.min), h('span', L.max)), L.note ? h('small', L.note) : null);
  }
}
