import { encodeRecord, decodeRecord, fileNameFor } from '../persistence/SaveCodec.js';

/**
 * v1.6 — sauvegarde en ligne sur le Google Drive du joueur, et partage de parties.
 *
 * Tout se passe dans le navigateur, sans serveur : la connexion utilise Google Identity Services (jeton d'accès
 * OAuth valable une heure), les fichiers passent par l'API Google Drive.
 *
 * - Droit demandé : `drive.file`. Le jeu ne voit QUE les fichiers qu'il a lui-même créés (dossier « URBIS 2030 »
 *   du Drive du joueur), jamais le reste du Drive. C'est un droit « non sensible » : pas de validation Google.
 * - Chaque partie est un fichier « .urbis » (enregistrement de sauvegarde compressé, voir SaveCodec.js), avec des
 *   propriétés d'application (clé de sauvegarde, ville, habitants, date de jeu) pour lister sans télécharger.
 * - Partager : copie de la partie dans le sous-dossier « Partages », lisible par toute personne qui a le lien.
 *   L'ami qui ouvre le lien du jeu télécharge la copie avec la clé d'API publique du jeu (sans compte Google).
 *
 * Configuration (une fois, par l'auteur du jeu) : variables d'environnement de build `VITE_GOOGLE_CLIENT_ID`
 * (identifiant client OAuth « Application Web ») et `VITE_GOOGLE_API_KEY` (clé d'API limitée à Google Drive).
 * Voir le README, section « Sauvegarde Google et partage ».
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'URBIS 2030';
const SHARE_FOLDER = 'Partages';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_MIME = 'application/octet-stream';
const TOKEN_KEY = 'urbis2030.gtoken';
const FIELDS = 'id,name,modifiedTime,size,appProperties';

const env = (() => {
  try {
    return import.meta.env ?? {};
  } catch {
    return {};
  }
})();

/** Erreur de connexion (jeton absent ou expiré) : l'interface propose de se reconnecter. */
export class CloudAuthError extends Error {
  constructor(message = 'Connexion Google expirée : reconnectez-vous') {
    super(message);
    this.name = 'CloudAuthError';
  }
}

