import { describe, it, expect } from 'vitest';
import { newSession, getCatalog } from '../helpers/session.js';
import { buildStarterTown } from '../../src/app/scenarios.js';
import { serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { GameSession } from '../../src/app/GameSession.js';
import { SimWorkerCore } from '../../src/app/SimWorkerCore.js';
import { WorkerSimHost } from '../../src/app/SimHost.js';

/**
 * Faux Web Worker : messages clonés (et tableaux transférés) comme par postMessage, horloge simulée,
 * livraison pas à pas pour reproduire les commandes « en vol » pendant un calcul.
 */
class FakeWorker {
  constructor() {
    this.clock = 0;
    this.tasks = [];
    this.inbox = [];
    this.outbox = [];
    this.onmessage = null;
    this.core = new SimWorkerCore({
      catalog: getCatalog(),
      post: (msg, transfer) => this.outbox.push(structuredClone(msg, { transfer: transfer ?? [] })),
      now: () => this.clock,
      schedule: (fn, ms) => {
        this.tasks.push({ fn, at: this.clock + ms });
        return this.tasks.length;
      }
    });
  }

  postMessage(msg) {
    this.inbox.push(structuredClone(msg));
  }

  terminate() {}

  /** Livre les messages reçus à la simulation et exécute ses tâches échues (sans renvoyer les réponses). */
  work(ms = 200) {
    this.clock += ms;
    while (this.inbox.length) this.core.handle(this.inbox.shift());
    for (let guard = 0; guard < 50; guard++) {
      const due = this.tasks.filter((t) => t.at <= this.clock);
      if (!due.length) break;
      this.tasks = this.tasks.filter((t) => t.at > this.clock);
      for (const t of due) t.fn();
      while (this.inbox.length) this.core.handle(this.inbox.shift());
    }
  }

  /** Remet les réponses de la simulation au fil principal. */
  deliver() {
    while (this.outbox.length) this.onmessage?.({ data: this.outbox.shift() });
  }

  pump(ms = 200) {
    this.work(ms);
    this.deliver();
  }
}

function stateOf(session) {
  const d = serializeState(session.state);
  delete d.meta;
  return d;
}

async function startHost(session) {
  const fake = new FakeWorker();
  const host = new WorkerSimHost({ session, createWorker: () => fake, timeoutMs: 1000 });
  const p = host.start();
  fake.pump();
  await p;
  return { host, fake };
}

describe('Simulation dans un Web Worker', () => {
  it('la réplique du fil principal est identique à l\'état de la simulation après synchronisation', async () => {
    const s = newSession();
    buildStarterTown(s);
    s.run(40);
    const { host, fake } = await startHost(s);
    const worker = () => fake.core.session;
    expect(stateOf(s)).toEqual(stateOf(worker()));

    // Jours demandés par l'horloge, commandes envoyées pendant que la simulation calcule (« en vol »)
    const row = s.state.grid.yOf(s.state.entries[0]);
    for (let k = 0; k < 40; k++) {
      for (let t = 0; t < 3; t++) host.tick();
      host.endFrame();
      if (k % 7 === 2) {
        fake.work(); // la simulation avance mais sa réponse n'est pas encore arrivée
        const r = s.execute({ type: 'zone', zoneId: k % 2 ? 'R_LOW' : 'C', rect: { x0: 12 + k, y0: row - 3, x1: 13 + k, y1: row - 2 } });
        expect(typeof r.ok).toBe('boolean');
      }
      if (k === 20) s.execute({ type: 'tax', key: 'R', value: 11 });
      if (k === 25) s.execute({ type: 'undo' });
      fake.pump(k % 3 ? 40 : 150);
    }
    const flushed = host.flush();
    fake.pump();
    await flushed;
    expect(host.pending.length).toBe(0);
    expect(stateOf(s)).toEqual(stateOf(worker()));
    expect(s.state.time.tick).toBeGreaterThan(60);
    expect(s.history.entries).toEqual(worker().history.entries);
    host.destroy();
  });

  it('même résultat qu\'une simulation dans le fil principal (déterminisme conservé)', async () => {
    const a = newSession();
    buildStarterTown(a);
    a.run(30);
    const ref = new GameSession({ catalog: getCatalog(), state: deserializeState(JSON.parse(JSON.stringify(serializeState(a.state)))) });
    const { host, fake } = await startHost(a);
    const row = a.state.grid.yOf(a.state.entries[0]);
    for (let k = 0; k < 6; k++) {
      const cmd = { type: 'zone', zoneId: 'R_HIGH', rect: { x0: 15 + 2 * k, y0: row + 2, x1: 16 + 2 * k, y1: row + 3 } };
      a.execute(cmd);
      ref.execute(cmd);
      fake.pump();
      const done = a.run(25);
      fake.pump();
      await done;
      ref.run(25);
    }
    const flushed = host.flush();
    fake.pump();
    await flushed;
    expect(stateOf(a)).toEqual(stateOf(ref));
    host.destroy();
  });

  it('relaie les événements de la simulation et signale les cases à redessiner', async () => {
    const s = newSession();
    buildStarterTown(s);
    const { host, fake } = await startHost(s);
    const seen = { month: 0, dirty: 0, notify: 0 };
    s.bus.on('sim:month', () => seen.month++);
    s.bus.on('sync:dirty', () => seen.dirty++);
    s.bus.on('notify', () => seen.notify++);
    const p = s.run(65);
    fake.pump();
    await p;
    expect(seen.month).toBe(2);
    expect(seen.dirty).toBeGreaterThan(0);
    // Une commande prédite n'est notifiée qu'une fois (pas de doublon au retour de la simulation)
    const before = seen.notify;
    a: {
      const r = s.execute({ type: 'research', techId: 'predictive_maintenance' });
      if (!r.ok) break a;
      fake.pump();
      expect(seen.notify - before).toBe(1);
    }
    host.destroy();
  });
});
