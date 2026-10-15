/**
 * Vue gyroscopique (v0.9) : sur téléphone et tablette, incliner l'appareil fait glisser la caméra sur la ville,
 * comme si l'on penchait une maquette. L'orientation au moment de l'activation (ou du recentrage) sert de position de
 * repos : seul l'écart à cette position déplace la vue, avec une zone morte pour tenir l'appareil sans dériver.
 *
 * - iPhone et iPad (iOS 13+) : l'autorisation « Mouvement et orientation » est demandée au premier appui.
 * - L'orientation de l'écran (portrait, paysage) est prise en compte.
 * - La vue s'arrête pendant un geste au doigt, quand un panneau est ouvert ou dans un menu ; au retour, la position
 *   de repos est recalée pour éviter tout à-coup.
 */

/** Zone morte (degrés) et inclinaison donnant la vitesse maximale. */
export const GYRO_DEAD_ZONE = 3;
export const GYRO_MAX_TILT = 25;
/** Vitesse maximale (pixels d'écran par seconde) selon la sensibilité choisie. */
export const GYRO_SPEEDS = { low: 380, medium: 700, high: 1100 };

/**
 * Vitesse de défilement (pixels/s) pour une inclinaison donnée (degrés, signée) : nulle dans la zone morte,
 * puis progressive (courbe en puissance 1,6) jusqu'à la vitesse maximale.
 */
export function tiltSpeed(deg, maxSpeed) {
  const a = Math.abs(deg);
  if (a <= GYRO_DEAD_ZONE) return 0;
  const k = Math.min(1, (a - GYRO_DEAD_ZONE) / (GYRO_MAX_TILT - GYRO_DEAD_ZONE));
  return Math.sign(deg) * Math.pow(k, 1.6) * maxSpeed;
}

/**
 * Inclinaison à l'écran (degrés) à partir des angles de l'appareil et de l'orientation de l'écran :
 * x = vers la droite de l'écran, y = vers le bas de l'écran.
 */
export function screenTilt(beta, gamma, angle = 0) {
  switch (((angle % 360) + 360) % 360) {
    case 90:
      return { x: beta, y: -gamma };
    case 180:
      return { x: -gamma, y: -beta };
    case 270:
      return { x: -beta, y: gamma };
    default:
      return { x: gamma, y: beta };
  }
}

export class GyroController {
  /**
   * @param {{camera:()=>any, isBlocked:()=>boolean, onChange?:(active:boolean)=>void, notify?:(level:string, msg:string)=>void}} deps
   */
  constructor({ camera, isBlocked, onChange, notify }) {
    this.camera = camera;
    this.isBlocked = isBlocked;
    this.onChange = onChange ?? (() => {});
    this.notify = notify ?? (() => {});
    this.active = false;
    this.ref = null;
    this.raw = null;
    this.smooth = null;
    this.sensitivity = 'medium';
    this.wasBlocked = false;
    this.invert = false;
    this.onOrientation = (e) => {
      if (e.beta === null || e.gamma === null) return;
      this.raw = { beta: e.beta, gamma: e.gamma };
    };
  }

  /** Le navigateur expose-t-il l'orientation de l'appareil (téléphone, tablette) ? */
  static get supported() {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && (typeof matchMedia !== 'function' || matchMedia('(pointer: coarse)').matches);
  }

  #angle() {
    return (typeof screen !== 'undefined' && screen.orientation?.angle) ?? (typeof window !== 'undefined' ? window.orientation ?? 0 : 0);
  }

  /** Active la vue (à appeler depuis un geste de l'utilisateur pour l'autorisation iOS). */
  async enable() {
    if (this.active) return true;
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const r = await DOE.requestPermission();
        if (r !== 'granted') {
          this.notify('warning', 'Vue gyroscopique refusée : autorisez « Mouvement et orientation » pour ce site dans les réglages de Safari.');
          return false;
        }
      } catch {
        this.notify('warning', 'Vue gyroscopique indisponible : l\'autorisation n\'a pas pu être demandée.');
        return false;
      }
    }
    window.addEventListener('deviceorientation', this.onOrientation);
    this.active = true;
    this.ref = null;
    this.smooth = null;
    this.onChange(true);
    // Aucun capteur après une seconde (ordinateur, capteur absent) : on prévient
    setTimeout(() => {
      if (this.active && !this.raw) this.notify('info', 'Aucun capteur d\'orientation détecté sur cet appareil.');
    }, 1200);
    return true;
  }

  disable() {
    if (!this.active) return;
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.active = false;
    this.ref = null;
    this.onChange(false);
  }

  async toggle() {
    if (this.active) {
      this.disable();
      return false;
    }
    return this.enable();
  }

  /** Recentre : l'orientation actuelle devient la position de repos. */
  recenter() {
    this.ref = null;
    this.smooth = null;
  }

  /** Appelé à chaque image : déplace la caméra selon l'inclinaison. */
  update(dtMs) {
    if (!this.active || !this.raw) return;
    const blocked = this.isBlocked();
    if (blocked) {
      this.wasBlocked = true;
      return;
    }
    if (this.wasBlocked) {
      this.wasBlocked = false;
      this.recenter();
    }
    const t = screenTilt(this.raw.beta, this.raw.gamma, this.#angle());
    if (!this.ref) {
      this.ref = t;
      this.smooth = { x: 0, y: 0 };
      return;
    }
    // Lissage (filtre passe-bas) pour absorber les tremblements de la main
    const k = Math.min(1, dtMs / 120);
    this.smooth.x += (t.x - this.ref.x - this.smooth.x) * k;
    this.smooth.y += (t.y - this.ref.y - this.smooth.y) * k;
    const max = GYRO_SPEEDS[this.sensitivity] ?? GYRO_SPEEDS.medium;
    const s = this.invert ? -1 : 1;
    const vx = tiltSpeed(this.smooth.x, max) * s;
    const vy = tiltSpeed(this.smooth.y, max) * s;
    if (!vx && !vy) return;
    const dt = Math.min(50, dtMs) / 1000;
    // Pencher vers la droite fait glisser la vue vers la droite de la ville
    this.camera()?.pan(-vx * dt, -vy * dt);
  }
}
