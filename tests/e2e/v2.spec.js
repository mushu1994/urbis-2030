import { test, expect } from '@playwright/test';

/** Version 0.2 : scénarios, crises, météo, son, simulation en Web Worker. */
test('scénario depuis l\'accueil, crise déclenchée et gérée, météo, son, Web Worker', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  // 1. Scénario choisi dans l'onglet « Scénarios et défis »
  await page.getByRole('tab', { name: 'Scénarios et défis' }).click();
  const card = page.locator('.scenario-card', { hasText: 'Valmont-sur-Dette' });
  await expect(card).toContainText('Diviser la dette par deux');
  await card.getByRole('button', { name: 'Relever le défi' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
  await expect(page.locator('#objectives')).toContainText('Valmont-sur-Dette');
  await expect(page.locator('#objectives')).toContainText('Échéance : 5 ans');

  // 2. Simulation dans un Web Worker, réplique à jour après une avance explicite
  expect(await page.evaluate(() => window.__urbis.host.kind)).toBe('worker');
  const t0 = await page.evaluate(() => window.__urbis.session.state.time.tick);
  await page.evaluate(() => window.__urbis.session.run(30));
  expect(await page.evaluate(() => window.__urbis.session.state.time.tick)).toBe(t0 + 30);

  // 3. Météo affichée dans la barre du haut
  await expect(page.locator('.hud-weather')).toHaveText(/°/);

  // 4. Crise déclenchée depuis le tableau de bord, puis décision
  await page.keyboard.press('c');
  await page.getByRole('tab', { name: 'Risques et météo' }).click();
  await expect(page.locator('.risk-table')).toContainText('Incendie');
  await page.locator('details.trigger summary').click();
  await page.getByRole('button', { name: '🔥 Incendie' }).click();
  await page.locator('.dialog').getByRole('button', { name: 'Déclencher' }).click();
  await page.keyboard.press('Escape');
  const crisis = page.locator('.crisis-card');
  await expect(crisis).toContainText('Incendie');
  // Valmont n'a pas les moyens d'appeler des renforts : la réponse payante est grisée
  await expect(crisis.getByRole('button', { name: /Appeler les renforts/ })).toBeDisabled();
  await crisis.getByRole('button', { name: /Laisser agir les pompiers/ }).click();
  await expect(page.locator('.crisis-pill')).toContainText('Laisser agir les pompiers');
  await page.evaluate(() => window.__urbis.session.run(40));
  await expect(page.locator('#crisis')).toBeHidden();
  const history = await page.evaluate(() => window.__urbis.session.state.crises.history.map((c) => c.kind));
  expect(history).toContain('fire');

  // 5. Son : le bouton haut-parleur ouvre les réglages du son ; la case coupe ou rétablit le son
  const mute = page.locator('.hud-mute');
  const before = await mute.getAttribute('aria-pressed');
  await mute.click();
  await expect(page.locator('#panel-host .win-title')).toHaveText('Réglages du son');
  await page.locator('#sound-muted').click();
  await expect(mute).not.toHaveAttribute('aria-pressed', before);
  await page.locator('#panel-host .panel-close').click();

  // 6. Sauvegarde : la réplique est synchronisée avant l'écriture
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast', { hasText: 'Partie sauvegardée' })).toBeVisible();

  await page.screenshot({ path: 'test-results/e2e-v2.png' });
  expect(errors).toEqual([]);
});
