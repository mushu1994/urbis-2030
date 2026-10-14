import { h, icon, setChildren } from './dom.js';
import { formatMoney } from '../util/money.js';
import { isUnlocked, TERRAFORM, ROAD_DEMOLITION_CENTS } from '../systems/ConstructionService.js';
import { toCents } from '../util/money.js';

const TERRAFORM_DESC = {
  raise: 'Glissez pour élever les cases d\'un niveau (roche : coût doublé). Les cases bâties et les routes sont ignorées.',
  lower: 'Glissez pour abaisser les cases d\'un niveau, sans descendre sous le niveau du sol.',
  level: 'Glissez depuis une case : tout le rectangle prend son altitude. Coût par niveau déplacé.',
  clear: 'Glissez pour abattre les forêts (15 €/case) et retirer la roche (60 €/case) du rectangle.',
  plant: 'Glissez pour planter une forêt sur les cases libres et non zonées : fraîcheur, verdure, bruit et pollution réduits.'
};
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
      {
        id: 'terrain',
        label: 'Terrain',
        icon: 'terrain',
        tools: Object.entries(TERRAFORM).map(([op, t]) => ({
          id: `terraform:${op}`,
          kind: 'terraform',
          op,
          label: t.label,
          cost: toCents(t.euros),
          costUnit: op === 'raise' || op === 'lower' || op === 'level' ? '/case/niveau' : '/case',
          desc: TERRAFORM_DESC[op]
        }))
      },
      {
        id: 'demolish',
        label: 'Démolir et déplacer',
        icon: 'demolish',
        key: 'Suppr',
        tools: [
          { id: 'demolish', kind: 'demolish', filter: 'all', label: 'Démolir (tout)', cost: 0, desc: 'Glissez pour démolir bâtiments, routes et forêts du rectangle. L\'accès autoroutier est ignoré.' },
          { id: 'demolish:roads', kind: 'demolish', filter: 'roads', label: 'Démolir les routes', cost: ROAD_DEMOLITION_CENTS, costUnit: '/case', desc: 'Ne retire que les routes et les ponts (×4) : les bâtiments voisins restent en place.' },
          { id: 'demolish:buildings', kind: 'demolish', filter: 'buildings', label: 'Démolir les bâtiments', cost: 0, desc: 'Ne retire que les bâtiments du rectangle (routes et forêts conservées).' },
          { id: 'move', kind: 'move', label: 'Déplacer un équipement', cost: 0, desc: 'Touchez un équipement (centrale, école, parc…), puis son nouvel emplacement, et validez. Gratuit dans les 30 jours suivant la pose, puis 15 % du coût de construction.' }
        ]
      }
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
        ['territory', 'Territoire (T)', 'map'],
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
    window.addEventListener('resize', () => {
      if (this.openCat) this.#placeFlyout(this.catButtons.get(this.openCat));
    });
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
    // (la position définitive est calculée une fois le contenu en place : voir #placeFlyout)
    this.flyout.style.top = '';
    this.flyout.style.maxHeight = '';
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
    this.#placeFlyout(btn);
    this.#highlight();
  }

  /**
   * Sur ordinateur et tablette, le menu s'ouvre à hauteur de son bouton mais ne doit jamais dépasser le bas de
   * l'écran : il remonte autant que nécessaire et, s'il reste plus haut que l'écran, il défile (iPad : la liste des
   * services publics descendait sous le bord et le lycée était inaccessible).
   */
  #placeFlyout(btn) {
    if (isCompact()) return;
    const f = this.flyout;
    const host = f.parentElement.getBoundingClientRect();
    // L'échelle de l'interface (zoom CSS) s'applique aussi à top et max-height
    const zoom = parseFloat(getComputedStyle(f).zoom) || 1;
    const margin = 12;
    const avail = host.height - 2 * margin;
    f.style.maxHeight = `${avail / zoom}px`;
    const height = Math.min(f.getBoundingClientRect().height, avail);
    let top = btn.getBoundingClientRect().top - host.top - 8;
    top = Math.min(top, host.height - margin - height);
    f.style.top = `${Math.max(margin, top) / zoom}px`;
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
