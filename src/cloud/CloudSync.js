import { CloudAuthError } from './GoogleDrive.js';

/** Au plus une copie en ligne automatique toutes les quatre minutes (les sauvegardes manuelles partent aussitôt). */
const AUTO_INTERVAL_MS = 4 * 60 * 1000;

const slug = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ville';

/**
 * v1.6 — copie en ligne des sauvegardes.
 *
 * Une ville = un fichier dans le Drive du joueur (clé « graine + nom »), toujours remplacé par la sauvegarde la
 * plus récente (Google Drive garde lui-même les versions précédentes quelques semaines). Chaque sauvegarde
 * manuelle et, au plus toutes les quatre minutes, chaque sauvegarde automatique part aussi en ligne quand le
 * joueur est connecté. Une connexion expirée met la copie en pause (une notification propose de se reconnecter).
 */
export class CloudSync {
  /** @param {{cloud:import('./GoogleDrive.js').GoogleDriveSaves, saves:any, settings:any, notify:(n:any)=>void}} deps */
  constructor({ cloud, saves, settings, notify }) {
    this.cloud = cloud;
    this.saves = saves;
    this.settings = settings;
    this.notify = notify;
    this.lastAuto = 0;
    this.lastSync = null;
    this.busy = false;
  }

  /** Copie automatique activée (par défaut oui, dès que le joueur est connecté). */
  get auto() {
    return this.settings.get('cloudAuto') !== false;
  }

  set auto(v) {
    this.settings.set('cloudAuto', !!v);
  }

  /** Clé de l'emplacement en ligne d'une ville. */
  static keyFor(state) {
    return `city-${state.meta.seed ?? 0}-${slug(state.meta.name)}`;
  }

  /**
   * Après une sauvegarde locale réussie : copie en ligne si le joueur est connecté.
   * @param {any} state état sauvegardé
   * @param {{id:string}} saved enregistrement local (lu dans IndexedDB pour éviter de resérialiser)
   */
  async afterSave(state, saved, { kind = 'manual' } = {}) {
    if (!this.auto || !this.cloud.configured || !this.cloud.known) return null;
    if (kind === 'auto' && Date.now() - this.lastAuto < AUTO_INTERVAL_MS) return null;
    if (!this.cloud.connected) {
      this.notify({ level: 'warning', message: 'Sauvegarde en ligne en pause : la connexion Google a expiré. Reconnectez-vous (Sauvegardes).', panel: 'saves', action: 'Reconnecter', key: 'cloud-expired' });
      return null;
    }
    if (kind === 'auto') this.lastAuto = Date.now();
    try {
      const rec = await this.saves.get(saved.id);
      if (!rec) return null;
      return await this.#upload(state, rec, kind);
    } catch (err) {
      this.#fail(err);
      return null;
    }
  }

  /** Copie en ligne immédiate de la partie en cours (bouton « Sauvegarder en ligne maintenant »). */
  async uploadNow(state) {
    const rec = this.saves.buildRecord(state, { id: `cloud-${CloudSync.keyFor(state)}`, name: state.meta.name, kind: 'manual' });
    return this.#upload(state, rec, 'manual');
  }

  async #upload(state, rec, kind) {
    this.busy = true;
    try {
      const f = await this.cloud.upload(rec, { saveKey: CloudSync.keyFor(state), kind });
      this.lastSync = Date.now();
      return f;
    } finally {
      this.busy = false;
    }
  }

  #fail(err) {
    if (err instanceof CloudAuthError) {
      this.notify({ level: 'warning', message: 'Sauvegarde en ligne en pause : la connexion Google a expiré. Reconnectez-vous (Sauvegardes).', panel: 'saves', action: 'Reconnecter', key: 'cloud-expired' });
    } else {
      this.notify({ level: 'warning', message: `Copie en ligne impossible : ${err.message}`, key: 'cloud-error' });
    }
  }

  /**
   * Rapatrie une partie du Drive dans ce navigateur (copie locale « en ligne », remplacée à chaque rapatriement).
   * @returns {Promise<string>} identifiant de la sauvegarde locale à charger
   */
  async restore(fileId) {
    const rec = await this.cloud.download(fileId);
    const saved = await this.saves.importRecordObject(rec, { suffix: '', id: `cloud-${fileId}` });
    return saved.id;
  }
}
