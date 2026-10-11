/**
 * Bus d'événements minimal (publication/abonnement) — une instance par partie, injectée.
 * Les événements sont des notifications : ils ne doivent pas servir à modifier l'état du monde
 * en dehors des services prévus.
 *
 * Événements principaux :
 *  - 'world:changed'      { tiles: number[] | null, reason }      → rendu des couches statiques
 *  - 'building:added'     { building }
 *  - 'building:removed'   { building }
 *  - 'building:changed'   { building }
 *  - 'network:changed'    { kind: 'road' | 'power' | 'water' }
 *  - 'sim:tick'           { tick }
 *  - 'sim:month'          { year, month }
 *  - 'fields:updated'     { fields: string[] }                    → couches de données
 *  - 'notify'             { level, message, x?, y? }
 *  - 'economy:changed'    {}
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
  }

  /** @returns {() => void} fonction de désabonnement */
  on(type, fn) {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  once(type, fn) {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  emit(type, payload) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }

  clear() {
    this.handlers.clear();
  }
}
