import { test, expect } from '@playwright/test';

// Téléphone en portrait, écran tactile ; l'API plein écran est retirée pour reproduire Safari sur iPhone.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('iPhone : mise en page, gestes tactiles, pose validée par bouton, mode immersif', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false, configurable: true });
    Element.prototype.requestFullscreen = undefined;
  });
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByRole('button', { name: 'Fonder la ville' }).tap();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 120_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));

  // Tout tient à l'écran : barre du haut sans débordement, tous les outils visibles
  const fit = await page.evaluate(() => ({
    hud: document.getElementById('hud').scrollWidth - document.getElementById('hud').clientWidth,
    hidden: [...document.querySelectorAll('#toolbar .tool-btn, .hud-fullscreen')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.left < 0 || r.right > innerWidth;
    }).length
  }));
  expect(fit).toEqual({ hud: 0, hidden: 0 });

  // Pincer pour zoomer, puis glisser à deux doigts
  const gesture = await page.evaluate(() => {
    const app = window.__urbis;
    const c = app.renderer.canvas;
    const r = c.getBoundingClientRect();
    const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, button: 0, buttons: 1 }));
    const z0 = app.renderer.camera.zoom;
    ev('pointerdown', 1, 150, 300);
    ev('pointerdown', 2, 240, 300);
    for (let k = 1; k <= 8; k++) {
      ev('pointermove', 1, 150 - k * 5, 300);
      ev('pointermove', 2, 240 + k * 5, 300);
    }
    ev('pointerup', 1, 110, 300);
    ev('pointerup', 2, 280, 300);
    const x0 = app.renderer.camera.x;
    ev('pointerdown', 3, 150, 300);
    ev('pointerdown', 4, 240, 300);
    for (let k = 1; k <= 5; k++) {
      ev('pointermove', 3, 150 + k * 10, 300);
      ev('pointermove', 4, 240 + k * 10, 300);
    }
    ev('pointerup', 3, 200, 300);
    ev('pointerup', 4, 290, 300);
    return { zoomed: app.renderer.camera.zoom > z0 * 1.5, panned: app.renderer.camera.x !== x0 };
  });
  expect(gesture).toEqual({ zoomed: true, panned: true });

  // Poser un square : un appui place l'aperçu, le bouton « Valider » construit
  await page.getByRole('button', { name: 'Parcs et loisirs' }).tap();
  await page.locator('.flyout-item', { hasText: 'Square' }).tap();
  const spot = await page.evaluate(() => {
    const s = window.__urbis.session;
    const r = window.__urbis.renderer;
    const c = r.tileAtScreen(195, 360);
    for (let k = 0; k < 14; k++) {
      for (let dy = -k; dy <= k; dy++) {
        for (let dx = -k; dx <= k; dx++) {
          if (s.preview({ type: 'building', defId: 'park_small', x: c.x + dx, y: c.y + dy }).ok) {
            const p = r.tileToScreen(c.x + dx, c.y + dy);
            const rc = r.canvas.getBoundingClientRect();
            return { x: rc.left + p.x, y: rc.top + p.y };
          }
        }
      }
    }
    return null;
  });
  expect(spot).not.toBeNull();
  const parks = () => page.evaluate(() => [...window.__urbis.session.state.buildings.values()].filter((b) => b.defId === 'park_small').length);
  const before = await parks();
  await page.touchscreen.tap(spot.x, spot.y);
  await expect(page.locator('#cursor-tip')).toContainText('Valider');
  expect(await parks()).toBe(before);
  await page.getByRole('button', { name: /^Valider/ }).tap();
  await expect.poll(parks).toBe(before + 1);

  // Plein écran indisponible : repli sur le mode immersif, réversible
  await page.getByRole('button', { name: 'Terminer' }).tap();
  await page.locator('.hud-fullscreen').tap();
  await expect(page.locator('#app')).toHaveClass(/immersive/);
  await expect(page.locator('.toast', { hasText: 'plein écran' })).toBeVisible();
  await page.locator('.hud-fullscreen').tap();
  await expect(page.locator('#app')).not.toHaveClass(/immersive/);

  expect(errors).toEqual([]);
});
