/**
 * Tas binaire minimal sur des paires (clé numérique, priorité).
 * Utilisé par A* et Dijkstra. Stockage dans des tableaux parallèles pour limiter les allocations.
 */
export class MinHeap {
  constructor(capacity = 256) {
    this.keys = new Int32Array(capacity);
    this.prios = new Float64Array(capacity);
    this.size = 0;
  }

  clear() {
    this.size = 0;
  }

  push(key, prio) {
    if (this.size === this.keys.length) this.#grow();
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prios[p] <= prio) break;
      this.keys[i] = this.keys[p];
      this.prios[i] = this.prios[p];
      i = p;
    }
    this.keys[i] = key;
    this.prios[i] = prio;
  }

  /** @returns {number} clé de priorité minimale (-1 si vide). Lire `lastPrio` pour sa priorité. */
  pop() {
    if (this.size === 0) return -1;
    const top = this.keys[0];
    this.lastPrio = this.prios[0];
    const k = this.keys[--this.size];
    const pr = this.prios[this.size];
    let i = 0;
    const n = this.size;
    while (true) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && this.prios[c + 1] < this.prios[c]) c++;
      if (this.prios[c] >= pr) break;
      this.keys[i] = this.keys[c];
      this.prios[i] = this.prios[c];
      i = c;
    }
    this.keys[i] = k;
    this.prios[i] = pr;
    return top;
  }

  #grow() {
    const k = new Int32Array(this.keys.length * 2);
    const p = new Float64Array(this.prios.length * 2);
    k.set(this.keys);
    p.set(this.prios);
    this.keys = k;
    this.prios = p;
  }
}
