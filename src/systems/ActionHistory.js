/**
 * Historique des actions du joueur permettant l'annulation (« Annuler »).
 * Une action n'est annulable que si :
 *  - elle date de moins de UNDO_WINDOW_DAYS jours de jeu ;
 *  - aucune des cases concernées n'a été modifiée depuis (croissance, autre construction…).
 */
export const UNDO_WINDOW_DAYS = 30;
const MAX_ENTRIES = 25;

export class ActionHistory {
  constructor() {
    /** @type {any[]} */
    this.entries = [];
  }

  push(entry) {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  peek() {
    return this.entries[this.entries.length - 1];
  }

  pop() {
    return this.entries.pop();
  }

  clear() {
    this.entries = [];
  }

  /**
   * @returns {{ok:boolean, reason?:string, entry?:any}}
   */
  canUndo(state) {
    const e = this.peek();
    if (!e) return { ok: false, reason: 'Aucune action à annuler' };
    if (state.time.tick - e.tick > UNDO_WINDOW_DAYS) return { ok: false, reason: 'Action trop ancienne' };
    for (const { i, v } of e.versionsAfter) {
      if (state.grid.tileVersion[i] !== v) return { ok: false, reason: 'La zone a évolué depuis' };
    }
    return { ok: true, entry: e };
  }
}
