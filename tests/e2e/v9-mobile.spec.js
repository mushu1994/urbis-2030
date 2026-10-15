import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

/** Vue gyroscopique (v0.9) : incliner l'appareil fait glisser la caméra ; recentrer ; arrêter. */
test('téléphone : vue gyroscopique', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByRole('button', { name: 'Fonder la ville' }).tap();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
  // Les notifications d'accueil ne doivent pas masquer la barre
  await page.evaluate(() => window.__urbis.notifications.clear());

  const gyro = page.locator('.hud-gyro');
  await expect(gyro).toBeVisible();
  const box = await gyro.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await gyro.tap();
  await expect(gyro).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.gyro-pill')).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/v9-gyro-phone.png` });

  const orient = (beta, gamma) => page.evaluate(([b, g]) => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { beta: b, gamma: g, alpha: 0 })), [beta, gamma]);
  const cam = () => page.evaluate(() => ({ x: window.__urbis.renderer.camera.x, y: window.__urbis.renderer.camera.y }));
  await orient(40, 0);
  await page.waitForTimeout(300);
  const c0 = await cam();
  await orient(40, 22); // penché vers la droite
  await page.waitForTimeout(1200);
  const c1 = await cam();
  expect(c1.x).toBeGreaterThan(c0.x + 20);
  // Recentrer : la position actuelle devient le repos, la vue s'arrête
  await page.locator('.gyro-pill').getByRole('button', { name: 'Recentrer' }).tap();
  await page.waitForTimeout(400);
  const c2 = await cam();
  await page.waitForTimeout(800);
  const c3 = await cam();
  expect(Math.abs(c3.x - c2.x)).toBeLessThan(2);
  await page.locator('.gyro-pill').getByRole('button', { name: 'Arrêter' }).tap();
  await expect(gyro).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.gyro-pill')).toBeHidden();
  expect(errors).toEqual([]);
});
