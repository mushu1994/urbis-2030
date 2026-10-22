/**
 * v1.7 : images sources de l'application Android (dossier assets/), rendues par Chromium à partir de
 * scripts/icon.svg. Ensuite : npx @capacitor/assets generate --android (icônes adaptatives, écran de démarrage).
 * Usage : node scripts/make-android-assets.mjs  (à relancer seulement si l'icône change)
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
const out = new URL('../assets/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage();
const shot = async (w, hgt, html, file, transparent = false) => {
  await page.setViewportSize({ width: w, height: hgt });
  await page.setContent(`<html><body style="margin:0;width:${w}px;height:${hgt}px;${transparent ? 'background:transparent' : 'background:#1d2730'};display:grid;place-items:center">${html}</body></html>`);
  writeFileSync(new URL(file, out), await page.screenshot({ type: 'png', omitBackground: transparent }));
};
const icon = (size) => svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
// Icône complète (anciens Android) ; icône adaptative : premier plan dans la zone sûre (66 %), fond uni
await shot(1024, 1024, icon(1024), 'icon-only.png');
await shot(1024, 1024, icon(600), 'icon-foreground.png', true);
await shot(1024, 1024, '', 'icon-background.png');
// Écran de démarrage : logo et nom du jeu
const splash = `<div style="display:grid;justify-items:center;gap:60px;font-family:Arial,sans-serif">${icon(520)}
  <div style="color:#e9eef0;font-size:150px;font-weight:800;letter-spacing:8px">URBIS <span style="color:#f2c230">2030</span></div></div>`;
await shot(2732, 2732, splash, 'splash.png');
await shot(2732, 2732, splash, 'splash-dark.png');
await browser.close();
console.log('Images sources générées dans assets/');
