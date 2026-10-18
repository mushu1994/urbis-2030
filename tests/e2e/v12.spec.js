import { test, expect } from '@playwright/test';

async function shot(page, name) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

/** Version 1.2 : polémique née d'une hausse d'impôt, journal local, fête de quartier organisée depuis l'inspecteur. */
test('polémique, journal local et fête de quartier', async ({ page }) => {
  test.setTimeout(500_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => window.__urbis.setSpeed(3));
  await page.waitForFunction(() => window.__urbis.session.state.time.tick > 455, null, { timeout: 180_000 });
  // Hausse brutale de la taxe d'habitation : polémique « Coup de massue fiscal » à la clôture du mois
  await page.evaluate(() => window.__urbis.session.execute({ type: 'tax', key: 'R', value: 13 }));
  await page.waitForFunction(() => (window.__urbis.session.state.controversies?.active ?? []).some((c) => c.kind === 'taxHike'), null, { timeout: 180_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
  await page.evaluate(() => window.__urbis.openPanel('politics', 'press'));
  await expect(page.locator('.newspaper h3')).toBeVisible();
  const card = page.locator('.controversy', { hasText: 'Coup de massue fiscal' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Étaler la hausse' }).click();
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.economy.taxes.R)).toBe(11);
  await expect(card).toContainText('Réponse : étaler la hausse');
  await shot(page, 'v12-press');
  await page.locator('#panel-host .panel-close').click();

  // Fête de quartier : un parc du bourg, depuis l'inspecteur
  const park = await page.evaluate(() => [...window.__urbis.session.state.buildings.values()].find((b) => b.defId === 'park')?.id);
  expect(park).toBeTruthy();
  await page.evaluate((id) => window.__urbis.select({ buildingId: id }), park);
  await page.getByRole('button', { name: 'Organiser un événement' }).click();
  await expect(page.locator('#panel-host .win-title')).toHaveText('Mairie et élections');
  const fete = page.locator('.event-type', { hasText: 'Fête de quartier' });
  await fete.getByRole('button', { name: 'Organiser' }).click();
  await expect(page.locator('.event-planned')).toContainText('Fête de quartier');
  await shot(page, 'v12-events');
  await page.evaluate(() => window.__urbis.setSpeed(3));
  await page.waitForFunction(() => (window.__urbis.session.state.civicEvents?.history ?? []).length > 0, null, { timeout: 180_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
  const e = await page.evaluate(() => window.__urbis.session.state.civicEvents.history.at(-1));
  expect(e.type).toBe('neighborhood');
  expect(errors).toEqual([]);
});
