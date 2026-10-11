import { EventBus } from './EventBus.js';
import { GameState } from './GameState.js';
import { Simulation } from '../simulation/Simulation.js';
import { ActionHistory } from '../systems/ActionHistory.js';
import { ConstructionService } from '../systems/ConstructionService.js';
import { ZoningService } from '../systems/ZoningService.js';
import { getTile } from '../world/Tile.js';
import { toCents } from '../util/money.js';

/**
 * Une partie en cours : état + simulation + services, sans aucune dépendance graphique.
 * C'est la seule porte d'entrée pour modifier le monde : l'interface envoie des commandes via `execute()`,
 * qui valident systématiquement l'action avant de l'appliquer.
 */
export class GameSession {
  /**
   * @param {{catalog: import('../data/Catalog.js').Catalog, state: GameState, bus?: EventBus}} p
   */
  constructor({ catalog, state, bus = new EventBus() }) {
    this.catalog = catalog;
    this.bus = bus;
    this.state = state;
    this.sim = new Simulation({ catalog, bus });
    this.history = new ActionHistory();
    this.construction = new ConstructionService({ catalog, economy: this.sim.economy, history: this.history, bus });
    this.zoning = new ZoningService({ catalog, economy: this.sim.economy, construction: this.construction, bus });
    this.sim.attach(state);
  }

  static newGame({ catalog, seed, width, height, name, bus }) {
    const state = GameState.createNew({ catalog, seed, width, height, name });
    return new GameSession({ catalog, state, bus });
  }

  /** Avance la simulation de n ticks. */
  run(ticks) {
    for (let k = 0; k < ticks; k++) this.sim.step(this.state);
  }

  tile(x, y) {
    return getTile(this.state, x, y);
  }

  /**
   * Prévisualise une commande (coût, validité, raisons) sans modifier le monde.
   * @param {{type:string} & Record<string, any>} cmd
   */
  preview(cmd) {
    const s = this.state;
    switch (cmd.type) {
      case 'road':
        return this.construction.previewRoad(s, cmd);
      case 'building':
        return this.construction.previewBuilding(s, cmd);
      case 'demolish':
        return this.construction.previewDemolish(s, cmd.rect);
      case 'zone':
        return this.zoning.previewZone(s, cmd);
      case 'deliveryZone':
        return this.zoning.previewDeliveryZone(s, cmd);
      case 'upgrade':
        return this.construction.previewUpgrade(s, cmd);
      default:
        return { ok: false, reasons: ['unknown'], messages: [`Commande inconnue : ${cmd.type}`] };
    }
  }

  /**
   * Exécute une commande validée.
   * @returns {{ok:boolean} & Record<string, any>}
   */
  execute(cmd) {
    const s = this.state;
    let r;
    switch (cmd.type) {
      case 'road':
        r = this.construction.buildRoad(s, cmd);
        break;
      case 'building':
        r = this.construction.placeBuilding(s, cmd);
        break;
      case 'demolish':
        r = this.construction.demolish(s, cmd.rect);
        break;
      case 'zone':
        r = this.zoning.applyZone(s, cmd);
        break;
      case 'deliveryZone':
        r = this.zoning.applyDeliveryZone(s, cmd);
        break;
      case 'undo':
        r = this.construction.undo(s);
        break;
      case 'upgrade':
        r = this.construction.applyUpgrade(s, cmd);
        break;
      case 'research':
        r = this.sim.ai.research(s, cmd.techId);
        break;
      case 'decommission':
        r = this.sim.ai.decommission(s, cmd.techId);
        break;
      case 'policy':
        r = this.sim.ai.togglePolicy(s, cmd.policyId, cmd.enabled);
        break;
      case 'tax': {
        const v = Math.max(0, Math.min(cmd.key === 'property' ? 5 : 25, Number(cmd.value)));
        if (!Number.isFinite(v) || !(cmd.key in s.economy.taxes)) return { ok: false, reasons: ['invalid'] };
        s.economy.taxes[cmd.key] = Math.round(v * 10) / 10;
        r = { ok: true };
        break;
      }
      case 'tariff': {
        const v = Math.max(0, Math.min(5, Number(cmd.value)));
        if (!Number.isFinite(v) || !(cmd.key in s.economy.tariffs)) return { ok: false, reasons: ['invalid'] };
        s.economy.tariffs[cmd.key] = Math.round(v * 100) / 100;
        r = { ok: true };
        break;
      }
      case 'loan':
        r = this.sim.economy.takeLoan(s, toCents(cmd.amountEuros), cmd.months);
        break;
      case 'trade': {
        // Échanges régionaux : vente des excédents ou achat en cas de pénurie
        const allowed = { power: ['sell', 'buy'], water: ['sell', 'buy'], waste: ['buy'] };
        if (!allowed[cmd.resource]?.includes(cmd.side)) return { ok: false, reasons: ['invalid'], messages: ['Échange inconnu'] };
        s.trade[cmd.resource][cmd.side] = !!cmd.enabled;
        s.dirty.utilities = true;
        r = { ok: true };
        break;
      }
      default:
        return { ok: false, reasons: ['unknown'], messages: [`Commande inconnue : ${cmd.type}`] };
    }
    if (r?.ok) this.bus.emit('command:done', { cmd, result: r });
    return r;
  }
}
