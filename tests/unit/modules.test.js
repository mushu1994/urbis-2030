import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Tous les modules de src/ (hors points d'entrée). */
function sources(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.js') ? [p] : [];
  });
}

describe('Modules', () => {
  const root = join(__dirname, '../../src');
  // Points d'entrée exclus : l'application (navigateur) et le Web Worker de simulation (portée « self »)
  const files = sources(root).filter((p) => !p.endsWith('main.js') && !p.endsWith('.worker.js'));
  it.each(files.map((p) => relative(root, p)))('%s se charge sans erreur de syntaxe', async (rel) => {
    await expect(import(join(root, rel))).resolves.toBeTruthy();
  });
});
