import { h } from './dom.js';
import { formatNumber } from '../util/money.js';
import { checkInvariants } from '../debug/Invariants.js';
import { serializeState } from '../persistence/SaveService.js';
import { textDialog } from './Dialog.js';
import { formatDate } from '../simulation/config.js';

const row = (label, value, cls = '') => h('div.kv', h('span', label), h('strong', { class: cls }, value));

/**
 * Outils de débogage : mesures de performance, comptage des objets graphiques (détection de fuites
 * et de duplications), contrôles de cohérence, avance pas à pas et export de l'état.
 */
export class DebugPanel {
  /**
   * @param {{getRenderer:()=>any, getLoop:()=>any, settings:any, apply:()=>void, notify:(l:string,m:string)=>void}} deps
   */
  constructor(deps) {
    this.id = 'debug';
    this.title = 'Outils de débogage';
    Object.assign(this, deps);
    this.lastCheck = null;
  }

  render(session, _tab, rerender) {
    const s = session.state;
    const r = this.getRenderer();
    const loop = this.getLoop();
    const mem = performance.memory;
    const routes = session.sim.routes;
    const gfx = r.buildingGfx.size;
    const objects = r.layers.objects.children.length;
    const timings = Object.entries(session.sim.timings);
    return [
      h('div.grid2',
        h('section',
          h('h3', 'Rendu'),
          row('Images par seconde', formatNumber(r.stats.fps, 0)),
          row('Préparation d\'une image', `${r.stats.frameMs.toFixed(2)} ms`),
          row('Bâtiments simulés / dessinés', `${s.buildings.size} / ${gfx}`, gfx !== s.buildings.size ? 'neg' : 'pos'),
          row('Objets dans le calque des bâtiments', formatNumber(objects)),
          row('Véhicules animés', formatNumber(r.vehicles.cars.length)),
          mem ? row('Mémoire JavaScript', `${formatNumber(mem.usedJSHeapSize / 1048576, 1)} Mo`) : row('Mémoire JavaScript', 'non mesurable dans ce navigateur')
        ),
        h('section',
          h('h3', 'Simulation'),
          row('Date', formatDate(s.time.tick)),
          row('Jours simulés dans cette session', formatNumber(loop?.ticksRun ?? 0)),
          row('Révision du réseau routier', formatNumber(s.revisions.roads)),
          row('Cache d\'itinéraires (succès / calculs)', `${routes.hits} / ${routes.misses}`),
          timings.length
            ? h('table.fin.compact', h('tbody', timings.map(([k, v]) => h('tr', h('td', k), h('td.num', `${v.toFixed(2)} ms`)))))
            : null
        )
      ),
      h('h3', 'Contrôles'),
      h('div.debug-actions',
        h('button.btn', { on: { click: () => { this.lastCheck = checkInvariants(s, session.catalog); rerender(); } } }, 'Vérifier la cohérence'),
        h('button.btn', { on: { click: () => { session.run(1); rerender(); } } }, 'Avancer d\'un jour'),
        h('button.btn', { on: { click: () => { session.run(30); rerender(); } } }, 'Avancer d\'un mois'),
        h('button.btn', { on: { click: () => textDialog('État de la partie (JSON)', JSON.stringify(serializeState(s)), 'urbis-etat.json') } }, 'Exporter l\'état'),
        h('label.check', h('input', { type: 'checkbox', checked: !!this.settings.get('showFps'), on: { change: (e) => { this.settings.set('showFps', e.target.checked); this.apply(); } } }), 'Compteur d\'images à l\'écran')
      ),
      this.lastCheck
        ? this.lastCheck.length
          ? h('ul.checks', this.lastCheck.map((e) => h('li.ko', h('span', '✗'), h('span', e))))
          : h('p.pos', 'Aucune anomalie : grille, bâtiments, ponts, finances et indicateurs sont cohérents.')
        : h('p.hint', 'Les contrôles vérifient la grille, les emprises, les ponts, les capacités et l\'égalité entre trésorerie et journal des transactions.')
    ];
  }
}
