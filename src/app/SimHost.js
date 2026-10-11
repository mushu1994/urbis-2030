import { serializeState } from '../persistence/SaveService.js';
import { SnapshotDecoder } from './SimSync.js';

/**
 * Hôte de la simulation : soit dans le fil principal (LocalSimHost), soit dans un Web Worker (WorkerSimHost).
 * GameApp ne voit que cette interface : tick() (un jour demandé par l'horloge), endFrame(), run(n), flush().
 */
export class LocalSimHost {
  /** @param {import('./GameSession.js').GameSession} session */
  constructor(session) {
    this.session = session;
    this.kind = 'local';
  }

  start() {
    return Promise.resolve(this);
  }

  tick() {
    this.session.sim.step(this.session.state);
  }

  endFrame() {}

  run(n) {
    this.session.run(n);
    return Promise.resolve();
  }

  flush() {
    return Promise.resolve();
  }

  get stats() {
    return { kind: 'local', label: 'Fil principal' };
  }

  destroy() {}
}

/** Jours demandés mais pas encore simulés au-delà desquels on abandonne le retard (comme l'horloge). */
const MAX_BACKLOG = 24;

/**
 * Simulation dans un Web Worker, réplique de l'état dans le fil principal.
 *
 * Les commandes du joueur sont appliquées tout de suite sur la réplique (réponse immédiate de l'interface :
 * coût, refus, annulation) puis transmises à la simulation, qui les applique dans le même ordre. À chaque
 * instantané reçu, la réplique est remplacée par l'état de la simulation, et les commandes pas encore
 * confirmées sont rejouées par-dessus. La simulation fait foi : un écart éventuel est signalé et corrigé.
 */
export class WorkerSimHost {
  /**
   * @param {{session: import('./GameSession.js').GameSession, createWorker: () => Worker, onError?: (err:Error) => void, timeoutMs?: number}} p
   */
  constructor({ session, createWorker, onError, timeoutMs = 12000 }) {
    this.session = session;
    this.createWorker = createWorker;
    this.onError = onError;
    this.timeoutMs = timeoutMs;
    this.kind = 'worker';
    this.seq = 0;
    this.pending = [];
    this.wanted = 0;
    this.requested = 0;
    this.ticksDone = 0;
    this.dropped = 0;
    this.snapshots = 0;
    this.applyMs = 0;
    this.lastApplyMs = 0;
    this.waiters = new Map();
    this.nextId = 1;
    this.touched = { tiles: new Set(), all: false, buildings: new Set() };
    this.replaying = false;
    this.capturing = true;
    this.decoder = new SnapshotDecoder(session);
    this.worker = null;
    this.alive = false;
  }

