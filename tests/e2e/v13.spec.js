import { test, expect } from '@playwright/test';

async function shot(page, name) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

/** Version 1.3 : opinion par groupe, premier tour sans vainqueur, fusion d'entre-deux-tours, soirée électorale à deux tours. */
test('électorat par groupes et scrutin à deux tours avec fusion', async ({ page }) => {
  test.setTimeout(500_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Simulation dans le fil principal : le parcours règle la popularité jour après jour
  await page.addInitScript(() => {
    localStorage.setItem('urbis2030.settings', JSON.stringify({ muted: true, dayNight: false, weatherFx: false, effects: false, simWorker: false }));
  });
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
  // Opinion : tableau des groupes d'électeurs
  await page.keyboard.press('e');
  await expect(page.locator('#panel-host')).toContainText('Opinion par groupe d\'électeurs');
  await expect(page.locator('#panel-host')).toContainText('Classes populaires');
  await page.keyboard.press('Escape');

  // Scrutin le mois prochain, popularité à 44 % : une liste citoyenne se présente, pas de majorité au premier tour
  await page.evaluate(() => {
    const s = window.__urbis.session;
    s.state.politics.agenda.shares = { urban: 15, finance: 15, mobility: 15, safety: 15, ecology: 15, social: 25 };
    s.execute({ type: 'debug', op: 'election', months: 1 });
    const p = s.state.politics;
    // Banc d'essai : la popularité cible reste à 44 % jusqu'au scrutin
    const target = s.sim.politics.target.bind(s.sim.politics);
    s.sim.politics.target = (st) => ({ ...target(st), target: 44 });
    for (let k = 0; k < 120 && !p.secondRound && !p.elections.length; k++) {
      p.approval = 44;
      p.target = 44;
      s.run(1);
    }
  });
  await expect(page.locator('.round-one')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.round-one')).toContainText('Premier tour');
  await shot(page, 'v13-round-one');
  await page.locator('.round-one .btn.primary').first().click();
  await expect(page.locator('.election-night')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.election-night')).toContainText('2d tour');
  await expect(page.locator('.election-night')).toContainText('Conseil municipal');
  await shot(page, 'v13-election');
  const r = await page.evaluate(() => window.__urbis.session.state.politics.elections.at(-1));
  expect(r.rounds).toHaveLength(2);
  expect(r.mergeWith).toBeTruthy();
  await page.locator('.election-night .btn.primary').click();
  await expect(page.locator('.election-night')).toHaveCount(0);
  expect(errors).toEqual([]);
});
