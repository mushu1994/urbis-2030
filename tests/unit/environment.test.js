import { describe, it, expect } from 'vitest';
import { EnvironmentSystem } from '../../src/simulation/EnvironmentSystem.js';
import { Grid } from '../../src/world/Grid.js';

/** Version de référence (sans noyau précalculé) de la diffusion. */
function splatRef(g, field, cx, cy, value, r) {
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(g.height - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(g.width - 1, Math.ceil(cx + r)); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      field[y * g.width + x] += value * (1 - d / (r + 1));
    }
  }
}

describe('Diffusion environnementale', () => {
  it('le noyau précalculé donne exactement le même champ que le calcul direct, bords compris', () => {
    const g = new Grid(20, 14);
    const a = new Float32Array(g.size);
    const b = new Float32Array(g.size);
    const cases = [[0, 0, 3, 2], [19, 13, 5.5, 4], [7, 6, 0.8, 3.5], [10, 2, 12, 1], [3, 12, 2.2, 6]];
    for (const [x, y, v, r] of cases) {
      EnvironmentSystem.splat(g, a, x, y, v, r);
      splatRef(g, b, x, y, v, r);
    }
    expect(Array.from(a)).toEqual(Array.from(b));
    // centre fractionnaire (bâtiments 2×2) : chemin générique
    EnvironmentSystem.splat(g, a, 4.5, 4.5, 1, 2);
    splatRef(g, b, 4.5, 4.5, 1, 2);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