  /** Démarre le worker et lui transmet l'état. Rejette si le worker ne répond pas. */
  start() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.destroy();
        reject(err instanceof Error ? err : new Error(String(err?.message ?? err)));
      };
      const timer = setTimeout(() => fail(new Error('le worker de simulation ne répond pas')), this.timeoutMs);
      try {
        this.worker = this.createWorker();
      } catch (err) {
        fail(err);
        return;
      }
      this.worker.onerror = (e) => {
        e.preventDefault?.();
        if (!settled) fail(new Error(e.message || 'chargement du worker impossible'));
        else this.onError?.(new Error(e.message || 'erreur du worker'));
      };
      this.worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'error') {
          const err = new Error(msg.message);
          err.stack = msg.stack;
          if (!settled) fail(err);
          else this.onError?.(err);
          return;
        }
        if (msg.type !== 'snapshot') return;
        this.#apply(msg);
        if (msg.ready && !settled) {
          settled = true;
          clearTimeout(timer);
          this.alive = true;
          resolve(this);
        }
      };
      this.#hookBus();
      this.worker.postMessage({ type: 'init', save: serializeState(this.session.state), seq: this.seq });
    });
  }

  /** Branche la réplique : commandes transmises, événements structurels mémorisés, notifications rejouées muettes. */
  #hookBus() {
    const session = this.session;
    session.remote = this;
    const bus = session.bus;
    const emit = bus.emit.bind(bus);
    this.unhook = () => {
      bus.emit = emit;
      if (session.remote === this) session.remote = null;
    };
    bus.emit = (type, payload) => {
      if (this.capturing) {
        if (type === 'world:changed') {
          if (payload?.tiles) for (const i of payload.tiles) this.touched.tiles.add(i);
          else this.touched.all = true;
        } else if (type === 'building:added' || type === 'building:changed' || type === 'building:removed') {
          if (payload?.building) this.touched.buildings.add(payload.building.id);
        }
      }
      if (this.replaying && (type === 'notify' || type === 'command:done')) return;
      emit(type, payload);
    };
  }

  /** Une commande vient d'être appliquée sur la réplique : on la transmet à la simulation. */
  forward(cmd, result) {
    if (!this.alive) return;
    const seq = ++this.seq;
    this.pending.push({ seq, cmd, predicted: !!result?.ok });
    this.worker.postMessage({ type: 'cmd', seq, cmd });
  }

  tick() {
    this.wanted++;
  }

  endFrame() {
    if (!this.alive || this.wanted <= 0) return;
    const inFlight = this.requested - this.ticksDone;
    const room = Math.max(0, MAX_BACKLOG - inFlight);
    const n = Math.min(room, this.wanted);
    this.dropped += this.wanted - n;
    this.wanted = 0;
    if (n > 0) {
      this.requested += n;
      this.worker.postMessage({ type: 'advance', ticks: n });
    }
  }

  #request(type, extra = {}) {
    if (!this.alive) return Promise.resolve();
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
      if (extra.ticks) this.requested += extra.ticks;
      this.worker.postMessage({ type, id, ...extra });
    });
  }

  /** Avance explicite de n jours (débogage, tests) ; résolue quand la réplique est à jour. */
  run(n) {
    return this.#request('run', { ticks: Math.max(0, n | 0) });
  }

  /** Attend que toutes les commandes et tous les jours demandés soient appliqués (avant une sauvegarde). */
  flush() {
    return this.#request('flush');
  }

  #apply(msg) {
    const t0 = performance.now();
    const session = this.session;
    const prevRoads = session.state.revisions.roads;
    this.capturing = false;
    this.decoder.apply(msg);
    this.ticksDone = msg.ticksDone ?? this.ticksDone;
    this.snapshots++;
    if (session.state.revisions.roads !== prevRoads || msg.full) {
      session.sim.network.rebuild(session.state);
      session.sim.network.computeReach(session.state);
    }

    // Commandes confirmées : écart éventuel entre prédiction et simulation
    let mismatch = false;
    for (const r of msg.results ?? []) {
      const p = this.pending.find((x) => x.seq === r.seq);
      if (p && p.predicted && !r.ok) {
        mismatch = true;
        session.bus.emit('notify', { level: 'warning', message: `Action annulée par la simulation : ${(r.messages ?? []).join(' · ') || 'situation changée entre-temps'}` });
      }
    }
    this.pending = this.pending.filter((p) => p.seq > (msg.ackSeq ?? 0));

    // Les commandes pas encore reçues par la simulation sont rejouées sur la réplique
    const previous = this.touched;
    this.touched = { tiles: new Set(), all: false, buildings: new Set() };
    if (this.pending.length) {
      this.capturing = true;
      this.replaying = true;
      for (const p of this.pending) {
        const r = session.applyCommand(p.cmd);
        p.predicted = !!r?.ok;
      }
      this.replaying = false;
      this.capturing = false;
    }

    // Rendu : cases et bâtiments touchés côté simulation et côté prédiction
    const tiles = new Set(previous.tiles);
    for (const i of this.touched.tiles) tiles.add(i);
    for (const i of msg.touched?.tiles ?? []) tiles.add(i);
    const buildings = new Set(previous.buildings);
    for (const id of this.touched.buildings) buildings.add(id);
    for (const id of msg.touched?.buildings ?? []) buildings.add(id);
    const all = mismatch || msg.full || previous.all || this.touched.all || msg.touched?.tiles === null;
    if (all || tiles.size || buildings.size) session.bus.emit('sync:dirty', { tiles: all ? null : [...tiles], buildings: [...buildings], all });

    // Événements de la simulation (notifications, fin de mois, crises, météo…)
    for (const ev of msg.events ?? []) session.bus.emit(ev.type, ev.payload);
    if (msg.ticksDone !== undefined) session.bus.emit('sim:advanced', { tick: session.state.time.tick });
    this.capturing = true;

    for (const id of msg.done ?? []) {
      const resolve = this.waiters.get(id);
      this.waiters.delete(id);
      resolve?.();
    }
    this.lastApplyMs = performance.now() - t0;
    this.applyMs = this.applyMs ? this.applyMs * 0.9 + this.lastApplyMs * 0.1 : this.lastApplyMs;
  }

  get stats() {
    return {
      kind: 'worker',
      label: 'Web Worker',
      snapshots: this.snapshots,
      applyMs: this.applyMs,
      pending: this.pending.length,
      backlog: Math.max(0, this.requested - this.ticksDone),
      dropped: this.dropped
    };
  }

  destroy() {
    this.alive = false;
    this.unhook?.();
    this.unhook = null;
    for (const resolve of this.waiters.values()) resolve();
    this.waiters.clear();
    try {
      this.worker?.terminate();
    } catch {
      /* déjà arrêté */
    }
    this.worker = null;
  }
}
