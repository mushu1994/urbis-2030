import { describe, it, expect } from 'vitest';
import { newSession } from '../helpers/session.js';
import { buildStarterTown } from '../../src/app/scenarios.js';
import { firstRound } from '../../src/simulation/ElectorateSystem.js';
import { FRAUD_LEVELS, fraudCost, discoveredThisMonth, fraudScandalFactor, FRAUD_ANNUL_MONTHS } from '../../src/simulation/ElectionFraud.js';
import { SIM } from '../../src/simulation/config.js';

/** Bourg habité (un an et demi), élections activées, campagne ouverte. */
function campaignTown() {
  const s = newSession();
  s.state.economy.treasury += 2_000_000_00;
  buildStarterTown(s, { size: 'large' });
  s.run(450);
  s.execute({ type: 'debug', op: 'election', months: 3 });
  s.run(30);
  return s;
}
const month = (st) => Math.floor(st.time.tick / SIM.DAYS_PER_MONTH);

describe('v1.6 — bourrage des urnes', () => {
  it('possible seulement pendant la campagne, une fois par scrutin, payé sur la trésorerie', () => {
    const s = newSession();
    expect(s.sim.politics.fraudPreview(s.state, { level: 'discreet' }).ok).toBe(false);
    const t = campaignTown();
    const st = t.state;
    expect(st.politics.campaign).toBeTruthy();
    const cost = fraudCost(st, 'massive');
    expect(cost).toBeGreaterThan(fraudCost(st, 'discreet'));
    const before = st.economy.treasury;
    const r = t.execute({ type: 'politics', op: 'fraud', level: 'massive' });
    expect(r.ok).toBe(true);
    expect(before - st.economy.treasury).toBe(cost * 100);
    expect(st.politics.campaign.fraud.level).toBe('massive');
    expect(t.execute({ type: 'politics', op: 'fraud', level: 'discreet' }).ok).toBe(false);
  });

  it('les faux bulletins font gagner environ 2 points (discret) et 4 à 5 points (massif)', () => {
    const t = campaignTown();
    const st = t.state;
    const share = (stuffing) => firstRound(st, { base: 48, stuffing }).lists.find((l) => l.id === 'mayor').share;
    const honest = share(0);
    const d = share(FRAUD_LEVELS.discreet.ballots) - honest;
    const m = share(FRAUD_LEVELS.massive.ballots) - honest;
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(3);
    expect(m).toBeGreaterThan(4);
    expect(m).toBeLessThan(6);
  });

  it('un scrutin truqué gagné laisse une fraude en suspens ; le résultat honnête est conservé pour le bilan', () => {
    const t = campaignTown();
    const st = t.state;
    st.politics.approval = 62;
    const saved = FRAUD_LEVELS.massive.countRisk;
    FRAUD_LEVELS.massive.countRisk = 0;
    t.execute({ type: 'politics', op: 'fraud', level: 'massive' });
    t.run(120);
    FRAUD_LEVELS.massive.countRisk = saved;
    if (st.politics.secondRound) t.execute({ type: 'politics', op: 'secondRound', mergeWith: null });
    const e = st.politics.elections.at(-1);
    expect(e.fraud.level).toBe('massive');
    expect(e.fraud.caught).toBe(false);
    expect(e.fraud.honestShare).toBeLessThan(e.share);
    if (e.won) expect(st.politics.fraudPending?.level).toBe('massive');
  });

  it('repérée au dépouillement : faux bulletins annulés et scandale immédiat', () => {
    const t = campaignTown();
    const st = t.state;
    st.politics.approval = 62;
    const saved = FRAUD_LEVELS.discreet.countRisk;
    FRAUD_LEVELS.discreet.countRisk = 1;
    t.execute({ type: 'politics', op: 'fraud', level: 'discreet' });
    const press = st.controversies.press;
    t.run(120);
    FRAUD_LEVELS.discreet.countRisk = saved;
    if (st.politics.secondRound) t.execute({ type: 'politics', op: 'secondRound', mergeWith: null });
    const e = st.politics.elections.at(-1);
    expect(e.fraud.caught).toBe(true);
    expect(e.fraud.honestShare).toBeNull();
    expect(st.politics.fraudPending).toBeFalsy();
    expect(st.politics.memory.fraud.atCount).toBe(true);
    expect(st.controversies.affairs.some((a) => a.kind === 'fraud')).toBe(true);
    expect(st.controversies.press).toBeLessThan(press);
  });

  it('découverte pendant le mandat : chute de popularité, affaire, presse, adjoints, amende et annulation dans les 18 mois', () => {
    const t = campaignTown();
    const st = t.state;
    const p = st.politics;
    p.campaign = null;
    p.termStart = month(st);
    p.nextElection = p.termStart + 72;
    const pending = { level: 'massive', month: p.termStart, mandate: p.mandate, cost: 100_000 };
    // Premier mois où l'enquête aboutit (tirage déterministe)
    let tick = st.time.tick;
    while (!discoveredThisMonth({ ...st, time: { tick } }, pending)) tick += SIM.DAYS_PER_MONTH;
    st.time.tick = tick;
    p.termStart = month(st) - 3;
    p.fraudPending = pending;
    p.council.members.push({ id: 99, name: 'Test', delegation: 'finance', competence: 3, loyalty: 70, ambition: 2, notoriety: 0 });
    const approval = p.approval;
    const treasury = st.economy.treasury;
    t.sim.politics.monthly(st);
    expect(p.fraudPending).toBeNull();
    expect(p.memory.fraud.level).toBe('massive');
    expect(p.approval).toBeLessThan(approval);
    expect(fraudScandalFactor(st).value).toBeLessThan(-10);
    expect(p.factors.some((f) => f.id === 'fraud')).toBe(true);
    expect(st.controversies.affairs.some((a) => a.kind === 'fraud')).toBe(true);
    expect(p.council.members.find((m) => m.id === 99).loyalty).toBe(55);
    expect(st.economy.treasury).toBeLessThan(treasury);
    expect(month(st) - p.termStart).toBeLessThan(FRAUD_ANNUL_MONTHS);
    expect(p.early).toBe(true);
    expect(p.nextElection - month(st)).toBeLessThanOrEqual(6);
    // L'adversaire s'en sert pendant la campagne suivante
    expect(t.sim.politics.rivalEdge(st)).toBeGreaterThanOrEqual(2);
  });

  it('le scandale s\'estompe en trois ans', () => {
    const t = campaignTown();
    const st = t.state;
    st.politics.memory.fraud = { level: 'discreet', month: month(st) - 35 };
    expect(fraudScandalFactor(st).value).toBeGreaterThan(-1);
    st.politics.memory.fraud.month = month(st) - 36;
    expect(fraudScandalFactor(st)).toBeNull();
  });
});

