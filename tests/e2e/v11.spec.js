import { test, expect } from '@playwright/test';

async function shot(page, name) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

/** Version 1.1 : conseil municipal (nomination d'un adjoint) et priorités du mandat. */
test('conseil municipal : nommer un adjoint, répartir les priorités', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
  // Le bourg existant a le statut Village : deux délégations
  await page.keyboard.press('e');
  await page.getByRole('tab', { name: 'Conseil' }).click();
  await expect(page.locator('.kpi', { hasText: 'Délégations' })).toContainText('0 / 2');
  const finance = page.locator('.delegation', { hasText: 'Finances et budget' });
  await finance.getByRole('button', { name: 'Nommer' }).first().click();
  await expect(page.locator('.kpi', { hasText: 'Délégations' })).toContainText('1 / 2');
  await expect(finance.getByRole('button', { name: 'Remplacer' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.politics.council.members.length)).toBe(1);
  await shot(page, 'v11-council');

  // Priorités : la mobilité passe à 40 %, les autres axes compensent
  await page.getByRole('tab', { name: 'Priorités' }).click();
  await page.locator('#agenda-mobility').fill('40');
  await page.locator('#agenda-mobility').dispatchEvent('change');
  await expect(page.locator('.agenda-row', { hasText: 'Mobilité' }).locator('output')).toHaveText('40 %');
  await page.getByRole('button', { name: /Appliquer \(\d+ points déplacés\)/ }).click();
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.politics.agenda.shares.mobility)).toBe(40);
  const sum = await page.evaluate(() => Object.values(window.__urbis.session.state.politics.agenda.shares).reduce((a, b) => a + b, 0));
  expect(sum).toBe(100);
  await shot(page, 'v11-agenda');
  expect(errors).toEqual([]);
});
