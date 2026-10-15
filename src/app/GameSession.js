import { EventBus } from './EventBus.js';
import { GameState } from './GameState.js';
import { Simulation } from '../simulation/Simulation.js';
import { ActionHistory } from '../systems/ActionHistory.js';
import { ConstructionService } from '../systems/ConstructionService.js';
import { ZoningService } from '../systems/ZoningService.js';
import { getTile } from '../world/Tile.js';
import { toCents } from '../util/money.js';
import { ruinBuilding } from '../simulation/CrisisSystem.js';
import { setDistrictTax, renameDistrict } from '../simulation/Districts.js';

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
    /** Hôte distant (simulation dans un Web Worker) : reçoit les commandes appliquées sur cette réplique. */
    this.remote = null;
  }

  static newGame({ catalog, seed, width, height, name, bus, mapParams }) {
    const state = GameState.createNew({ catalog, seed, width, height, name, mapParams });
    return new GameSession({ catalog, state, bus });
  }

  /**
   * Avance la simulation de n ticks. Quand la simulation tourne dans un Web Worker, renvoie une promesse
   * résolue une fois la réplique à jour.
   */
  run(ticks) {
    if (this.remote) return this.remote.run(ticks);
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
        return this.construction.previewDemolish(s, cmd.rect, cmd.filter);
      case 'zone':
        return this.zoning.previewZone(s, cmd);
      case 'deliveryZone':
        return this.zoning.previewDeliveryZone(s, cmd);
      case 'upgrade':
        return this.construction.previewUpgrade(s, cmd);
      case 'move':
        return this.construction.previewMove(s, cmd);
      case 'terraform':
        return this.construction.previewTerraform(s, cmd);
      case 'buyParcel':
        return this.construction.previewParcel(s, cmd);
      case 'rail':
        return this.construction.previewRail(s, cmd);
      case 'line':
        return this.sim.lines.preview(s, cmd);
      default:
        return { ok: false, reasons: ['unknown'], messages: [`Commande inconnue : ${cmd.type}`] };
    }
  }

  /**
   * Exécute une commande validée (et la transmet à la simulation distante s'il y en a une).
   * @returns {{ok:boolean} & Record<string, any>}
   */
  execute(cmd) {
    const r = this.applyCommand(cmd);
    if (r?.ok && this.remote) this.remote.forward(cmd, r);
    return r;
  }

  /**
   * Applique une commande sur cet état uniquement.
   * @returns {{ok:boolean} & Record<string, any>}
   */
  applyCommand(cmd) {
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
        r = this.construction.demolish(s, cmd.rect, cmd.filter);
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
      case 'move':
        r = this.construction.moveBuilding(s, cmd);
        break;
      case 'terraform':
        r = this.construction.terraform(s, cmd);
        break;
      case 'buyParcel':
        r = this.construction.buyParcel(s, cmd);
        break;
      case 'rail':
        r = this.construction.buildRail(s, cmd);
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
      case 'policy': {
        const adopted = s.policies.active[cmd.policyId];
        r = this.sim.ai.togglePolicy(s, cmd.policyId, cmd.enabled);
        if (r.ok && !cmd.enabled && adopted !== undefined) this.sim.politics.onPolicyRepeal(s, adopted);
        break;
      }
      case 'politics':
        // Vie politique : programme de campagne, suite d'une défaite, activation des élections
        if (cmd.op === 'programme') r = this.sim.politics.setProgramme(s, cmd);
        else if (cmd.op === 'continue') r = this.sim.politics.continueAfterDefeat(s);
        else if (cmd.op === 'enable') r = this.sim.politics.setEnabled(s, cmd.enabled);
        else return { ok: false, reasons: ['invalid'], messages: ['Commande politique inconnue'] };
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
        r = this.sim.economy.takeLoan(s, toCents(cmd.amountEuros), Number(cmd.months), cmd.loanType ?? 'annuity');
        break;
      case 'repayLoan':
        // Remboursement anticipé (v0.8), total ou partiel
        r = this.sim.economy.repayLoan(s, cmd.loanId, cmd.amountEuros === undefined || cmd.amountEuros === null ? null : toCents(cmd.amountEuros));
        break;
      case 'line':
        // Lignes de bus et de tramway (v0.8)
        if (cmd.op === 'update') r = this.sim.lines.update(s, cmd);
        else if (cmd.op === 'remove') r = this.sim.lines.remove(s, cmd);
        else r = this.sim.lines.create(s, cmd);
        break;
      case 'districtTax':
        r = setDistrictTax(s, cmd.key, cmd.sector, cmd.value);
        break;
      case 'districtName':
        r = renameDistrict(s, cmd.key, cmd.name);
        break;
      case 'contract':
        // Contrat à prix fixe avec la région (v0.8)
        r = this.sim.market.setContract(s, cmd.good, cmd.side, !!cmd.enabled);
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
      case 'repair':
        r = this.sim.crises.repair(s, cmd.buildingId);
        break;
      case 'crisisResponse':
        r = this.sim.crises.respond(s, cmd.crisisId, cmd.option);
        break;
      case 'triggerDisaster':
        // Déclenchement volontaire d'une catastrophe (menu « Risques », comme dans les SimCity)
        r = this.sim.crises.trigger(s, cmd.kind, { manual: true });
        break;
      case 'option': {
        const allowed = { disasters: ['off', 'rare', 'normal', 'frequent'], elections: ['on', 'off'] };
        if (!allowed[cmd.key]?.includes(cmd.value)) return { ok: false, reasons: ['invalid'], messages: ['Option inconnue'] };
        s.options[cmd.key] = cmd.value;
        if (cmd.key === 'elections') this.sim.politics.setEnabled(s, cmd.value === 'on');
        r = { ok: true };
        break;
      }
      case 'debug': {
        // Outils de test et de débogage (panneau F3, parcours automatisés) : passent par la même porte que le jeu.
        if (cmd.op === 'unlock') s.stats.peakPopulation = Math.max(s.stats.peakPopulation ?? 0, Number(cmd.population) || 0);
        else if (cmd.op === 'treasury') {
          const cents = toCents(Number(cmd.euros) || 0);
          s.economy.treasury += cents;
          s.economy.opening += cents;
        } else if (cmd.op === 'election') {
          // Avance le prochain scrutin (tests et démonstrations)
          s.politics.nextElection = Math.floor(s.time.tick / 30) + Math.max(1, Number(cmd.months) || 1);
        } else if (cmd.op === 'ruin') {
          const b = s.buildings.get(cmd.buildingId);
          if (!b) return { ok: false, reasons: ['invalid'] };
          ruinBuilding(s, b, this.catalog.buildingFor(b), cmd.cause ?? 'fire');
          this.bus.emit('building:changed', { building: b });
        } else return { ok: false, reasons: ['invalid'] };
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
