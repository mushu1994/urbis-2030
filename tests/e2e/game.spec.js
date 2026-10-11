import { test, expect } from '@playwright/test';

/** Coordonnées page du centre d'une case. */
async function tileToPage(page, x, y) {
  return page.evaluate(([x, y]) => {
    const app = window.__urbis;
    const p = app.renderer.tileToScreen(x, y);
    const r = app.renderer.canvas.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [x, y]);
}

/** Cherche un emplacement valide (lecture seule, via la prévisualisation du jeu). */
async function findSpot(page, defId, near) {
  return page.evaluate(([defId, near]) => {
    const s = window.__urbis.session;
    for (let r = 0; r < 20; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const cmd = { type: 'building', defId, x: near.x + dx, y: near.y + dy, rot: 0 };
          if (s.preview(cmd).ok) {
            const def = s.catalog.building(defId);
            return { x: cmd.x + Math.floor((def.footprint.w - 1) / 2), y: cmd.y + Math.floor((def.footprint.h - 1) / 2) };
          }
        }
      }
    }
    return null;
  }, [defId, near]);
}

async function drag(page, from, to) {
  const a = await tileToPage(page, from.x, from.y);
  const b = await tileToPage(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

async function chooseTool(page, category, item) {
  await page.getByRole('button', { name: category, exact: true }).click();
  await page.locator('.flyout-item', { hasText: item }).first().click();
}

test('fonder une ville, la relier, l\'alimenter, la zoner et la voir grandir', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nouvelle partie' })).toBeVisible();
  await page.getByLabel('Nom de la ville').fill('Testville');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await expect(page.locator('.hud-city')).toContainText('Testville');

  const entry = await page.evaluate(() => {
    const s = window.__urbis.session.state;
    return { x: s.grid.xOf(s.entries[0]), y: s.grid.yOf(s.entries[0]) };
  });

  // 1. Route depuis l'accès autoroutier, tracée à la souris
  await chooseTool(page, 'Routes', 'Rue');
  await drag(page, { x: 3, y: entry.y }, { x: 16, y: entry.y });
  const roads = await page.evaluate((y) => {
    const g = window.__urbis.session.state.grid;
    let n = 0;
    for (let x = 3; x <= 16; x++) if (g.road[g.idx(x, y)]) n++;
    return n;
  }, entry.y);
  expect(roads).toBeGreaterThan(10);

  // 2. Centrale électrique
  await chooseTool(page, 'Énergie', 'Centrale à gaz');
  const spot = await findSpot(page, 'power_gas', { x: 6, y: entry.y + 2 });
  expect(spot).not.toBeNull();
  const p = await tileToPage(page, spot.x, spot.y);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('#cursor-tip')).toContainText('55');
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => [...window.__urbis.session.state.buildings.values()].some((b) => b.defId === 'power_gas'))).toBe(true);

  // 3. Zonage résidentiel et commercial
  await chooseTool(page, 'Zonage', 'Résidentiel faible densité');
  await drag(page, { x: 9, y: entry.y - 3 }, { x: 16, y: entry.y - 1 });
  await chooseTool(page, 'Zonage', 'Commerce');
  await drag(page, { x: 11, y: entry.y + 1 }, { x: 16, y: entry.y + 2 });
  const zoned = await page.evaluate(() => window.__urbis.session.state.grid.zone.reduce((a, z) => a + (z ? 1 : 0), 0));
  expect(zoned).toBeGreaterThan(10);

  // 4. Accélération du temps : la population apparaît
  await page.keyboard.press('Escape');
  await page.keyboard.press('3');
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.stats.population), { timeout: 30_000 }).toBeGreaterThan(10);
  await page.screenshot({ path: 'test-results/e2e-ville.png' });

  // 5. Annulation clavier d'une action récente
  await chooseTool(page, 'Routes', 'Rue');
  await drag(page, { x: 16, y: entry.y + 4 }, { x: 16, y: entry.y + 6 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.toast', { hasText: /Annulé|évolué|ancienne|Aucune/ }).first()).toBeVisible();

  // 6. Panneaux de gestion
  await page.keyboard.press('b');
  await expect(page.getByRole('heading', { name: 'Finances municipales' })).toBeVisible();
  await page.getByRole('tab', { name: 'Fiscalité et tarifs' }).click();
  await expect(page.getByText('Impôt résidentiel')).toBeVisible();
  await page.keyboard.press('i');
  await expect(page.getByRole('heading', { name: 'IA urbaine et politiques publiques' })).toBeVisible();
  await page.keyboard.press('c');
  await expect(page.getByRole('heading', { name: 'Tableau de bord de la ville' })).toBeVisible();
  await page.keyboard.press('Escape');

  // 7. Couche de données
  await page.keyboard.press('l');
  await expect(page.locator('.ov-toggle')).toHaveText('Densité de population');

  // 8. Inspection d'un bâtiment (on masque la couche et on replie la liste des couches)
  await page.locator('.ov-clear').click();
  await page.locator('.ov-toggle').click();
  await expect(page.locator('.ov-list')).toHaveCount(0);
  const plant = await page.evaluate(() => {
    const b = [...window.__urbis.session.state.buildings.values()].find((x) => x.defId === 'power_gas');
    return { x: b.x + 1, y: b.y + 1 };
  });
  await page.keyboard.press('Escape');
  // la caméra est recentrée sur la centrale, comme le ferait le joueur en faisant défiler la vue
  await page.evaluate(([x, y]) => window.__urbis.renderer.focus(x, y), [plant.x, plant.y]);
  const pp = await tileToPage(page, plant.x, plant.y);
  await page.mouse.click(pp.x, pp.y);
  await expect(page.locator('#inspector h2')).toHaveText('Centrale à gaz');

  // 9. Sauvegarde rapide puis rechargement depuis le menu
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast', { hasText: 'Partie sauvegardée' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Continuer/ })).toBeVisible();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await expect(page.locator('.hud-city')).toContainText('Testville');
  expect(await page.evaluate(() => window.__urbis.session.state.buildings.size)).toBeGreaterThan(1);

  expect(errors).toEqual([]);
});
