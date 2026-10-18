import { test, expect } from '@playwright/test';

async function shot(page, name) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

/** Version 1.0 : difficulté, statut de la ville, écran « Nouveau statut », dotation, taux d'épargne. */
test('difficulté, statut de la ville, nouveau statut et dotation, taux d\'épargne', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Difficulté').selectOption('hard');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
  expect(await page.evaluate(() => window.__urbis.session.state.economy.treasury)).toBe(300_000 * 100);
  await expect(page.locator('.hud-tier')).toHaveText('Hameau');
  // L'école est verrouillée au statut Hameau : la fiche du menu le dit
  const locked = await page.evaluate(() => window.__urbis.session.preview({ type: 'building', defId: 'school', x: 10, y: 10 }).messages.join());
  expect(locked).toMatch(/statut « Village/);

  // Passage au statut Bourg : annonce, dotation (difficile : ×0,5), déblocages
  const t0 = await page.evaluate(() => window.__urbis.session.state.economy.treasury);
  await page.evaluate(() => window.__urbis.session.execute({ type: 'debug', op: 'peak', population: 2100 }));
  await page.evaluate(() => window.__urbis.setSpeed(1));
  await expect(page.locator('.milestone-dialog h2')).toHaveText('Nouveau statut : Bourg', { timeout: 60_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
  await expect(page.locator('.milestone-dialog')).toContainText('Commissariat');
  await shot(page, 'v10-status');
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.milestones.granted)).toBe(2);
  const gained = await page.evaluate((t) => window.__urbis.session.state.economy.treasury - t, t0);
  expect(gained).toBeGreaterThanOrEqual((30_000 + 75_000) * 100 - 50_000 * 100);
  await page.getByRole('button', { name: 'Voir la progression' }).click();
  await expect(page.locator('.milestone-card')).toContainText('Bourg');
  await expect(page.locator('.hud-tier')).toHaveText('Bourg');
  await page.locator('#panel-host .panel-close').click();

  // Finances : taux d'épargne brute, profils d'emprunt débloqués
  await page.locator('.hud-money').click();
  await expect(page.locator('.kpi', { hasText: 'Taux d\'épargne brute' })).toBeVisible();
  await page.getByRole('tab', { name: 'Emprunts' }).click();
  await expect(page.getByLabel('Profil de remboursement').locator('option[value="bullet"]')).toBeEnabled();
  expect(errors).toEqual([]);
});
