import { test, expect } from '@playwright/test';

async function newTown(page) {
  await page.goto('/');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 120_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
}

/** Pose un bâtiment par la commande de jeu (mêmes règles et mêmes coûts que la souris). */
async function place(page, defId) {
  return page.evaluate((defId) => {
    const app = window.__urbis;
    const s = app.session;
    // Déblocage par la commande de débogage (la simulation peut tourner dans un Web Worker)
    s.execute({ type: 'debug', op: 'unlock', population: 5000 });
    // v0.6 : constructions 50 % plus chères, le bourg de départ n'a plus de quoi tout payer
    if (s.state.economy.treasury < 50_000_000) s.execute({ type: 'debug', op: 'treasury', euros: 1_000_000 });
    for (let y = 6; y < s.state.grid.height - 6; y++) {
      for (let x = 6; x < s.state.grid.width - 6; x++) {
        const r = s.execute({ type: 'building', defId, x, y });
        if (r.ok) return { id: r.building.id, x, y };
      }
    }
    return null;
  }, defId);
}

test('fiches du menu, améliorations, échanges régionaux, train et notifications', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newTown(page);

  // 1. Fiche descriptive avant construction : survol d'un bâtiment dans le menu
  await page.getByRole('button', { name: 'Police et pompiers', exact: true }).click();
  await page.locator('.flyout-item', { hasText: 'Commissariat' }).hover();
  await expect(page.locator('.flyout-sheet h4')).toHaveText('Commissariat');
  await expect(page.locator('.flyout-sheet')).toContainText('Sécurité : rayon de 14 cases');
  await expect(page.locator('.flyout-sheet')).toContainText('Construction');
  await expect(page.locator('.flyout-sheet .sheet-up')).toContainText('amélioration');
  // un bâtiment encore verrouillé peut être consulté via le bouton « i »
  await page.getByRole('button', { name: 'Fiche : Caserne à drones' }).click();
  await expect(page.locator('.flyout-sheet h4')).toHaveText('Caserne à drones');
  await page.keyboard.press('Escape');

  // 2. Amélioration d'un équipement depuis l'inspecteur
  const police = await place(page, 'police');
  expect(police).not.toBeNull();
  await page.evaluate((id) => window.__urbis.select({ buildingId: id }), police.id);
  await expect(page.locator('#inspector h3', { hasText: 'Améliorations' })).toBeVisible();
  const treasury = await page.evaluate(() => window.__urbis.session.state.economy.treasury);
  await page.locator('#inspector .upgrade', { hasText: 'Patrouilles de proximité' }).getByRole('button', { name: 'Installer' }).click();
  await expect(page.locator('#inspector .upgrade.installed', { hasText: 'Patrouilles de proximité' })).toBeVisible();
  expect(await page.evaluate((id) => window.__urbis.session.state.buildings.get(id).upgrades, police.id)).toEqual(['police_patrols']);
  expect(await page.evaluate(() => window.__urbis.session.state.economy.treasury)).toBeLessThan(treasury);
  await expect(page.locator('#inspector .kv', { hasText: 'Rayon d\'action' })).toContainText('18 cases');
  await page.keyboard.press('Escape');

  // 3. Échanges régionaux : achat d'électricité activé depuis les Finances
  await page.keyboard.press('b');
  await page.getByRole('tab', { name: 'Échanges régionaux' }).click();
  await expect(page.locator('.trade-card')).toHaveCount(3);
  // v0.8 : prix du marché régional affiché à part (cours variable)
  await expect(page.locator('.trade-card').first().locator('.market-price').first()).toContainText('/ u.');
  await page.locator('.trade-card').first().getByLabel('Acheter en cas de pénurie').click();
  expect(await page.evaluate(() => window.__urbis.session.state.trade.power.buy)).toBe(true);
  await page.locator('.trade-card').first().getByLabel('Vendre les excédents').click();
  expect(await page.evaluate(() => window.__urbis.session.state.trade.power.sell)).toBe(true);
  await page.keyboard.press('Escape');

  // 4. Train : une gare transporte des voyageurs et ses rames sont animées
  const gare = await place(page, 'train_station');
  expect(gare).not.toBeNull();
  await page.evaluate(() => window.__urbis.session.run(30));
  const rail = await page.evaluate((id) => {
    const app = window.__urbis;
    const b = app.session.state.buildings.get(id);
    return { active: b.transitActive, pax: b.transitPassengers, gfx: app.renderer.trains.gfx.has(id) || app.renderer.trains.stations.some((s) => s.id === id) };
  }, gare.id);
  expect(rail.active).toBe(true);
  expect(rail.pax).toBeGreaterThan(0);
  await page.evaluate((id) => window.__urbis.select({ buildingId: id }), gare.id);
  await expect(page.locator('#inspector')).toContainText('Voyageurs de cet équipement');
  await page.evaluate(([x, y]) => window.__urbis.focus(x + 1, y + 1), [gare.x, gare.y]);
  await page.evaluate(() => window.__urbis.setSpeed(1));
  await page.waitForTimeout(1500);
  expect(await page.evaluate((id) => window.__urbis.renderer.trains.gfx.has(id), gare.id)).toBe(true);
  await page.screenshot({ path: 'test-results/e2e-gare.png' });
  await page.evaluate(() => window.__urbis.setSpeed(0));
  await page.keyboard.press('Escape');

  // 5. Notifications : un clic ferme, « Tout effacer » vide la pile, jamais au-dessus des menus
  await page.evaluate(() => {
    const n = window.__urbis.notifications;
    n.clear();
    n.ttl = { info: 120_000, success: 120_000, warning: 120_000, danger: 120_000 }; // machine de test lente
    n.push({ level: 'info', message: 'Essai A' });
    n.push({ level: 'info', message: 'Essai B' });
    n.push({ level: 'warning', message: 'Essai C' });
    n.push({ level: 'warning', message: 'Essai C' });
  });
  await expect(page.locator('.toast', { hasText: 'Essai C' })).toContainText('×2');
  await expect(page.locator('.toast:not(.leaving)')).toHaveCount(3);
  await page.locator('.toast', { hasText: 'Essai A' }).click();
  await expect(page.locator('.toast', { hasText: 'Essai A' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Tout effacer' }).click();
  await expect(page.locator('.toast')).toHaveCount(0);
  const z = await page.evaluate(() => {
    const zi = (sel) => Number(getComputedStyle(document.querySelector(sel)).zIndex);
    return { toasts: zi('#toasts'), flyout: zi('.flyout'), panels: zi('#panel-host'), inspector: zi('#inspector'), toolbar: zi('#toolbar') };
  });
  expect(z.toasts).toBeLessThan(Math.min(z.flyout, z.panels, z.inspector, z.toolbar));

  expect(errors).toEqual([]);
});

test.describe('au doigt', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('fiche dépliable dans le menu et notification fermée d\'un appui', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.getByLabel('Départ').selectOption('town');
    await page.getByRole('button', { name: 'Fonder la ville' }).tap();
    await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 120_000 });
    await page.evaluate(() => window.__urbis.setSpeed(0));

    await page.getByRole('button', { name: 'Énergie', exact: true }).tap();
    await page.getByRole('button', { name: 'Fiche : Centrale à gaz' }).tap();
    await expect(page.locator('.fi-sheet:not([hidden]) .sheet')).toContainText('Pollution');
    await page.getByRole('button', { name: 'Fiche : Centrale à gaz' }).tap();
    await expect(page.locator('.fi-sheet:not([hidden])')).toHaveCount(0);
    // un appui sur l'élément choisit l'outil, comme avant
    await page.locator('.flyout-item', { hasText: 'Centrale à gaz' }).tap();
    await expect(page.locator('#tool-chip')).toContainText('Centrale à gaz');
    await expect(page.locator('#tool-chip .chip-summary')).toContainText('électricité');
    await page.getByRole('button', { name: 'Terminer' }).tap();

    await page.evaluate(() => window.__urbis.notifications.push({ level: 'info', message: 'Message de test' }));
    await page.locator('.toast', { hasText: 'Message de test' }).tap();
    await expect(page.locator('.toast', { hasText: 'Message de test' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
