import { test, expect } from '@playwright/test';

// iPad en paysage, écran tactile : les longs menus de construction doivent rester atteignables jusqu'en bas.
test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true });

test('iPad : chaque menu de construction tient à l\'écran et défile jusqu\'en bas ; le lycée se pose', async ({ page }) => {
  test.setTimeout(900_000); // ~30 ouvertures de menu en rendu logiciel (1,5 image/s)
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Fonder la ville' }).tap();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => {
    window.__urbis.setSpeed(0);
    window.__urbis.session.execute({ type: 'debug', op: 'unlock', population: 100_000 });
  });

  // Toutes les catégories à menu, sur plusieurs formats d'iPad (paysage, portrait, petite hauteur)
  const cats = await page.evaluate(() => window.__urbis.toolbar.categories.filter((c) => c.tools).map((c) => c.label));
  expect(cats.length).toBeGreaterThan(8);
  for (const size of [{ width: 1024, height: 768 }, { width: 820, height: 1180 }, { width: 1180, height: 640 }]) {
    await page.setViewportSize(size);
    for (const name of cats) {
      const btn = page.getByRole('button', { name, exact: true });
      await btn.tap();
      const flyout = page.locator('.flyout.open');
      await expect(flyout).toBeVisible();
      const where = `${name} ${size.width}×${size.height}`;
      // Le menu ne dépasse jamais le bas (ni le haut) de l'écran
      const box = await flyout.boundingBox();
      expect(box.y, `haut ${where}`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `bas ${where}`).toBeLessThanOrEqual(size.height + 1);
      // Le dernier élément de la liste est atteignable en faisant défiler le menu
      const last = flyout.locator('.flyout-item').last();
      await last.scrollIntoViewIfNeeded();
      const lb = await last.boundingBox();
      expect(lb.y + lb.height, `dernier élément ${where}`).toBeLessThanOrEqual(box.y + box.height + 1);
      await btn.tap();
    }
  }

  await page.getByRole('button', { name: 'Éducation et culture', exact: true }).tap();
  await page.locator('.flyout-item', { hasText: 'Lycée' }).tap();
  expect(await page.evaluate(() => window.__urbis.tools.tool.defId)).toBe('high_school');
  expect(errors).toEqual([]);
});
