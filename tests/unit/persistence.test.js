import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { newSession, getCatalog } from '../helpers/session.js';
import { buildStarterTown } from '../../src/app/scenarios.js';
import { GameSession } from '../../src/app/GameSession.js';
import { SaveService, serializeState, deserializeState } from '../../src/persistence/SaveService.js';
import { migrate, CURRENT_FORMAT_VERSION } from '../../src/persistence/SaveMigration.js';
import { SettingsService } from '../../src/persistence/SettingsService.js';
import { checksum } from '../../src/util/encoding.js';

/** Empreinte de l'état (hors métadonnées temporelles) pour comparer deux simulations. */
const fingerprint = (state) => {
  const d = serializeState(state);
  delete d.meta;
  return checksum(JSON.stringify(d));
};

describe('Sauvegardes', () => {
  let service;
  beforeEach(() => {
    service = new SaveService({ indexedDB: new IDBFactory() });
  });

  it('une partie rechargée reprend exactement la même simulation (déterminisme)', () => {
    const a = newSession();
    buildStarterTown(a);
    a.run(95);
    const restored = new GameSession({ catalog: getCatalog(), state: deserializeState(JSON.parse(JSON.stringify(serializeState(a.state)))) });
    a.run(140);
    restored.run(140);
    expect(restored.state.stats.population).toBe(a.state.stats.population);
    expect(restored.state.economy.treasury).toBe(a.state.economy.treasury);
    expect(fingerprint(restored.state)).toBe(fingerprint(a.state));
  });

  it('deux parties avec la même graine et les mêmes actions sont identiques', () => {
    const a = newSession();
    const b = newSession();
    buildStarterTown(a);
    buildStarterTown(b);
    a.run(200);
    b.run(200);
    expect(fingerprint(a.state)).toBe(fingerprint(b.state));
  });

  it('enregistre, liste, recharge et supprime des sauvegardes multiples', async () => {
    const s = newSession();
    buildStarterTown(s);
    s.run(40);
    const r1 = await service.save(s.state, { id: 'one', name: 'Première' });
    s.run(30);
    await service.save(s.state, { id: 'two', name: 'Seconde' });
    const list = await service.list();
    expect(list.map((x) => x.id).sort()).toEqual(['one', 'two']);
    expect(list[0].payload).toBeUndefined();
    const loaded = await service.load('one');
    expect(loaded.time.tick).toBe(40);
    expect(loaded.buildings.size).toBeGreaterThan(0);
    expect(r1.summary.population).toBe(loaded.stats.population);
    await service.remove('one');
    expect((await service.list()).map((x) => x.id)).toEqual(['two']);
  });

  it('refuse une sauvegarde corrompue sans rien écraser', async () => {
    const s = newSession();
    await service.save(s.state, { id: 'good', name: 'Valide' });
    const rec = await service.get('good');
    const corrupted = { ...rec, id: 'bad', payload: rec.payload.replace('"tick":0', '"tick":-5') };
    await new Promise((res, rej) => {
      const req = service.idb.open('urbis-2030', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('saves', 'readwrite');
        tx.objectStore('saves').put(corrupted);
        tx.oncomplete = res;
        tx.onerror = rej;
      };
    });
    await expect(service.load('bad')).rejects.toThrow(/corrompue/);
    // même avec une somme de contrôle recalculée, la validation détecte l'incohérence
    const forged = { ...corrupted, checksum: checksum(corrupted.payload) };
    expect(() => SaveService.parseRecord(forged)).toThrow(/invalide/);
    expect((await service.load('good')).time.tick).toBe(0);
  });

  it('la sauvegarde automatique alterne entre deux emplacements et n\'écrase pas la dernière valide en cas d\'échec', async () => {
    const s = newSession();
    await service.autosave(s.state);
    s.run(5);
    await service.autosave(s.state);
    let autos = (await service.list()).filter((x) => x.kind === 'auto');
    expect(autos.map((x) => x.id).sort()).toEqual(['auto-a', 'auto-b']);
    // état invalide : la sauvegarde est refusée et les deux emplacements restent intacts
    const before = await service.list();
    s.state.economy.treasury = 12.5;
    await expect(service.autosave(s.state)).rejects.toThrow(/refusée/);
    autos = await service.list();
    expect(autos.map((x) => x.updatedAt)).toEqual(before.map((x) => x.updatedAt));
  });

  it('migre explicitement une sauvegarde v1 (euros flottants) vers le format courant', () => {
    const s = newSession();
    const v2 = serializeState(s.state);
    const v1 = structuredClone(v2);
    v1.formatVersion = 1;
    v1.economy.treasury = v2.economy.treasury / 100;
    delete v1.world.layers.deliveryZone;
    const { data, applied } = migrate(v1);
    expect(applied).toEqual([1, 2, 3]);
    expect(data.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(data.economy.treasury).toBe(v2.economy.treasury);
    expect(deserializeState(v1).economy.treasury).toBe(v2.economy.treasury);
    expect(() => migrate({ ...v2, formatVersion: 99 })).toThrow(/plus récente/);
  });

  it('migre une sauvegarde v3 : améliorations vides et échanges régionaux désactivés', () => {
    const s = newSession();
    buildStarterTown(s);
    const v3 = structuredClone(serializeState(s.state));
    v3.formatVersion = 3;
    delete v3.trade;
    for (const b of v3.buildings) delete b.upgrades;
    const { data, applied } = migrate(v3);
    expect(applied).toEqual([3]);
    expect(data.trade.power).toEqual({ sell: false, buy: false });
    expect(data.buildings.every((b) => Array.isArray(b.upgrades))).toBe(true);
    const back = deserializeState(v3);
    expect(back.trade.waste.buy).toBe(false);
  });

  it('exporte et importe une partie via un fichier', async () => {
    const s = newSession();
    s.run(10);
    const text = service.exportRecord(s.state);
    const r = await service.importRecord(text);
    const back = await service.load(r.id);
    expect(back.time.tick).toBe(10);
    await expect(service.importRecord('{pas du json')).rejects.toThrow(/illisible/);
  });

  it('ne stocke pas d\'objets graphiques', () => {
    const s = newSession();
    const txt = JSON.stringify(serializeState(s.state));
    expect(txt).not.toMatch(/Graphics|texture|pixi/i);
  });
});

describe('Préférences', () => {
  it('fonctionne sans localStorage et conserve les valeurs en session', () => {
    const st = new SettingsService(null);
    expect(st.get('autosaveMinutes')).toBe(5);
    st.set('autosaveMinutes', 10);
    expect(st.get('autosaveMinutes')).toBe(10);
  });

  it('ignore une préférence corrompue', () => {
    const storage = { getItem: () => '{oups', setItem: () => {} };
    expect(new SettingsService(storage).get('showVehicles')).toBe(true);
  });
});
