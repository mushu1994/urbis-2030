import { test, expect } from '@playwright/test';

/** Version 1.7 : bouton Retour d'Android (logique testée dans le navigateur, sans Capacitor). */
test('bouton Retour : ferme fenêtre, déroulé, panneau et outil, puis propose de quitter', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  const back = () => page.evaluate(() => window.__urbis.handleBack());
  await page.evaluate(() => window.__urbis.setSpeed(0));
  expect(await back()).toBe(false);
  await page.evaluate(() => window.__urbis.openPanel('finance'));
  await expect(page.locator('#panel-host')).toContainText('Finances');
  expect(await back()).toBe(true);
  expect(await page.evaluate(() => window.__urbis.panelHost.openId)).toBeFalsy();
  await page.locator('.hud-bell').click();
  expect(await back()).toBe(true);
  await expect(page.locator('#notif-history')).toBeHidden();
  await page.evaluate(() => window.__urbis.openPanel('saves'));
  await page.getByRole('button', { name: 'Partager la ville' }).click();
  await expect(page.locator('.share-dialog')).toBeVisible();
  expect(await back()).toBe(true);
  await expect(page.locator('.share-dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.classList.contains('native-app'))).toBe(false);
  expect(errors).toEqual([]);
});
