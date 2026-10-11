import { h, icon, setChildren } from './dom.js';
import { formatMoney } from '../util/money.js';
import { isUnlocked } from '../systems/ConstructionService.js';
import { isCompact } from './layout.js';
import { renderToolSheet } from './BuildingSheet.js';

/**
 * Barre de construction : outils regroupés par catégorie, avec coût et conditions de déblocage.
 * Elle ne fait que choisir l'outil actif ; c'est GameApp qui applique les actions via la session.
 */
export class Toolbar {
  /**
   * @param {HTMLElement} root
   * @param {{catalog: import('../data/Catalog.js').Catalog, onTool:(tool:any)=>void, onPanel:(id:string)=>void, getState:()=>any}} deps
   */
  constructor(root, { catalog, onTool, onPanel, getState }) {
    this.catalog = catalog;
    this.onTool = onTool;
    this.getState = getState;
    this.activeTool = { id: 'select', kind: 'select', label: 'Sélection' };
    this.openCat = null;
    const plops = catalog.plopsByCategory();
    this.categories = [
      { id: 'select', label: 'Sélectionner', icon: 'select', key: 'Échap', tool: { id: 'select', kind: 'select', label: 'Sélection' } },
      {
        id: 'roads',
        label: 'Routes',
        icon: 'road',
        tools: catalog.roads.filter((r) => r.buildable).map((r) => ({ id: `road:${r.id}`, kind: 'road', roadId: r.id, label: r.name, cost: r.costCents, costUnit: '/case', unlock: r.unlock, desc: r.description }))
      },
      {
        id: 'zones',
        label: 'Zonage',
        icon: 'zone',
        tools: [
          ...catalog.zones.map((z) => ({ id: `zone:${z.id}`, kind: 'zone', zoneId: z.id, label: z.name, cost: z.costCents, costUnit: '/case', swatch: z.color })),
          { id: 'zone:none', kind: 'zone', zoneId: null, label: 'Retirer le zonage', cost: 0 }
        ]
      },
      ...[
        ['energy', 'Énergie', 'energy', ['energy']],
        ['water', 'Eau', 'water', ['water']],
        ['waste', 'Déchets', 'waste', ['waste']],
        ['services', 'Services publics', 'services', ['services']],
        ['parks', 'Parcs et loisirs', 'parks', ['parks']],
        ['transport', 'Transports et logistique', 'bus', ['transport', 'logistics']]
      ].map(([cat, label, ic, cats]) => ({
        id: cat,
        label,
        icon: ic,
        tools: [
          ...cats.flatMap((c) => plops.get(c) ?? []).map((d) => ({
            id: `building:${d.id}`,
            kind: 'building',
            defId: d.id,
            label: d.name,
            cost: d.costCents,
            upkeep: d.upkeepCents,
            unlock: d.unlock,
            desc: d.description,
            size: `${d.footprint.w}×${d.footprint.h}`
          })),
          ...(cat === 'transport'
            ? [
                { id: 'delivery:on', kind: 'deliveryZone', enabled: true, label: 'Zone de desserte drones', cost: 0, unlock: { tech: 'drone_delivery' }, desc: 'Autorise les livraisons par drones sur les cases tracées.' },
                { id: 'delivery:off', kind: 'deliveryZone', enabled: false, label: 'Retirer la desserte drones', cost: 0, unlock: { tech: 'drone_delivery' } }
              ]
            : [])
        ]
      })),
      { id: 'demolish', label: 'Démolir', icon: 'demolish', key: 'Suppr', tool: { id: 'demolish', kind: 'demolish', label: 'Démolition' } }
    ];

    this.catButtons = new Map();
    const tools = h(
      'div.toolbar-group',
      this.categories.map((c) => {
        const b = h('button.tool-btn', { title: `${c.label}${c.key ? ` (${c.key})` : ''}`, 'aria-label': c.label, on: { click: () => this.#clickCategory(c) } }, icon(c.icon, 22));
        this.catButtons.set(c.id, b);
        return b;
      })
    );
    const panels = h(
      'div.toolbar-group',
      [
        ['finance', 'Finances (B)', 'finance'],
        ['city', 'Ville (C)', 'city'],
        ['ai', 'IA et politiques (I)', 'ai'],
        ['layers', 'Couches de données (L)', 'layers'],
        ['saves', 'Sauvegardes (Ctrl+S)', 'save'],
        ['settings', 'Paramètres', 'settings'],
        ['help', 'Aide et raccourcis (H)', 'help']
      ].map(([id, title, ic]) => h('button.tool-btn.panel-btn', { title, 'aria-label': title, dataset: { panel: id }, on: { click: () => onPanel(id) } }, icon(ic, 20)))
    );
    this.flyout = h('div.flyout', { role: 'menu' });
    root.append(tools, panels);
    root.parentElement.append(this.flyout);
    this.#highlight();
  }

  #clickCategory(c) {
    if (c.tool) {
      this.select(c.tool);
      this.closeFlyout();
      return;
    }
    if (this.openCat === c.id) {
      this.closeFlyout();
      return;
    }
    this.openFlyout(c.id);
  }

  openFlyout(catId) {
    const c = this.categories.find((x) => x.id === catId);
    if (!c?.tools) return;
    this.openCat = catId;
    const state = this.getState();
    const btn = this.catButtons.get(catId);
    // Sur ordinateur, le menu s'ouvre à hauteur du bouton ; sur téléphone, il se place au-dessus de la barre (CSS).
    if (isCompact()) {
      this.flyout.style.top = '';
    } else {
      const top = btn.getBoundingClientRect().top - this.flyout.parentElement.getBoundingClientRect().top;
      this.flyout.style.top = `${Math.max(8, top - 8)}px`;
    }
    // Fiche descriptive : à droite de la liste sur ordinateur (survol ou focus), dépliable sous l'élément au doigt
    const compact = isCompact();
    const sheet = h('div.flyout-sheet', { 'aria-live': 'polite' });
    const showSheet = (t, u) => setChildren(sheet, renderToolSheet(t, this.catalog, u));
    const rows = c.tools.map((t) => {
      const u = state ? isUnlocked(state, t.unlock) : { ok: true };
      const affordable = !state || !t.cost || state.economy.treasury >= t.cost;
      const active = this.activeTool.id === t.id;
      const inline = h('div.fi-sheet', { hidden: true });
      const item = h(
        'button.flyout-item',
        {
          class: [active ? 'active' : '', !u.ok ? 'locked' : ''].join(' '),
          disabled: !u.ok,
          role: 'menuitem',
          on: {
            click: () => {
              this.select(t);
              this.closeFlyout();
            },
            mouseenter: () => !compact && showSheet(t, u),
            focus: () => !compact && showSheet(t, u)
          }
        },
        t.swatch ? h('i.swatch', { style: { background: t.swatch } }) : null,
        h('span.fi-name', t.label, t.size ? h('small', ` ${t.size}`) : null),
        h(
          'span.fi-cost',
          { class: affordable ? '' : 'neg' },
          !u.ok ? u.reason : t.cost ? `${formatMoney(t.cost)}${t.costUnit ?? ''}` : 'gratuit',
          t.upkeep && u.ok ? h('small', ` · ${formatMoney(t.upkeep)}/mois`) : null
        )
      );
      const info = h('button.fi-info', {
        type: 'button',
        'aria-label': `Fiche : ${t.label}`,
        'aria-expanded': 'false',
        title: 'Description et effets',
        on: {
          click: (e) => {
            e.stopPropagation();
            if (!compact) return showSheet(t, u);
            const open = inline.hidden;
            inline.hidden = !open;
            info.setAttribute('aria-expanded', String(open));
            if (open) setChildren(inline, renderToolSheet(t, this.catalog, u));
          }
        }
      }, 'i');
      // Le joueur peut consulter la fiche d'un bâtiment encore verrouillé
      return h('div.flyout-row', { class: !u.ok ? 'locked' : '' }, item, info, inline);
    });
    setChildren(
      this.flyout,
      h('div.flyout-title', c.label),
      h('div.flyout-body', h('div.flyout-list', rows), compact ? null : sheet)
    );
    if (!compact) {
      const first = c.tools.find((t) => t.id === this.activeTool.id) ?? c.tools[0];
      showSheet(first, state ? isUnlocked(state, first.unlock) : { ok: true });
    }
    this.flyout.classList.add('open');
    this.#highlight();
  }

  closeFlyout() {
    this.openCat = null;
    this.flyout.classList.remove('open');
    this.#highlight();
  }

  select(tool) {
    this.activeTool = tool;
    this.onTool(tool);
    this.#highlight();
  }

  /** Raccourci : ouvre une catégorie ou sélectionne directement un outil par identifiant. */
  selectById(id) {
    for (const c of this.categories) {
      if (c.tool?.id === id) return this.select(c.tool);
      const t = c.tools?.find((x) => x.id === id);
      if (t) return this.select(t);
    }
  }

  #highlight() {
    for (const c of this.categories) {
      const active = c.tool ? c.tool.id === this.activeTool.id : c.tools?.some((t) => t.id === this.activeTool.id);
      this.catButtons.get(c.id).classList.toggle('active', !!active);
      this.catButtons.get(c.id).classList.toggle('open', this.openCat === c.id);
    }
  }
}
