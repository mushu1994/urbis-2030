import { test, expect } from '@playwright/test';

/** Version 0.7 : vie politique (popularité, campagne, scrutin), couches par service, emploi, ressources, ruines. */
test('mairie : programme de campagne, scrutin, couches des services, emploi, ressources et ruines', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => {
    window.__urbis.setSpeed(0);
    window.__urbis.session.execute({ type: 'debug', op: 'treasury', euros: 5_000_000 });
    window.__urbis.session.execute({ type: 'debug', op: 'unlock', population: 50_000 });
  });

  // Popularité dans la barre du haut → panneau « Mairie et élections »
  await expect(page.locator('.hud-approval')).toContainText('58 %');
  await page.locator('.hud-approval').click();
  await expect(page.locator('#panel-host .win-title')).toHaveText('Mairie et élections');
  await page.getByRole('tab', { name: 'Campagne' }).click();
  await expect(page.locator('#panel-host')).toContainText('La campagne s\'ouvrira');
  await page.keyboard.press('Escape');

  // Scrutin avancé : la campagne s'ouvre, on compose un programme
  await page.evaluate(async () => {
    const s = window.__urbis.session;
    s.execute({ type: 'debug', op: 'election', months: 7 });
    await s.run(60);
  });
  await page.waitForFunction(() => !!window.__urbis.session.state.politics.campaign, null, { timeout: 60_000 });
  await page.keyboard.press('e');
  await page.getByRole('tab', { name: 'Campagne' }).click();
  await expect(page.locator('.offer').first()).toBeVisible();
  const groups = page.locator('.offer-group');
  const n = Math.min(3, await groups.count());
  for (let k = 0; k < n; k++) await groups.nth(k).locator('.offer input').first().check();
  await page.locator('.theme', { hasText: 'Finances saines' }).click();
  await expect(page.locator('.vote-estimate')).toContainText('Intentions de vote estimées');
  await page.getByRole('button', { name: 'Déposer ce programme' }).click();
  await expect(page.getByRole('button', { name: 'Programme enregistré' })).toBeVisible();
  const chosen = await page.evaluate(() => window.__urbis.session.state.politics.campaign.chosen.length);
  expect(chosen).toBe(n);
  await page.keyboard.press('Escape');

  // Soirée électorale
  await page.evaluate(async () => {
    await window.__urbis.session.run(210);
  });
  await expect(page.locator('.election-night')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.election-night')).toContainText('Votre liste');
  const result = await page.evaluate(() => window.__urbis.session.state.politics.elections.at(-1));
  expect(result.share).toBeGreaterThan(0);
  await page.locator('.election-night .btn.primary').click();
  await expect(page.locator('.election-night')).toHaveCount(0);

  // Couches par service public, regroupées par thème
  await page.locator('.panel-btn[data-panel="layers"]').click();
  for (const label of ['Éducation', 'Sécurité (police)', 'Secours (pompiers)', 'Santé', 'Administration', 'Saturation des équipements']) {
    await page.locator('.ov-item', { hasText: label }).first().click();
    await expect(page.locator('.ov-toggle')).toHaveText(label);
  }
  await expect(page.locator('.ov-group', { hasText: 'Services publics' })).toBeVisible();
  await page.locator('.ov-item', { hasText: 'Vue normale' }).click();

  // Choisir une école affiche la couche « Éducation »
  await page.getByRole('button', { name: 'Éducation et culture', exact: true }).click();
  await page.locator('.flyout-item', { hasText: 'École' }).first().click();
  await expect(page.locator('.ov-toggle')).toHaveText('Éducation');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.ov-toggle')).toHaveText('Couches de données');

  // Emploi et ressources
  await page.evaluate(() => window.__urbis.openPanel('demand', 'jobs'));
  await expect(page.locator('.demand-card.jobs')).toContainText('Marché du travail');
  await page.evaluate(() => window.__urbis.openPanel('finance', 'resources'));
  await expect(page.locator('#panel-host table.fin')).toContainText('Gaz naturel');
  await page.keyboard.press('Escape');

  // Ruines : un équipement public détruit se reconstruit depuis l'inspecteur
  const id = await page.evaluate(async () => {
    const s = window.__urbis.session;
    const g = s.state.grid;
    const e = s.state.entries[0];
    const y = g.yOf(e);
    s.execute({ type: 'road', roadId: 'road_street', from: { x: 3, y }, to: { x: 16, y } });
    let r = null;
    for (let x = 4; x < 15 && !r?.ok; x++) {
      for (const yy of [y + 1, y - 2]) {
        if (s.preview({ type: 'building', defId: 'police', x, y: yy }).ok) {
          r = s.execute({ type: 'building', defId: 'police', x, y: yy });
          break;
        }
      }
    }
    await s.run(2);
    s.execute({ type: 'debug', op: 'ruin', buildingId: r.building.id, cause: 'fire' });
    await s.run(2);
    return r.building.id;
  });
  await page.evaluate((bid) => { window.__urbis.setSpeed(0); window.__urbis.select({ buildingId: bid }); }, id);
  await expect(page.locator('#inspector')).toContainText('En ruines');
  await page.locator('#inspector').getByRole('button', { name: /Reconstruire/ }).click();
  await expect(page.locator('#inspector')).toContainText('Reconstruction');
  expect(await page.evaluate((bid) => !!window.__urbis.session.state.buildings.get(bid).ruins, id)).toBe(false);
  expect(errors).toEqual([]);
});
