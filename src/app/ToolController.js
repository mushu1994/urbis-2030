import { footprintOf } from '../world/PlacementSystem.js';
import { formatMoney } from '../util/money.js';
import { LINE_MODES } from '../simulation/LineSystem.js';

/**
 * Traduit les interactions sur la carte (survol, clic, glisser) en prévisualisations puis en commandes
 * envoyées à la session. Aucune modification directe du monde.
 */
export class ToolController {
  /**
   * @param {{getSession:()=>import('./GameSession.js').GameSession, renderer:any, tooltip:HTMLElement,
   *          onSelect:(target:any)=>void, notify:(level:string, msg:string)=>void,
   *          needsConfirm:(cents:number)=>boolean, confirm:(message:string)=>Promise<boolean>,
   *          confirmPlacement?:()=>boolean, onChange?:(tool:any)=>void}} deps
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.tool = { id: 'select', kind: 'select' };
    this.rot = 0;
    this.dragStart = null;
    this.hoverTile = null;
    this.lastKey = '';
    this.mods = { shift: false };
    /** Pose en attente de validation (bouton « Valider » ou Entrée) : case choisie. */
    this.pending = null;
    /** Outil « Déplacer » : identifiant de l'équipement choisi. */
    this.moveSource = 0;
    /** Outil « Tracer une ligne » (v0.8) : arrêts choisis, dans l'ordre. */
    this.lineStops = [];
    /** Appelé quand l'outil ou sa rotation change (barre d'outil active). */
    this.onChange = deps.onChange ?? (() => {});
  }

  setTool(tool) {
    this.tool = tool;
    this.dragStart = null;
    this.lastKey = '';
    this.pending = null;
    this.moveSource = 0;
    this.lineStops = [];
    this.renderer.setPreview(null);
    this.#refresh();
    this.onChange(tool);
  }

  /** Le bâtiment de l'outil actif peut-il pivoter ? */
  get canRotate() {
    return !!this.#placedDef()?.rotatable;
  }

  /** Définition du bâtiment en cours de pose ou de déplacement. */
  #placedDef() {
    const session = this.getSession();
    if (!session) return null;
    if (this.tool.kind === 'building') return session.catalog.building(this.tool.defId);
    if (this.tool.kind === 'move' && this.moveSource) {
      const b = session.state.buildings.get(this.moveSource);
      return b ? session.catalog.building(b.defId) : null;
    }
    return null;
  }

  rotate() {
    const def = this.#placedDef();
    if (!def) return;
    if (!def.rotatable) {
      this.notify('info', 'Ce bâtiment ne peut pas pivoter');
      return;
    }
    this.rot = (this.rot + 1) % 2;
    this.lastKey = '';
    this.#refresh();
    this.onChange(this.tool);
  }

  cancel() {
    // Tracé d'une ligne : Échap retire le dernier arrêt choisi
    if (this.tool.kind === 'line' && this.lineStops.length) {
      this.lineStops.pop();
      this.pending = this.lineStops.length ? { line: true } : null;
      this.lastKey = '';
      this.#refresh();
      this.onChange(this.tool);
      return true;
    }
    if (this.dragStart || this.pending || this.moveSource) {
      this.dragStart = null;
      if (this.pending) this.pending = null;
      else this.moveSource = 0;
      this.renderer.setPreview(null);
      this.lastKey = '';
      this.#refresh();
      this.onChange(this.tool);
      return true;
    }
    return false;
  }

  /**
   * v1.7.1 : interrompt seulement le geste en cours (rectangle de zonage, tracé de route qu'on était en train de
   * glisser), sans toucher à ce qui a déjà été choisi : arrêts d'une ligne, bâtiment en attente de validation,
   * équipement à déplacer. Appelé quand un deuxième doigt se pose (pincer pour zoomer) ou quand le navigateur
   * reprend la main sur le geste (Safari sur iPad).
   */
  abortStroke() {
    if (!this.dragStart) return false;
    this.dragStart = null;
    if (!this.pending && !this.lineStops.length) this.renderer.setPreview(null);
    this.lastKey = '';
    this.#refresh();
    return true;
  }

  /** Aperçu de la pose en attente (coût, validité), ou null. */
  get pendingPreview() {
    if (!this.pending) return null;
    if (this.tool.kind === 'line') return this.getSession()?.preview(this.#lineCommand()) ?? null;
    const cmd = this.#command(this.pending.tile);
    return cmd ? this.getSession()?.preview(cmd) ?? null : null;
  }

  /** Bouton « Valider » : exécute la pose ou le déplacement en attente. */
  confirmPending() {
    if (!this.pending) return false;
    if (this.tool.kind === 'line') return this.#finishLine();
    const cmd = this.#command(this.pending.tile);
    const pv = cmd && this.getSession().preview(cmd);
    if (!pv?.ok) {
      this.notify('warning', pv?.messages?.filter(Boolean).join(' · ') || 'Emplacement impossible');
      return false;
    }
    this.pending = null;
    if (cmd.type === 'building' && pv.replaced?.length) this.#confirmReplace(cmd, pv);
    else this.#run(cmd);
    if (cmd.type === 'move') this.moveSource = 0;
    this.renderer.setPreview(null);
    this.lastKey = '';
    this.#refresh();
    this.onChange(this.tool);
    return true;
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
    if (this.tool.kind === 'building' || this.tool.kind === 'move' || this.tool.kind === 'line') return; // au relâchement
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
    if (this.tool.kind === 'line') {
      if (!moved && tile) this.#pickStop(session, tile, screen);
      return;
    }
    // Déplacer : le premier appui désigne l'équipement
    if (this.tool.kind === 'move' && !this.moveSource) {
      if (moved || !tile) return;
      const picked = screen ? this.renderer.buildingAtScreen(screen.x, screen.y) : 0;
      const id = picked || session.state.grid.building[session.state.grid.idx(tile.x, tile.y)];
      const b = id ? session.state.buildings.get(id) : null;
      if (!b) return this.notify('info', 'Touchez l\'équipement à déplacer');
      if (session.catalog.building(b.defId).kind !== 'plop') return this.notify('warning', 'Les bâtiments de zone ne se déplacent pas : retirez le zonage ou démolissez-les');
      this.moveSource = b.id;
      this.rot = b.rot ?? 0;
      this.lastKey = '';
      this.#refresh();
      this.onChange(this.tool);
      return;
    }
    const cmd = this.#command(tile ?? this.hoverTile);
    this.dragStart = null;
    if (!cmd) return;
    // Pose d'un bâtiment (au doigt, ou si l'option est active) et déplacement : l'emplacement attend
    // la validation par le bouton « Valider » ; toucher ailleurs déplace simplement l'aperçu.
    if (cmd.type === 'move' || (cmd.type === 'building' && (touch || this.confirmPlacement?.()))) {
      this.pending = { tile: tile ?? this.hoverTile };
      this.lastKey = '';
      this.#refresh();
      this.onChange(this.tool);
      return;
    }
    const pv = session.preview(cmd);
    if (!pv.ok) {
      this.notify('warning', pv.messages?.filter(Boolean).join(' · ') || 'Action impossible');
    } else if (cmd.type === 'demolish' && this.needsConfirm(pv.cost)) {
      this.confirm(`Démolir pour ${formatMoney(pv.cost)} ?`).then((ok) => ok && this.#run(cmd));
    } else if (cmd.type === 'building' && pv.replaced?.length) {
      this.#confirmReplace(cmd, pv);
    } else if (cmd.type === 'zone' && pv.buildings?.length) {
      const n = pv.buildings.length;
      const who = pv.residents ? ` (${pv.residents} habitant${pv.residents > 1 ? 's' : ''} partiront)` : '';
      const what = cmd.zoneId ? 'Changer la zone' : 'Dézoner';
      this.confirm(`${what} démolira ${n} bâtiment${n > 1 ? 's' : ''}${who} pour ${formatMoney(pv.cost)} au total. Continuer ?`).then((ok) => ok && this.#run(cmd));
    } else {
      this.#run(cmd);
    }
    this.lastKey = '';
    this.#refresh();
  }

  /** v1.4 : poser un équipement sur des bâtiments de zone demande confirmation (habitants, frais de démolition). */
  #confirmReplace(cmd, pv) {
    const n = pv.replaced.length;
    const who = pv.residents ? ` (${pv.residents} habitant${pv.residents > 1 ? 's' : ''} partiront)` : '';
    this.confirm(`Construire ici démolira ${n} bâtiment${n > 1 ? 's' : ''} de zone${who}. Coût total ${formatMoney(pv.cost)}, dont ${formatMoney(pv.demolition)} de démolition. Continuer ?`).then((ok) => ok && this.#run(cmd));
  }

  #lineCommand() {
    return { type: 'line', mode: this.tool.mode, stops: [...this.lineStops] };
  }

  /** Tracé d'une ligne : ajoute l'arrêt touché ; toucher le premier arrêt referme la ligne. */
  #pickStop(session, tile, screen) {
    const picked = screen ? this.renderer.buildingAtScreen(screen.x, screen.y) : 0;
    const id = picked || session.state.grid.building[session.state.grid.idx(tile.x, tile.y)];
    const b = id ? session.state.buildings.get(id) : null;
    const M = LINE_MODES[this.tool.mode];
    const stopName = this.tool.mode === 'tram' ? 'une station de tramway' : 'un arrêt de bus';
    if (!b || b.defId !== M.stop) return this.notify('info', `Touchez ${stopName} (les arrêts se construisent dans le menu Transports)`);
    if (b.id === this.lineStops[0] && this.lineStops.length >= 2) return this.#finishLine();
    if (this.lineStops.includes(b.id)) return this.notify('info', 'Cet arrêt fait déjà partie de la ligne');
    this.lineStops.push(b.id);
    this.pending = { line: true };
    this.lastKey = '';
    this.#refresh();
    this.onChange(this.tool);
  }

  #finishLine() {
    const session = this.getSession();
    const cmd = this.#lineCommand();
    const pv = session.preview(cmd);
    if (!pv?.ok) {
      this.notify('warning', pv?.messages?.filter(Boolean).join(' · ') || 'Ligne impossible');
      return false;
    }
    const r = session.execute(cmd);
    if (!r.ok) {
      this.notify('warning', r.messages?.filter(Boolean).join(' · ') || 'Ligne impossible');
      return false;
    }
    this.notify('success', `${r.line.name} créée : ${r.line.stops.length} arrêts, ${r.line.vehicles} véhicules${r.cost ? `, rails ${formatMoney(r.cost)}` : ''}. Réglez la fréquence dans le panneau des lignes (K).`);
    this.lineStops = [];
    this.pending = null;
    this.renderer.setPreview(null);
    this.lastKey = '';
    this.#refresh();
    this.onChange(this.tool);
    return true;
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
      case 'rail':
        return { type: 'rail', from: start, to: tile, verticalFirst: this.mods.shift };
      case 'zone':
        return { type: 'zone', zoneId: t.zoneId, rect };
      case 'demolish':
        return { type: 'demolish', rect, filter: t.filter ?? 'all' };
      case 'terraform':
        return { type: 'terraform', op: t.op, rect };
      case 'move': {
        if (!this.moveSource) return null;
        const def = this.#placedDef();
        if (!def) return null;
        const rot = def.rotatable ? this.rot : 0;
        const { w, h } = footprintOf(def, rot);
        return { type: 'move', buildingId: this.moveSource, x: tile.x - Math.floor((w - 1) / 2), y: tile.y - Math.floor((h - 1) / 2), rot };
      }
      case 'deliveryZone':
        return { type: 'deliveryZone', enabled: t.enabled, rect };
      case 'building': {
        const def = this.getSession().catalog.building(t.defId);
        const rot = def.rotatable ? this.rot : 0;
        const { w, h } = footprintOf(def, rot);
        const cmd = { type: 'building', defId: t.defId, x: tile.x - Math.floor((w - 1) / 2), y: tile.y - Math.floor((h - 1) / 2), rot };
        return def.placement.adjacentToTerrainCode >= 0 ? this.#snapToShore(cmd, def) : cmd;
      }
      default:
        return null;
    }
  }

  /**
   * Bâtiments à poser au bord de l'eau (port, pompe…) : si l'emplacement visé ne convient pas, on propose le plus
   * proche qui convient, à 4 cases au plus (essayant aussi l'autre orientation pour un bâtiment pivotable).
   */
  #snapToShore(cmd, def) {
    const session = this.getSession();
    if (session.preview(cmd).ok) return cmd;
    const key = `${cmd.defId}:${cmd.x}:${cmd.y}:${cmd.rot}`;
    if (this.snapCache?.key === key && this.snapCache.tick === session.state.time.tick) return this.snapCache.cmd;
    let best = null;
    let bestD = Infinity;
    const rots = def.rotatable ? [cmd.rot, 1 - cmd.rot] : [cmd.rot];
    for (const rot of rots) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = dx * dx + dy * dy + (rot !== cmd.rot ? 0.5 : 0);
          if (d >= bestD) continue;
          const c = { ...cmd, x: cmd.x + dx, y: cmd.y + dy, rot };
          if (session.preview(c).ok) {
            best = c;
            bestD = d;
          }
        }
      }
    }
    const out = best ? { ...best, snapped: true } : cmd;
    this.snapCache = { key, tick: session.state.time.tick, cmd: out };
    return out;
  }

  /** Aperçu du tracé de ligne en cours (cases du parcours, coût des rails, intervalle). */
  #refreshLine(session) {
    const tip = this.tooltip;
    const n = this.lineStops.length;
    if (!n && !this.hoverTile) {
      this.renderer.setPreview(null);
      tip.hidden = true;
      this.lastKey = '';
      return;
    }
    const key = `line:${this.lineStops.join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const pv = n >= 2 ? session.preview(this.#lineCommand()) : null;
    const w = session.state.grid.width;
    // v1.7.1 : les arrêts déjà choisis restent marqués, même avec un seul arrêt (avant, rien ne s'affichait)
    const stopTiles = [];
    for (const id of this.lineStops) {
      const b = session.state.buildings.get(id);
      if (b) for (let dy = 0; dy < (b.h ?? 1); dy++) for (let dx = 0; dx < (b.w ?? 1); dx++) stopTiles.push({ x: b.x + dx, y: b.y + dy });
    }
    const pathTiles = pv?.path ? pv.path.map((i) => ({ x: i % w, y: Math.floor(i / w) })) : [];
    const tiles = [...pathTiles, ...stopTiles];
    this.renderer.setPreview(tiles.length ? { kind: 'road', ok: pv ? pv.ok : true, tiles } : null);
    tip.innerHTML = '';
    const b = document.createElement('strong');
    b.textContent = this.tool.label ?? 'Tracer une ligne';
    const c = document.createElement('span');
    const unit = this.tool.mode === 'tram' ? 'station' : 'arrêt';
    if (n < 2) c.textContent = n ? `1 ${unit} choisi : touchez le suivant` : `Touchez les ${unit}s dans l'ordre du parcours`;
    else if (pv?.path) {
      const km = (pv.length * 0.12).toFixed(1).replace('.', ',');
      c.textContent = `${n} ${unit}s · boucle de ${km} km · un passage toutes les ${Math.round(pv.headway)} min avec ${pv.vehicles} véhicules${pv.newTracks ? ` · rails : ${pv.newTracks} cases (${formatMoney(pv.cost)})` : ''}`;
    } else c.textContent = `${n} ${unit}s`;
    tip.append(b, c);
    if (pv && !pv.ok && pv.messages?.length) {
      const r = document.createElement('em');
      r.textContent = pv.messages.filter(Boolean).join(' · ');
      tip.append(r);
    }
    if (n >= 2) {
      const r = document.createElement('small');
      r.textContent = 'Valider (Entrée) ou toucher le premier arrêt : créer la ligne · Échap : retirer le dernier arrêt';
      tip.append(r);
    }
    tip.classList.toggle('bad', !!pv && !pv.ok);
    tip.hidden = false;
  }

  #refresh() {
    const session = this.getSession();
    const tip = this.tooltip;
    const at = this.pending?.tile ?? this.hoverTile;
    // Tracé de ligne : l'aperçu (arrêts choisis, parcours) ne dépend pas du survol — au doigt il n'y en a pas
    if (session && this.tool.kind === 'line') return this.#refreshLine(session);
    if (!session || !at) {
      tip.hidden = true;
      return;
    }
    const t = this.tool;
    if (t.kind === 'select') {
      this.renderer.setPreview(null);
      tip.hidden = true;
      return;
    }
    if (t.kind === 'line') return this.#refreshLine(session);
    if (t.kind === 'move' && !this.moveSource) {
      this.renderer.setPreview(null);
      tip.innerHTML = '';
      const b = document.createElement('strong');
      b.textContent = 'Déplacer un équipement';
      const c = document.createElement('span');
      c.textContent = 'Touchez l\'équipement à déplacer';
      tip.append(b, c);
      tip.classList.remove('bad');
      tip.hidden = false;
      this.lastKey = '';
      return;
    }
    const cmd = this.#command(at);
    const key = JSON.stringify(cmd) + this.mods.shift;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const pv = session.preview(cmd);
    let spec = null;
    if (cmd.type === 'road' || cmd.type === 'rail') spec = { kind: 'road', ok: pv.ok, tiles: pv.tiles ?? [] };
    else if (cmd.type === 'zone') {
      const zone = cmd.zoneId ? session.catalog.zoneById.get(cmd.zoneId) : null;
      spec = { kind: 'rect', ok: pv.ok, rect: cmd.rect, eligible: pv.eligible, color: zone?.color ?? '#9aa5b1' };
    } else if (cmd.type === 'demolish') spec = { kind: 'rect', ok: pv.ok, rect: cmd.rect, color: cmd.filter === 'roads' ? '#ff9a3c' : '#ff5050' };
    else if (cmd.type === 'terraform') spec = { kind: 'rect', ok: pv.ok, rect: cmd.rect, eligible: pv.eligible, color: cmd.op === 'plant' ? '#3f9a45' : cmd.op === 'clear' ? '#b98a4a' : '#c9a86a' };
    else if (cmd.type === 'move') {
      const def = this.#placedDef();
      spec = { kind: 'building', ok: pv.ok, def, x: cmd.x, y: cmd.y, w: pv.w ?? def.footprint.w, h: pv.h ?? def.footprint.h };
    }
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
    const dezoneBuildings = cmd.type === 'zone' && pv.buildings?.length ? ` · ${pv.buildings.length} bâtiment(s) démoli(s)` : '';
    const count = cmd.type === 'zone' || cmd.type === 'deliveryZone' || cmd.type === 'terraform' ? ` · ${pv.eligible?.length ?? 0} case(s)${dezoneBuildings}` : cmd.type === 'demolish' ? ` · ${pv.buildings?.length ?? 0} bât., ${pv.roads?.length ?? 0} routes` : '';
    tip.innerHTML = '';
    const b = document.createElement('strong');
    b.textContent = cmd.type === 'move' ? `Déplacer : ${this.#placedDef()?.name ?? ''}` : label;
    const c = document.createElement('span');
    c.textContent = `${cmd.type === 'demolish' ? 'Coût de démolition' : cmd.type === 'move' ? 'Coût du déplacement' : 'Coût'} : ${cost}${extra}${count}`;
    tip.append(b, c);
    if (cmd.snapped) {
      const r = document.createElement('small');
      r.textContent = 'Emplacement ajusté au rivage le plus proche';
      tip.append(r);
    }
    if (pv.ok && pv.works) {
      const r = document.createElement('small');
      const c = pv.check;
      const parts = [c.forestTiles.length && 'défrichement', c.rockTiles.length && 'dérochage', c.level && 'nivellement'].filter(Boolean);
      r.textContent = `Dont préparation du terrain (${parts.join(', ')}) : ${formatMoney(pv.works)}`;
      tip.append(r);
    }
    if (pv.ok && pv.replaced?.length) {
      const r = document.createElement('small');
      const n = pv.replaced.length;
      r.textContent = `Démolit ${n} bâtiment${n > 1 ? 's' : ''} de zone${pv.residents ? ` (${pv.residents} habitant${pv.residents > 1 ? 's' : ''} partiront)` : ''} : ${formatMoney(pv.demolition)} compris`;
      tip.append(r);
    }
    if (pv.ok && pv.notes?.length) {
      const r = document.createElement('small');
      r.textContent = pv.notes.join(' · ');
      tip.append(r);
    }
    if (!pv.ok && pv.messages?.length) {
      const r = document.createElement('em');
      r.textContent = pv.messages.filter(Boolean).join(' · ');
      tip.append(r);
    }
    if (this.pending) {
      const r = document.createElement('small');
      r.textContent = pv.ok ? 'Appuyez sur « Valider » (ou Entrée) — ou touchez un autre endroit' : 'Touchez un autre endroit';
      tip.append(r);
    } else if ((cmd.type === 'building' || cmd.type === 'move') && this.#placedDef()?.rotatable) {
      const r = document.createElement('small');
      r.textContent = 'R ou bouton Pivoter : changer l\'orientation';
      tip.append(r);
    }
    tip.classList.toggle('bad', !pv.ok);
    tip.hidden = false;
  }
}
