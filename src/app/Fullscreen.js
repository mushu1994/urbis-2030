/**
 * Plein écran.
 * - Navigateurs qui le permettent (ordinateur, Android, iPad) : API Fullscreen native.
 * - iPhone (Safari n'autorise le plein écran que pour les vidéos) ou cadre qui le refuse :
 *   « mode immersif », qui réduit l'interface du jeu pour laisser toute la place à la carte.
 * - Lancé depuis l'écran d'accueil (web app installée) : la page est déjà sans barre de navigateur.
 */
export class FullscreenController {
  /**
   * @param {HTMLElement} root élément racine de l'application
   * @param {{onChange?:(state:{active:boolean, mode:'native'|'immersive'|null})=>void, notify?:(level:string, msg:string)=>void}} [opts]
   */
  constructor(root, { onChange, notify } = {}) {
    this.root = root;
    this.onChange = onChange ?? (() => {});
    this.notify = notify ?? (() => {});
    this.immersive = false;
    this.explained = false;
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => this.#emit());
  }

  /** L'API native est-elle utilisable ici ? (faux sur iPhone et dans certains cadres intégrés) */
  get nativeSupported() {
    const el = document.documentElement;
    const enabled = document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? false;
    return !!enabled && !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  get nativeActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  /** Page lancée comme une application depuis l'écran d'accueil. */
  get standalone() {
    return navigator.standalone === true || !!window.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)').matches;
  }

  get active() {
    return this.nativeActive || this.immersive;
  }

  get mode() {
    return this.nativeActive ? 'native' : this.immersive ? 'immersive' : null;
  }

  async toggle() {
    if (this.nativeActive) {
      await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.())?.catch?.(() => {});
      return;
    }
    if (this.immersive) {
      this.setImmersive(false);
      return;
    }
    if (this.nativeSupported) {
      const el = document.documentElement;
      try {
        await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen());
        // Certaines implémentations préfixées ne renvoient pas de promesse : on vérifie l'état réel.
        await new Promise((r) => setTimeout(r, 150));
        if (this.nativeActive) return;
      } catch {
        /* refusé (cadre intégré, réglage du navigateur) : repli sur le mode immersif */
      }
    }
    this.setImmersive(true);
    if (!this.explained && !this.standalone) {
      this.explained = true;
      this.notify('info', 'Ce navigateur ne permet pas le plein écran (Safari sur iPhone le réserve aux vidéos). L\'interface est réduite pour agrandir la carte.');
    }
  }

  setImmersive(on) {
    this.immersive = on;
    this.root.classList.toggle('immersive', on);
    this.#emit();
  }

  #emit() {
    this.root.classList.toggle('fullscreen', this.nativeActive);
    this.onChange({ active: this.active, mode: this.mode });
  }
}
