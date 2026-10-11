/**
 * Installation de l'application (PWA) : bouton « Installer » quand le navigateur le permet (Android, Chrome,
 * Edge), instructions pour Safari sur iPhone et iPad (Partager → Sur l'écran d'accueil).
 */
export class InstallPrompt {
  constructor() {
    this.deferred = null;
    this.listeners = new Set();
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferred = e;
      this.#changed();
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.#changed();
    });
  }

  #changed() {
    for (const fn of this.listeners) fn();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Le jeu tourne-t-il déjà comme application installée ? */
  get standalone() {
    return typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
  }

  get ios() {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
  }

  /** 'prompt' (bouton natif), 'ios' (instructions), 'installed' ou null (non disponible : fichier local…). */
  get mode() {
    if (this.standalone) return 'installed';
    if (this.deferred) return 'prompt';
    if (this.ios && location.protocol === 'https:') return 'ios';
    return null;
  }

  async prompt() {
    if (!this.deferred) return false;
    const e = this.deferred;
    this.deferred = null;
    e.prompt();
    const choice = await e.userChoice.catch(() => null);
    this.#changed();
    return choice?.outcome === 'accepted';
  }
}
