import { describe, it, expect } from 'vitest';
import { newSession } from '../helpers/session.js';
import { SaveService } from '../../src/persistence/SaveService.js';
import { ToolController } from '../../src/app/ToolController.js';

describe('v1.7.1 — sauvegardes après une coupure de la base (Safari sur iPad)', () => {
  it('la connexion fermée par le navigateur est rouverte : la sauvegarde suivante réussit', async () => {
    const s = newSession();
    const name = `urbis-test-${Math.random().toString(36).slice(2)}`;
    // Base dédiée au test, avec le même schéma que le jeu
    const idb = {
      open: (_n, v) => indexedDB.open(name, v),
      deleteDatabase: (n) => indexedDB.deleteDatabase(n)
    };
    const saves = new SaveService({ indexedDB: idb });
    await saves.save(s.state, { id: 'a', name: 'A' });
    // Un autre onglet (ou Safari) fait évoluer la base : la connexion du jeu se ferme
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 2);
      req.onupgradeneeded = () => {};
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    const idb2 = { open: (_n) => indexedDB.open(name), deleteDatabase: (n) => indexedDB.deleteDatabase(n) };
    saves.idb = idb2;
    const r = await saves.save(s.state, { id: 'b', name: 'B' });
    expect(r.id).toBe('b');
    expect((await saves.list()).map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
});

describe('v1.7.1 — pincer pour zoomer pendant un tracé', () => {
  function tools(kind) {
    const previews = [];
    const tc = new ToolController({
      getSession: () => null,
      renderer: { setPreview: (p) => previews.push(p), setHover: () => {} },
      tooltip: { hidden: true, innerHTML: '', append() {}, classList: { toggle() {}, remove() {} } },
      onSelect: () => {},
      notify: () => {},
      needsConfirm: () => false,
      confirm: async () => true
    });
    tc.setTool({ id: kind, kind, mode: 'bus' });
    return tc;
  }

  it('ligne de bus : les arrêts déjà choisis restent quand un deuxième doigt se pose', () => {
    const tc = tools('line');
    tc.lineStops = [4, 7, 9];
    tc.pending = { line: true };
    expect(tc.abortStroke()).toBe(false);
    expect(tc.lineStops).toEqual([4, 7, 9]);
    expect(tc.pending).toEqual({ line: true });
  });

  it('zonage : seul le rectangle en cours de glissé est abandonné', () => {
    const tc = tools('zone');
    tc.dragStart = { x: 3, y: 3 };
    expect(tc.abortStroke()).toBe(true);
    expect(tc.dragStart).toBeNull();
  });

  it('bâtiment en attente de validation : conservé', () => {
    const tc = tools('building');
    tc.pending = { tile: { x: 5, y: 5 } };
    tc.abortStroke();
    expect(tc.pending).toEqual({ tile: { x: 5, y: 5 } });
  });
});
