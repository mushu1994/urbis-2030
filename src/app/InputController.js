/**
 * Entrées souris, tactiles et clavier : caméra (déplacement, zoom), transmission des interactions de carte
 * au ToolController, et raccourcis clavier documentés (voir MenuPanels.SHORTCUTS).
 *
 * Tactile :
 *  - un doigt : action de l'outil actif (avec l'outil Sélection, glisser déplace la carte) ;
 *  - deux doigts : pincer pour zoomer, glisser pour déplacer la carte (annule le tracé en cours).
 */
export class InputController {
  /**
   * @param {{canvas:HTMLCanvasElement, renderer:any, tools:import('./ToolController.js').ToolController,
   *          shortcuts:Record<string, (e:KeyboardEvent)=>void>, settings:any, isBlocked:()=>boolean}} deps
   */
  constructor({ canvas, renderer, tools, shortcuts, settings, isBlocked, onRotate }) {
    this.canvas = canvas;
    /** Rotation de la carte d'un quart de tour (geste de torsion à deux doigts, v0.9). */
    this.onRotate = onRotate;
    this.renderer = renderer;
    this.tools = tools;
    this.shortcuts = shortcuts;
    this.settings = settings;
    this.isBlocked = isBlocked;
    this.keys = new Set();
    /** @type {Map<number, {x:number, y:number, type:string}>} pointeurs actifs posés sur la carte */
    this.pointers = new Map();
    this.drag = null;
    this.gesture = null;
    /** Après un geste à deux doigts, on ignore le doigt restant jusqu'à ce que tous soient levés. */
    this.suppress = false;
    this.mouse = { x: -1, y: -1, inside: false };

    canvas.addEventListener('pointerdown', (e) => this.#down(e));
    window.addEventListener('pointermove', (e) => this.#move(e));
    window.addEventListener('pointerup', (e) => this.#up(e, false));
    window.addEventListener('pointercancel', (e) => this.#up(e, true));
    canvas.addEventListener('wheel', (e) => this.#wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.inside = false;
      if (!this.drag) this.tools.hover(null, { shift: false });
    });
    window.addEventListener('keydown', (e) => this.#key(e, true));
    window.addEventListener('keyup', (e) => this.#key(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    // Safari iOS : empêche le zoom de la page entière quand on pince l'interface.
    for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  #local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  #down(e) {
    if (this.isBlocked()) return;
    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* pointeur déjà relâché ou non capturable : les événements de fenêtre suffisent */
    }
    const p = this.#local(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, type: e.pointerType });

    if (this.pointers.size >= 2) {
      // Début d'un geste à deux doigts : on abandonne l'action d'outil en cours.
      this.tools.cancel();
      this.tools.hover(null, { shift: false });
      this.drag = null;
      this.gesture = null;
      this.suppress = true;
      this.#gesture();
      return;
    }
    if (this.suppress) return;
    const pan = e.button === 1 || e.button === 2;
    this.drag = { id: e.pointerId, type: e.pointerType, button: e.button, start: p, last: p, moved: false, pan };
    if (!pan && e.button === 0) {
      const tile = this.renderer.tileAtScreen(p.x, p.y);
      if (e.pointerType !== 'mouse') this.tools.hover(tile, { shift: false });
      this.tools.down(tile);
    }
  }

  /** Pincer et glisser à deux doigts. */
  #gesture() {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const g = this.gesture;
    let base = angle;
    if (g) {
      const cam = this.renderer.camera;
      cam.pan(mid.x - g.mid.x, mid.y - g.mid.y);
      cam.zoomAt(dist / g.dist, mid.x, mid.y, this.renderer.view);
      // Torsion à deux doigts : au-delà de 50°, la carte tourne d'un quart de tour dans le même sens
      base = g.base;
      let turn = angle - base;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      if (Math.abs(turn) > (50 * Math.PI) / 180 && this.onRotate) {
        this.onRotate(turn > 0 ? 1 : -1);
        base = angle;
      }
    }
    this.gesture = { mid, dist, base };
  }

  #move(e) {
    const p = this.#local(e);
    const tracked = this.pointers.get(e.pointerId);
    if (tracked) {
      tracked.x = p.x;
      tracked.y = p.y;
    }
    if (this.pointers.size >= 2 && tracked) {
      this.#gesture();
      return;
    }
    const isMouse = e.pointerType === 'mouse';
    if (isMouse) {
      const inside = p.x >= 0 && p.y >= 0 && p.x < this.canvas.clientWidth && p.y < this.canvas.clientHeight;
      this.mouse = { x: p.x, y: p.y, inside };
      this.tools.tooltip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 18}px)`;
    }
    const d = this.drag;
    if (d && d.id === e.pointerId) {
      const dx = p.x - d.last.x;
      const dy = p.y - d.last.y;
      const threshold = d.type === 'mouse' ? 4 : 10;
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > threshold) d.moved = true;
      // Glisser avec l'outil de sélection, le clic droit ou la molette : déplace la caméra
      if (d.pan || (this.tools.tool.kind === 'select' && d.moved)) {
        this.renderer.camera.pan(dx, dy);
        this.canvas.style.cursor = 'grabbing';
      }
      d.last = p;
      if (this.tools.tool.kind !== 'select' || isMouse) this.tools.hover(this.renderer.tileAtScreen(p.x, p.y), { shift: e.shiftKey });
      return;
    }
    if (isMouse && this.mouse.inside && !this.suppress) this.tools.hover(this.renderer.tileAtScreen(p.x, p.y), { shift: e.shiftKey });
  }

  #up(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gesture = null;
    if (this.suppress) {
      if (this.pointers.size === 0) this.suppress = false;
      return;
    }
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    this.canvas.style.cursor = '';
    if (cancelled) {
      this.tools.cancel();
      return;
    }
    if (d.pan || d.button !== 0) return;
    const p = this.#local(e);
    const touch = d.type !== 'mouse';
    this.tools.up(this.renderer.tileAtScreen(p.x, p.y), { moved: d.moved, screen: p, touch });
    // Au doigt, il n'y a pas de survol : on efface l'aperçu sauf s'il attend une confirmation.
    if (touch && !this.tools.pending) this.tools.hover(null, { shift: false });
  }

  #wheel(e) {
    e.preventDefault();
    const p = this.#local(e);
    // Pincement sur pavé tactile (ctrlKey) : zoom plus sensible
    const k = e.ctrlKey ? 0.01 : e.deltaMode === 1 ? 0.05 : 0.0015;
    this.renderer.camera.zoomAt(Math.exp(-e.deltaY * k), p.x, p.y, this.renderer.view);
    this.tools.hover(this.renderer.tileAtScreen(p.x, p.y), { shift: e.shiftKey });
  }

  #key(e, down) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Enter' && (tag === 'BUTTON' || tag === 'A')) return; // Entrée active le bouton qui a le focus
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (!down) return;
    const combo = `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${k}`;
    const fn = this.shortcuts[combo];
    if (fn) {
      e.preventDefault();
      fn(e);
    }
  }

  /** Déplacement continu au clavier et au bord de l'écran (appelé à chaque image). */
  update(dtMs) {
    if (this.isBlocked()) return;
    const speed = (dtMs / 1000) * 700;
    let dx = 0;
    let dy = 0;
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('a') || k.has('q')) dx += speed;
    if (k.has('ArrowRight') || k.has('d')) dx -= speed;
    if (k.has('ArrowUp') || k.has('w') || k.has('z')) dy += speed;
    if (k.has('ArrowDown') || k.has('s')) dy -= speed;
    if (this.settings.get('edgeScroll') && this.mouse.inside && !this.drag) {
      const m = 14;
      if (this.mouse.x < m) dx += speed;
      if (this.mouse.x > this.canvas.clientWidth - m) dx -= speed;
      if (this.mouse.y < m) dy += speed;
      if (this.mouse.y > this.canvas.clientHeight - m) dy -= speed;
    }
    if (dx || dy) {
      this.renderer.camera.pan(dx, dy);
      if (this.mouse.inside) this.tools.hover(this.renderer.tileAtScreen(this.mouse.x, this.mouse.y), { shift: false });
    }
  }
}
