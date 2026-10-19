import { test, expect } from '@playwright/test';

async function shot(page, name) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

/**
 * Version 1.4 : bouton « Emprunter », améliorations par niveaux, parc posé sur des maisons (démolition
 * automatique), sorties d'autoroute depuis le panneau Territoire et accès.
 */
test('emprunt visible, niveaux d\'améliorations, pose sur des maisons, sorties d\'autoroute', async ({ page }) => {
  test.setTimeout(500_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));

  // Emprunt : bouton de la barre du haut → onglet Emprunts ; carte « Financer un projet » de la synthèse
  await page.locator('.hud-loan').click();
  await expect(page.getByRole('tab', { name: 'Emprunts' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Synthèse' }).click();
  await expect(page.locator('.loan-cta')).toContainText('Vous pouvez emprunter jusqu');
  await page.locator('.loan-cta').getByRole('button', { name: 'Emprunter' }).click();
  await expect(page.getByRole('tab', { name: 'Emprunts' })).toHaveAttribute('aria-selected', 'true');
  await page.locator('#panel-host .panel-close').click();

  // Améliorations par niveaux : la centrale à gaz du bourg
  const gas = await page.evaluate(() => [...window.__urbis.session.state.buildings.values()].find((b) => b.defId === 'power_gas')?.id);
  await page.evaluate((id) => window.__urbis.select({ buildingId: id }), gas);
  const track = page.locator('.up-track', { hasText: 'Production d\'électricité' });
  await expect(track).toContainText('Niveau 0 / 3');
  await track.getByRole('button', { name: 'Installer' }).click();
  await expect(track).toContainText('Niveau 1 / 3');
  await expect(track.locator('.up-pips i.on')).toHaveCount(1);
  await shot(page, 'v14-upgrades');
  await page.evaluate(() => window.__urbis.select(null));

  // Parc posé sur des maisons : aperçu, confirmation, démolition automatique
  const spot = await page.evaluate(() => {
    const s = window.__urbis.session;
    for (const b of s.state.buildings.values()) {
      if (!b.defId.startsWith('res_low') || b.w !== 1) continue;
      const pv = s.preview({ type: 'building', defId: 'park', x: b.x, y: b.y });
      if (pv.ok && pv.replaced.length) return { x: b.x, y: b.y, replaced: pv.replaced };
    }
    return null;
  });
  expect(spot).not.toBeNull();
  await page.evaluate(({ x, y }) => window.__urbis.focus(x, y), spot);
  await page.evaluate(() => window.__urbis.toolbar.select({ id: 'building:park', kind: 'building', defId: 'park', label: 'Parc' }));
  // Position écran du centre de la case (le canevas commence sous la barre du haut)
  const pt = await page.evaluate(({ x, y }) => {
    const p = window.__urbis.renderer.tileToScreen(x, y);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: p.x + r.x, y: p.y + r.y };
  }, spot);
  await page.mouse.move(pt.x, pt.y);
  await expect(page.locator('#cursor-tip')).toContainText('Démolit');
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('.dialog-msg')).toContainText('démolira');
  await page.locator('.dialog').getByRole('button', { name: 'Démolir' }).click();
  await expect.poll(() => page.evaluate(({ x, y }) => {
    const st = window.__urbis.session.state;
    return st.buildings.get(st.grid.building[st.grid.idx(x, y)])?.defId;
  }, spot)).toBe('park');
  await page.keyboard.press('Escape');

  // Sorties d'autoroute : statut Grande ville, panneau Territoire et accès
  await page.evaluate(() => {
    window.__urbis.execute({ type: 'debug', op: 'unlock', population: 20000 });
    window.__urbis.execute({ type: 'debug', op: 'treasury', euros: 5000000 });
  });
  await page.evaluate(() => window.__urbis.openPanel('territory'));
  const south = page.locator('.exit-table tr', { hasText: 'Sud' });
  await expect(south).toContainText('aucune sortie');
  await south.getByRole('button', { name: 'Ouvrir' }).click();
  await page.locator('.dialog').getByRole('button', { name: 'Construire' }).click();
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.entries.length)).toBe(2);
  await page.evaluate(() => window.__urbis.openPanel('territory'));
  await expect(page.locator('.exit-table tr', { hasText: 'Sud' })).toContainText('1 sortie');
  await shot(page, 'v14-exits');
  expect(errors).toEqual([]);
});
