/**
 * Préférences légères et non critiques (localStorage). Les parties ne sont jamais stockées ici.
 */
const KEY = 'urbis2030.settings';

export const DEFAULT_SETTINGS = Object.freeze({
  autosaveMinutes: 5,
  edgeScroll: false,
  showVehicles: true,
  showGridLines: false,
  uiScale: 1,
  renderScale: 'auto',
  showFps: false,
  confirmDemolish: true,
  confirmPlacement: false,
  lastSaveId: null
});

export class SettingsService {
  /** @param {Storage | null} [storage] */
  constructor(storage) {
    this.storage = storage === undefined ? safeStorage() : storage;
    this.values = { ...DEFAULT_SETTINGS, ...this.#read() };
  }

  #read() {
    try {
      const raw = this.storage?.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    this.values[key] = value;
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.values));
    } catch {
      /* stockage plein ou désactivé : préférence conservée pour la session */
    }
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
