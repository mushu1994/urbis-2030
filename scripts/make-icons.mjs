/**
 * Génère les icônes PNG de l'application à partir de scripts/icon.svg (rendu par Chromium/Playwright).
 * Usage : node scripts/make-icons.mjs  (à relancer seulement si l'icône change)
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
const out = new URL('../public/icons/', import.meta.url);
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage();
const render = async (size, padding, file) => {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - padding * 2));
  await page.setContent(`<html><body style="margin:0;background:#1d2730;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  writeFileSync(new URL(file, out), await page.screenshot({ type: 'png' }));
};
await render(512, 0, 'icon-512.png');
await render(192, 0, 'icon-192.png');
await render(180, 0, 'apple-touch-icon.png');
// Icône « maskable » : zone de sécurité de 10 % sur chaque bord (Android découpe en cercle ou en goutte)
await render(512, 0.1, 'icon-maskable-512.png');
await browser.close();
console.log('Icônes générées dans public/icons/');