import { encodeRecord, decodeRecord, decodeToText, fileNameFor } from '../../src/persistence/SaveCodec.js';
import { GoogleDriveSaves, CloudAuthError } from '../../src/cloud/GoogleDrive.js';
import { CloudSync } from '../../src/cloud/CloudSync.js';
import { SaveService } from '../../src/persistence/SaveService.js';

describe('v1.6 — fichiers de partie (.urbis)', () => {
  it('compressés en gzip, relus à l\'identique ; anciens exports JSON acceptés', async () => {
    const s = newSession();
    const rec = new SaveService({ indexedDB: null }).buildRecord(s.state, { id: 'x', name: 'Test', kind: 'manual' });
    const bytes = await encodeRecord(rec);
    expect(bytes[0]).toBe(0x1f);
    expect(bytes.length).toBeLessThan(JSON.stringify(rec).length / 2);
    const back = await decodeRecord(bytes);
    expect(back.checksum).toBe(rec.checksum);
    expect(SaveService.parseRecord(back).meta.name).toBe('Test');
    expect(await decodeToText(new TextEncoder().encode('{"a":1}'))).toBe('{"a":1}');
    await expect(decodeRecord(new TextEncoder().encode('{"a":1}'))).rejects.toThrow(/URBIS/);
    expect(fileNameFor('Saint-Étienne d\'Été')).toBe('Saint-Etienne_d_Ete.urbis');
  });
});

