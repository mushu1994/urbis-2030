import { footprintOf } from '../world/PlacementSystem.js';
import { formatMoney } from '../util/money.js';

/**
 * Traduit les interactions sur la carte (survol, clic, glisser) en prévisualisations puis en commandes
 * envoyées à la session. Aucune modification directe du monde.
 */
export class ToolController {
  /**
   * @param {{getSession:()=>import('./GameSession.js').GameSession, renderer:any, tooltip:HTMLElement,
   *          onSelect:(target:any)=>void, notify:(level:string, msg:string)=>void,
   *          needsConfirm:(cents:number)=>boolean, confirm:(message:string)=>Promise<boolean>}} deps
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.tool = { id: 'select', kind: 'select' };
    this.rot = 0;
    this.dragStart = null;
    this.hoverTile = null;
    this.lastKey = '';
    this.mods = { shift: false };
    /** Au doigt : pose de bâtiment en attente d'un second appui (clé de la commande prévisualisée). */
    this.pendingKey = null;
    /** Appelé quand l'outil ou sa rotation change (barre d'outil active). */
    this.onChange = deps.onChange ?? (() => {});
  }

  setTool(tool) {
    this.tool = tool;
    this.dragStart = null;
    this.lastKey = '';
    this.pendingKey = null;
    this.renderer.setPreview(null);
    this.#refresh();
    this.onChange(tool);
  }

  /** Le bâtiment de l'outil actif peut-il pivoter ? */
  get canRotate() {
    return this.tool.kind === 'building' && !!this.getSession()?.catalog.building(this.tool.defId).rotatable;
  }

  rotate() {
    if (this.tool.kind !== 'building') return;
    const def = this.getSession().catalog.building(this.tool.defId);
    if (!def.rotatable) {
      this.notify('info', 'Ce bâtiment ne peut pas pivoter');
      return;
    }
    this.rot = (this.rot + 1) % 2;
    this.pendingKey = null;
    this.lastKey = '';
    this.#refresh();
    this.onChange(this.tool);
  }

  cancel() {
    if (this.dragStart || this.pendingKey) {
      this.dragStart = null;
      this.pendingKey = null;
      this.renderer.setPreview(null);
      this.lastKey = '';
      this.#refresh();
      return true;
    }
    return false;
  }

  hover(tile, mods) {
    this.hoverTile = tile;
    this.mods = mods;
    this.renderer.setHover(tile);
    this.#refresh();
  }

  /** Recalcul périodique (budget et conditions évoluent pendant la simulation). */
  tickRefresh() {
    this.lastKey = '';
    this.#refresh();
  }

  down(tile) {
    if (!tile) return;
    if (this.tool.kind === 'select') return;
    if (this.tool.kind === 'building') return; // posé au relâchement
    this.dragStart = tile;
    this.lastKey = '';
    this.#refresh();
  }

  up(tile, { moved, screen, touch = false } = {}) {
    const session = this.getSession();
    if (!session) return;
    if (this.tool.kind === 'select') {
      if (!moved && tile) {
        const picked = screen ? this.renderer.buildingAtScreen(screen.x, screen.y) : 0;
        const id = picked || session.state.grid.building[session.state.grid.idx(tile.x, tile.y)];
        this.onSelect(id ? { buildingId: id } : { x: tile.x, y: tile.y });
      }
      return;
    }
    const cmd = this.#command(tile ?? this.hoverTile);
    this.dragStart = null;
    if (!cmd) return;
    // Au doigt, un premier appui montre l'aperçu et le coût ; un second appui au même endroit construit.
    if (touch && cmd.type === 'building') {
      const key = JSON.stringify(cmd);
      if (this.pendingKey !== key) {
        this.pendingKey = key;
        this.lastKey = '';
        this.hover(tile, this.mods);
        return;
      }
      this.pendingKey = null;
    }
    const pv = session.preview(cmd);
    if (!pv.ok) {
      this.notify('warning', pv.messages?.filter(Boolean).join(' · ') || 'Action impossible');
    } else if (cmd.type === 'demolish' && this.needsConfirm(pv.cost)) {
      this.confirm(`Démolir pour ${formatMoney(pv.cost)} ?`).then((ok) => ok && this.#run(cmd));
    } else {
      this.#run(cmd);
    }
    this.lastKey = '';
    this.#refresh();
  }

  #run(cmd) {
    const r = this.getSession().execute(cmd);
    if (!r.ok) this.notify('warning', r.messages?.filter(Boolean).join(' · ') || 'Action impossible');
    this.lastKey = '';
    this.#refresh();
  }

  #command(tile) {
    if (!tile) return null;
    const t = this.tool;
    const start = this.dragStart ?? tile;
    const rect = { x0: start.x, y0: start.y, x1: tile.x, y1: tile.y };
    switch (t.kind) {
      case 'road':
        return { type: 'road', roadId: t.roadId, from: start, to: tile, verticalFirst: this.mods.shift };
      case 'zone':
        return { type: 'zone', zoneId: t.zoneId, rect };
      case 'demolish':
        return { type: 'demolish', rect };
      case 'deliveryZone':
        return { type: 'deliveryZone', enabled: t.enabled, rect };
      case 'building': {
        const def = this.getSession().catalog.building(t.defId);
        const { w, h } = footprintOf(def, def.rotatable ? this.rot : 0);
        return { type: 'building', defId: t.defId, x: tile.x - Math.floor((w - 1) / 2), y: tile.y - Math.floor((h - 1) / 2), rot: def.rotatable ? this.rot : 0 };
      }
      default:
        return null;
    }
  }

  #refresh() {
    const session = this.getSession();
    const tip = this.tooltip;
    if (!session || !this.hoverTile) {
      tip.hidden = true;
      return;
    }
    const t = this.tool;
    if (t.kind === 'select') {
      this.renderer.setPreview(null);
      tip.hidden = true;
      return;
    }
    const cmd = this.#command(this.hoverTile);
    const key = JSON.stringify(cmd) + this.mods.shift;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const pv = session.preview(cmd);
    let spec = null;
    if (cmd.type === 'road') spec = { kind: 'road', ok: pv.ok, tiles: pv.tiles ?? [] };
    else if (cmd.type === 'zone') {
      const zone = cmd.zoneId ? session.catalog.zoneById.get(cmd.zoneId) : null;
      spec = { kind: 'rect', ok: pv.ok, rect: cmd.rect, eligible: pv.eligible, color: zone?.color ?? '#9aa5b1' };
    } else if (cmd.type === 'demolish') spec = { kind: 'rect', ok: pv.ok, rect: cmd.rect, color: '#ff5050' };
    else if (cmd.type === 'deliveryZone') spec = { kind: 'rect', ok: pv.ok, rect: cmd.rect, eligible: pv.eligible, color: '#f0b429' };
    else if (cmd.type === 'building') {
      const def = session.catalog.building(cmd.defId);
      const { w, h } = footprintOf(def, cmd.rot);
      spec = { kind: 'building', ok: pv.ok, def, x: cmd.x, y: cmd.y, w, h };
    }
    this.renderer.setPreview(spec);

    const label = t.label ?? '';
    const cost = pv.cost ? formatMoney(pv.cost) : 'gratuit';
    const extra = cmd.type === 'building' && pv.upkeep ? ` · entretien ${formatMoney(pv.upkeep)}/mois` : '';
    const count = cmd.type === 'zone' || cmd.type === 'deliveryZone' ? ` · ${pv.eligible?.length ?? 0} case(s)` : cmd.type === 'demolish' ? ` · ${pv.buildings?.length ?? 0} bât., ${pv.roads?.length ?? 0} routes` : '';
    tip.innerHTML = '';
    const b = document.createElement('strong');
    b.textContent = label;
    const c = document.createElement('span');
    c.textContent = `${cmd.type === 'demolish' ? 'Coût de démolition' : 'Coût'} : ${cost}${extra}${count}`;
    tip.append(b, c);
    if (!pv.ok && pv.messages?.length) {
      const r = document.createElement('em');
      r.textContent = pv.messages.filter(Boolean).join(' · ');
      tip.append(r);
    }
    if (this.pendingKey && cmd.type === 'building') {
      const r = document.createElement('small');
      r.textContent = pv.ok ? 'Touchez à nouveau le même endroit pour construire' : 'Touchez un autre endroit';
      tip.append(r);
    } else if (cmd.type === 'building' && session.catalog.building(cmd.defId).rotatable) {
      const r = document.createElement('small');
      r.textContent = 'R ou bouton Pivoter : changer l\'orientation';
      tip.append(r);
    }
    tip.classList.toggle('bad', !pv.ok);
    tip.hidden = false;
  }
}
