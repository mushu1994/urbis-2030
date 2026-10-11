import { EventBus } from './EventBus.js';
import { GameSession } from './GameSession.js';
import { deserializeState } from '../persistence/SaveService.js';
import { SnapshotEncoder, EventRecorder } from './SimSync.js';

/** Intervalle minimal entre deux instantanés envoyés pendant que le temps s'écoule (ms). */
export const SNAPSHOT_INTERVAL_MS = 110;
/** Temps de calcul maximal d'un cycle avant de rendre la main (réception des messages). */
const SLICE_MS = 40;

/**
 * Cœur de la simulation exécutée dans un Web Worker (sans dépendance au navigateur : testable sous Node).
 *
 * Protocole (fil principal → simulation) :
 *  - { type:'init', save, seq }              état complet (format de sauvegarde)
 *  - { type:'cmd', seq, cmd }                commande du joueur, appliquée dans l'ordre d'arrivée
 *  - { type:'advance', ticks }               jours de simulation à exécuter (horloge du fil principal)
 *  - { type:'run', ticks, id }               avance explicite (débogage, tests) ; réponse quand c'est fait
 *  - { type:'flush', id }                    tout appliquer puis répondre par un instantané complet
 * Réponses : { type:'ready' }, { type:'snapshot', ackSeq, results, events, touched, done:[ids], … },
 *            { type:'error', message }.
 */
export class SimWorkerCore {
  /**
   * @param {{catalog: any, post: (msg:any, transfer?:ArrayBuffer[]) => void, now?: () => number, schedule?: (fn:() => void, ms:number) => any}} deps
   */
  constructor({ catalog, post, now = () => performance.now(), schedule = (fn, ms) => setTimeout(fn, ms) }) {
    this.catalog = catalog;
    this.post = post;
    this.now = now;
    this.schedule = schedule;
    this.session = null;
    this.queue = [];
    this.pendingTicks = 0;
    this.ticksDone = 0;
    this.ackSeq = 0;
    this.results = [];
    this.done = [];
    this.lastPost = 0;
    this.scheduled = false;
    this.postTimer = null;
    this.dirtySince = false;
    this.commandsApplied = false;
  }

  handle(msg) {
    try {
      switch (msg.type) {
        case 'init':
          return this.#init(msg);
        case 'cmd':
        case 'run':
        case 'flush':
          this.queue.push(msg);
          break;
        case 'advance':
          this.pendingTicks += Math.max(0, msg.ticks | 0);
          break;
        default:
          return;
      }
      this.#kick();
    } catch (err) {
      this.#fail(err);
    }
  }

  #init(msg) {
    const state = deserializeState(msg.save);
    const bus = new EventBus();
    this.recorder = new EventRecorder(bus);
    this.session = new GameSession({ catalog: this.catalog, state, bus });
    this.encoder = new SnapshotEncoder(this.session);
    this.ackSeq = msg.seq ?? 0;
    this.queue = [];
    this.pendingTicks = 0;
    this.recorder.drain();
    this.#post({ full: true, undo: true, extra: { ready: true } });
  }

  #kick() {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      this.process();
    }, 0);
  }

  /** Applique les messages en attente puis les jours demandés, par tranches de SLICE_MS. */
  process() {
    if (!this.session) return;
    try {
      const t0 = this.now();
      let urgent = false;
      let flush = false;
      while (this.queue.length) {
        const m = this.queue[0];
        if (m.type === 'cmd') {
          this.recorder.phase = 'command';
          const r = this.session.execute(m.cmd);
          this.recorder.phase = 'tick';
          this.ackSeq = m.seq;
          this.results.push({ seq: m.seq, ok: !!r?.ok, messages: r?.messages ?? (r?.reason ? [r.reason] : r?.reasons) ?? [] });
          this.commandsApplied = true;
          urgent = true;
        } else if (m.type === 'run') {
          // Avance explicite : exécutée en entier, sans tranche (débogage, tests)
          this.session.run(m.ticks);
          this.ticksDone += m.ticks;
          this.done.push(m.id);
          urgent = true;
        } else if (m.type === 'flush') {
          this.#runTicks(Infinity);
          this.done.push(m.id);
          flush = true;
          urgent = true;
        }
        this.queue.shift();
        if (this.now() - t0 > SLICE_MS) break;
      }
      if (!this.queue.length) this.#runTicks(SLICE_MS - (this.now() - t0));
      if (urgent) this.#post({ full: flush, undo: this.commandsApplied || flush });
      else this.#maybePost();
      if (this.queue.length || this.pendingTicks > 0) this.#kick();
    } catch (err) {
      this.#fail(err);
    }
  }

  #runTicks(budgetMs) {
    const t0 = this.now();
    while (this.pendingTicks > 0) {
      this.session.sim.step(this.session.state);
      this.pendingTicks--;
      this.ticksDone++;
      this.dirtySince = true;
      if (this.now() - t0 > budgetMs) break;
    }
  }

  #maybePost() {
    if (!this.dirtySince) return;
    const wait = SNAPSHOT_INTERVAL_MS - (this.now() - this.lastPost);
    if (wait <= 0) return this.#post({});
    if (this.postTimer) return;
    this.postTimer = this.schedule(() => {
      this.postTimer = null;
      if (this.dirtySince) this.#post({});
    }, wait);
  }

  #post({ full = false, undo = false, extra = {} }) {
    const { msg, transfer } = this.encoder.encode({ full, undo });
    const { events, touched } = this.recorder.drain();
    Object.assign(msg, extra, {
      ackSeq: this.ackSeq,
      results: this.results,
      events,
      touched,
      done: this.done,
      ticksDone: this.ticksDone,
      backlog: this.pendingTicks
    });
    this.results = [];
    this.done = [];
    this.dirtySince = false;
    this.commandsApplied = false;
    this.lastPost = this.now();
    this.post(msg, transfer);
  }

  #fail(err) {
    this.post({ type: 'error', message: err?.message ?? String(err), stack: err?.stack ?? '' });
  }
}