/** Faux Google Drive (fetch) : dossiers, fichiers, permissions, jeton. */
function fakeDrive() {
  const files = new Map();
  const calls = [];
  let n = 0;
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
  const parseMultipart = async (body) => {
    const text = Buffer.from(await body.arrayBuffer()).toString('latin1');
    const meta = JSON.parse(text.split('\r\n\r\n')[1].split('\r\n--')[0]);
    const start = text.indexOf('\r\n\r\n', text.indexOf('Content-Type: application/octet-stream')) + 4;
    const end = text.lastIndexOf('\r\n--');
    return { meta, bytes: Buffer.from(text.slice(start, end), 'latin1') };
  };
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ method: opts.method ?? 'GET', url: u, auth: opts.headers?.Authorization });
    if (u.searchParams.get('key')) {
      const id = u.pathname.split('/').pop();
      const f = files.get(id);
      return f?.public ? new Response(f.bytes) : json({ error: { message: 'not found' } }, 404);
    }
    if (opts.headers?.Authorization !== 'Bearer ok') return json({ error: { message: 'auth' } }, 401);
    const path = u.pathname;
    if (path.endsWith('/permissions')) {
      files.get(path.split('/').at(-2)).public = true;
      return json({ id: 'p1' });
    }
    if (path.startsWith('/upload/')) {
      const { meta, bytes } = await parseMultipart(opts.body);
      const id = opts.method === 'PATCH' ? path.split('/').pop() : `file${++n}xxxxxxxx`;
      const prev = files.get(id) ?? {};
      files.set(id, { ...prev, ...meta, id, bytes, parents: meta.parents ?? prev.parents, modifiedTime: new Date().toISOString(), size: bytes.length });
      return json(files.get(id));
    }
    if (path === '/drive/v3/files' && opts.method === 'POST') {
      const meta = JSON.parse(opts.body);
      const id = `folder${++n}xxxxxxx`;
      files.set(id, { ...meta, id });
      return json({ id });
    }
    if (path === '/drive/v3/files') {
      const q = u.searchParams.get('q');
      const list = [...files.values()].filter((f) => !f.trashed && (
        (/mimeType='application\/vnd.google-apps.folder'/.test(q) && f.mimeType === 'application/vnd.google-apps.folder' && q.includes(`name='${f.name}'`))
        || (!/mimeType=/.test(q) && f.parents?.some((p) => q.includes(`'${p}' in parents`)) && (!/key='urbis'/.test(q) || f.appProperties?.urbis === '1') && (!/saveKey/.test(q) || q.includes(`value='${f.appProperties?.saveKey}'`)))));
      return json({ files: list });
    }
    const id = path.split('/').pop();
    const f = files.get(id);
    if (!f) return json({ error: { message: 'nf' } }, 404);
    if (u.searchParams.get('alt') === 'media') return new Response(f.bytes);
    if (opts.method === 'PATCH') {
      Object.assign(f, JSON.parse(opts.body));
      return json(f);
    }
    return json(f);
  };
  return { files, calls, fetch };
}

function settingsStub() {
  const v = {};
  return { get: (k) => v[k], set: (k, x) => { v[k] = x; } };
}

describe('v1.6 — sauvegarde Google Drive et partage', () => {
  const s = newSession();
  const saves = new SaveService({ indexedDB: null });
  const rec = saves.buildRecord(s.state, { id: 'manual-1', name: 'Test', kind: 'manual' });

  it('sans identifiant client : non configurée ; sans jeton : erreur de connexion explicite', async () => {
    const d = new GoogleDriveSaves({ settings: settingsStub(), clientId: '', apiKey: '', fetch: fakeDrive().fetch });
    expect(d.configured).toBe(false);
    await expect(d.list()).rejects.toBeInstanceOf(CloudAuthError);
  });

  it('une ville = un fichier dans le dossier « URBIS 2030 », remplacé à chaque sauvegarde', async () => {
    const fake = fakeDrive();
    const d = new GoogleDriveSaves({ settings: settingsStub(), clientId: 'id', apiKey: 'key', fetch: fake.fetch });
    d.token = 'ok';
    d.expires = Date.now() + 3600_000;
    const key = CloudSync.keyFor(s.state);
    await d.upload(rec, { saveKey: key });
    await d.upload(rec, { saveKey: key });
    const list = await d.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Test');
    expect(list[0].saveKey).toBe(key);
    const folder = [...fake.files.values()].find((f) => f.name === 'URBIS 2030');
    expect(folder.mimeType).toBe('application/vnd.google-apps.folder');
    const back = await d.download(list[0].fileId);
    expect(back.checksum).toBe(rec.checksum);
  });

  it('partage : copie lisible avec le lien ; l\'ami la télécharge sans compte (clé d\'API)', async () => {
    const fake = fakeDrive();
    const d = new GoogleDriveSaves({ settings: settingsStub(), clientId: 'id', apiKey: 'key', fetch: fake.fetch });
    d.token = 'ok';
    d.expires = Date.now() + 3600_000;
    const { fileId, url } = await d.share(rec, { gameUrl: 'https://exemple.github.io/urbis-2030/?x=1#y' });
    expect(url).toBe(`https://exemple.github.io/urbis-2030/?partie=${fileId}`);
    expect(fake.files.get(fileId).public).toBe(true);
    const friend = new GoogleDriveSaves({ settings: settingsStub(), clientId: 'id', apiKey: 'key', fetch: fake.fetch });
    const got = await friend.downloadShared(fileId);
    expect(got.checksum).toBe(rec.checksum);
    expect(fake.calls.at(-1).auth).toBeUndefined();
    // Les partages ne se mêlent pas aux sauvegardes de la ville
    expect(await d.list()).toHaveLength(0);
  });

  it('jeton refusé : erreur de connexion, le jeton est oublié', async () => {
    const d = new GoogleDriveSaves({ settings: settingsStub(), clientId: 'id', apiKey: '', fetch: fakeDrive().fetch });
    d.token = 'expiré';
    d.expires = Date.now() + 3600_000;
    await expect(d.list()).rejects.toBeInstanceOf(CloudAuthError);
    expect(d.connected).toBe(false);
  });
});