let gisPromise = null;
function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve(globalThis.google);
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (globalThis.google?.accounts?.oauth2 ? resolve(globalThis.google) : reject(new Error('Service de connexion Google indisponible')));
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Impossible de joindre Google (connexion internet ?)'));
    };
    document.head.append(s);
  });
  return gisPromise;
}

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class GoogleDriveSaves {
  /** @param {{settings:any, clientId?:string, apiKey?:string, fetch?:typeof fetch}} opts */
  constructor({ settings, clientId, apiKey, fetch: f } = {}) {
    this.settings = settings;
    this.clientId = clientId ?? settings?.get('googleClientId') ?? env.VITE_GOOGLE_CLIENT_ID ?? '';
    this.apiKey = apiKey ?? settings?.get('googleApiKey') ?? env.VITE_GOOGLE_API_KEY ?? '';
    this.fetch = f ?? globalThis.fetch?.bind(globalThis);
    this.token = null;
    this.expires = 0;
    this.email = settings?.get('cloudEmail') ?? null;
    this.listeners = new Set();
    this.#restoreToken();
  }

  /** La sauvegarde Google est-elle configurée pour ce build ? */
  get configured() {
    return !!this.clientId;
  }

  /** Le partage par lien est-il possible (clé d'API publique pour télécharger sans compte) ? */
  get linkSharing() {
    return !!this.apiKey;
  }

  /** Jeton valable (au moins une minute de marge). */
  get connected() {
    return !!this.token && Date.now() < this.expires - 60_000;
  }

  /** Le joueur s'était déjà connecté (jeton expiré depuis) : un clic suffit pour reprendre. */
  get known() {
    return !!this.email || this.connected;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit() {
    for (const fn of this.listeners) fn(this);
  }

  #restoreToken() {
    try {
      const raw = globalThis.sessionStorage?.getItem(TOKEN_KEY);
      if (!raw) return;
      const t = JSON.parse(raw);
      if (t?.token && t.expires > Date.now() + 60_000) {
        this.token = t.token;
        this.expires = t.expires;
      }
    } catch {
      /* stockage de session indisponible */
    }
  }

  #storeToken() {
    try {
      if (this.token) globalThis.sessionStorage?.setItem(TOKEN_KEY, JSON.stringify({ token: this.token, expires: this.expires }));
      else globalThis.sessionStorage?.removeItem(TOKEN_KEY);
    } catch {
      /* rien */
    }
  }

  /** Charge à l'avance le service de connexion (la fenêtre Google doit s'ouvrir dans le geste du joueur). */
  preload() {
    if (this.configured && typeof document !== 'undefined') loadGis().catch(() => {});
  }

  /**
   * Connexion (à appeler depuis un geste du joueur : Google ouvre une fenêtre).
   * @returns {Promise<{email:string|null}>}
   */
  async connect() {
    if (!this.configured) throw new Error('La sauvegarde Google n\'est pas configurée sur cette version du jeu');
    const google = await loadGis();
    const resp = await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        callback: (r) => (r?.error ? reject(new Error(r.error_description || 'Connexion refusée')) : resolve(r)),
        error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Fenêtre de connexion fermée' : e?.type === 'popup_failed_to_open' ? 'Fenêtre de connexion bloquée par le navigateur' : 'Connexion impossible'))
      });
      client.requestAccessToken({ prompt: this.email ? '' : 'consent', ...(this.email ? { login_hint: this.email } : {}) });
    });
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) throw new Error('Autorisez l\'accès aux fichiers créés par le jeu pour activer la sauvegarde en ligne');
    this.token = resp.access_token;
    this.expires = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
    this.#storeToken();
    try {
      const about = await this.#json(`${API}/about?fields=user(emailAddress,displayName)`);
      this.email = about?.user?.emailAddress ?? this.email;
      this.settings?.set('cloudEmail', this.email);
    } catch {
      /* l'adresse n'est qu'un repère d'affichage */
    }
    this.#emit();
    return { email: this.email };
  }

  /** Déconnexion : le jeton est révoqué, le compte oublié. */
  async disconnect() {
    const token = this.token;
    this.token = null;
    this.expires = 0;
    this.email = null;
    this.settings?.set('cloudEmail', null);
    this.settings?.set('cloudFolderId', null);
    this.#storeToken();
    try {
      if (token && globalThis.google?.accounts?.oauth2) globalThis.google.accounts.oauth2.revoke(token, () => {});
    } catch {
      /* rien */
    }
    this.#emit();
  }

  async #request(url, { method = 'GET', headers = {}, body, auth = true } = {}) {
    if (auth && !this.connected) throw new CloudAuthError();
    const res = await this.fetch(url, { method, headers: { ...(auth ? { Authorization: `Bearer ${this.token}` } : {}), ...headers }, body });
    if (res.status === 401) {
      this.token = null;
      this.#storeToken();
      this.#emit();
      throw new CloudAuthError();
    }
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json())?.error?.message ?? '';
      } catch {
        /* rien */
      }
      if (res.status === 404) throw new Error('Partie introuvable (supprimée, ou lien plus partagé)');
      if (res.status === 403 && /quota|storage/i.test(detail)) throw new Error('Espace Google Drive plein');
      throw new Error(`Google Drive : ${detail || `erreur ${res.status}`}`);
    }
    return res;
  }

  async #json(url, opts) {
    const res = await this.#request(url, opts);
    return res.status === 204 ? null : res.json();
  }

  /** Dossier du jeu (créé au besoin), et son sous-dossier de partages. */
  async #folder(name = FOLDER, parent = null) {
    const cacheKey = parent ? 'cloudShareFolderId' : 'cloudFolderId';
    const cached = this.settings?.get(cacheKey);
    if (cached) {
      try {
        const f = await this.#json(`${API}/files/${cached}?fields=id,trashed`);
        if (f && !f.trashed) return cached;
      } catch (err) {
        if (err instanceof CloudAuthError) throw err;
      }
    }
    const q = `name='${esc(name)}' and mimeType='${FOLDER_MIME}' and trashed=false${parent ? ` and '${parent}' in parents` : ''}`;
    const found = await this.#json(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`);
    let id = found?.files?.[0]?.id;
    if (!id) {
      const created = await this.#json(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) })
      });
      id = created.id;
    }
    this.settings?.set(cacheKey, id);
    return id;
  }

  /** Parties sauvegardées en ligne (les plus récentes d'abord). */
  async list() {
    const folder = await this.#folder();
    const q = `'${folder}' in parents and trashed=false and appProperties has { key='urbis' and value='1' }`;
    const r = await this.#json(`${API}/files?q=${encodeURIComponent(q)}&fields=files(${FIELDS})&orderBy=modifiedTime desc&pageSize=100&spaces=drive`);
    return (r?.files ?? []).map((f) => GoogleDriveSaves.describe(f));
  }

  /** Résumé d'un fichier pour l'affichage. */
  static describe(f) {
    const a = f.appProperties ?? {};
    return {
      fileId: f.id,
      name: a.city ? `${a.city}${a.kind === 'auto' ? ' (auto)' : ''}` : f.name.replace(/\.urbis$/, ''),
      saveKey: a.saveKey ?? null,
      kind: a.kind ?? 'manual',
      population: Number(a.population) || 0,
      date: a.date ?? '',
      updatedAt: Date.parse(f.modifiedTime) || 0,
      sizeKb: Math.round((Number(f.size) || 0) / 1024)
    };
  }

  /** Corps « multipart/related » (métadonnées + contenu). */
  static multipart(meta, bytes) {
    const b = `urbis-${Math.random().toString(36).slice(2)}`;
    const body = new Blob([
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${FILE_MIME}\r\n\r\n`,
      bytes,
      `\r\n--${b}--`
    ]);
    return { body, type: `multipart/related; boundary=${b}` };
  }

  /**
   * Envoie (ou remplace) une partie. `saveKey` identifie l'emplacement : la même clé met à jour le même fichier.
   * @param {any} record enregistrement de sauvegarde (SaveService)
   */
  async upload(record, { saveKey, kind = record.kind ?? 'manual' } = {}) {
    const folder = await this.#folder();
    const key = saveKey ?? record.id;
    const q = `'${folder}' in parents and trashed=false and appProperties has { key='saveKey' and value='${esc(key)}' }`;
    const existing = (await this.#json(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`))?.files?.[0]?.id;
    const s = record.summary ?? {};
    const meta = {
      name: fileNameFor(s.name ?? record.name, kind === 'auto' ? '_auto' : ''),
      appProperties: { urbis: '1', saveKey: key, kind, city: String(s.name ?? record.name ?? '').slice(0, 60), population: String(s.population ?? 0), date: String(s.date ?? '').slice(0, 40) }
    };
    const bytes = await encodeRecord(record);
    if (existing) {
      const { body, type } = GoogleDriveSaves.multipart(meta, bytes);
      return GoogleDriveSaves.describe(await this.#json(`${UPLOAD}/files/${existing}?uploadType=multipart&fields=${FIELDS}`, { method: 'PATCH', headers: { 'Content-Type': type }, body }));
    }
    const { body, type } = GoogleDriveSaves.multipart({ ...meta, parents: [folder] }, bytes);
    return GoogleDriveSaves.describe(await this.#json(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', headers: { 'Content-Type': type }, body }));
  }

  /** Télécharge une partie du Drive du joueur. @returns {Promise<any>} enregistrement */
  async download(fileId) {
    const res = await this.#request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return decodeRecord(await res.arrayBuffer());
  }

  /** Met une partie à la corbeille du Drive (récupérable 30 jours). */
  async remove(fileId) {
    await this.#json(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  }

  /**
   * Partage : copie de la partie dans « URBIS 2030/Partages », lisible par toute personne qui a le lien.
   * @returns {Promise<{fileId:string, url:string}>} lien du jeu qui ouvre directement la partie
   */
  async share(record, { gameUrl }) {
    const folder = await this.#folder();
    const shares = await this.#folder(SHARE_FOLDER, folder);
    const s = record.summary ?? {};
    const meta = {
      name: fileNameFor(s.name ?? record.name, '_partage'),
      parents: [shares],
      appProperties: { urbis: '1', share: '1', city: String(s.name ?? record.name ?? '').slice(0, 60), population: String(s.population ?? 0), date: String(s.date ?? '').slice(0, 40) }
    };
    const { body, type } = GoogleDriveSaves.multipart(meta, await encodeRecord(record));
    const f = await this.#json(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': type }, body });
    await this.#json(`${API}/files/${f.id}/permissions?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
    return { fileId: f.id, url: GoogleDriveSaves.shareUrl(gameUrl, f.id) };
  }

  /** Lien du jeu qui ouvre une partie partagée. */
  static shareUrl(gameUrl, fileId) {
    const u = new URL(gameUrl);
    u.search = '';
    u.hash = '';
    u.searchParams.set('partie', fileId);
    return u.toString();
  }

  /**
   * Télécharge une partie partagée par lien, sans compte (clé d'API publique) ; avec le compte du joueur s'il est
   * connecté et que la clé manque.
   */
  async downloadShared(fileId) {
    const id = encodeURIComponent(fileId);
    if (this.apiKey) {
      const res = await this.#request(`${API}/files/${id}?alt=media&key=${encodeURIComponent(this.apiKey)}`, { auth: false });
      return decodeRecord(await res.arrayBuffer());
    }
    if (this.connected) return this.download(fileId);
    throw new Error('Le partage par lien n\'est pas configuré sur cette version du jeu : demandez plutôt le fichier de la partie');
  }
}
