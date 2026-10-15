import { test, expect } from '@playwright/test';

async function shot(page, name) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

/** Version 0.9 : guide du maire (accueil et partie) et conseiller circulation et pollution. */
test('guide du maire et conseiller circulation et pollution', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  // Depuis l'écran d'accueil : le guide s'ouvre dans une fenêtre, chapitre par chapitre
  await page.getByRole('button', { name: /Comment jouer/ }).click();
  await expect(page.locator('.dialog .guide-body h3')).toHaveText('Premiers pas');
  await page.locator('.dialog .guide-nav .btn.primary').click();
  await expect(page.locator('.dialog .guide-body h3')).toHaveText('Routes et accès');
  await expect(page.locator('.dialog .guide-chapter.read')).toHaveCount(2);
  await shot(page, 'v9-guide-menu');
  await page.locator('.dialog').getByRole('button', { name: 'Fermer' }).click();
  await expect(page.locator('.dialog')).toHaveCount(0);

  await page.getByLabel('Départ').selectOption('town');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));

  // Guide en partie (touche G) : « Montre-moi » ouvre l'outil
  await page.keyboard.press('g');
  await expect(page.locator('#panel-host .win-title')).toContainText('Guide du maire');
  await page.locator('.guide-chapter', { hasText: 'Routes et accès' }).click();
  await page.getByRole('button', { name: 'Montre-moi : Outil Rue' }).click();
  await expect.poll(() => page.evaluate(() => window.__urbis.tools.tool.id)).toBe('road:road_street');
  await page.keyboard.press('Escape');

  // Conseiller circulation (touche P) sur une ville embouteillée (flux saturés écrits dans la grille)
  await page.evaluate(() => {
    const s = window.__urbis.session.state;
    const g = s.grid;
    let n = 0;
    for (let i = 0; i < g.size && n < 12; i++) {
      if (g.road[i] && g.road[i] !== 3) {
        g.traffic[i] = 1500;
        g.congestion[i] = 1.6;
        n++;
      }
    }
    s.traffic.stats = { ...s.traffic.stats, vehicleTrips: 5000, avgCongestion: 0.75, congestedTiles: 12, avgCommute: 21 };
  });
  await page.keyboard.press('p');
  await expect(page.locator('#panel-host .win-title')).toContainText('Circulation et pollution');
  await expect(page.locator('.traffic-level')).toContainText('Circulation saturée');
  await expect(page.locator('.advice-card').first()).toBeVisible();
  await expect(page.locator('#panel-host')).toContainText('Points noirs');
  await shot(page, 'v9-traffic');
  // Adopter une politique depuis un conseil
  const adopt = page.locator('.advice-card', { hasText: 'Télétravail' }).getByRole('button', { name: /Adopter/ });
  await adopt.click();
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.policies.active.remote_work !== undefined)).toBe(true);
  // Voir un point noir : le panneau se ferme et la couche Congestion s'affiche
  await page.locator('#panel-host table.fin').getByRole('button', { name: 'Voir' }).first().click();
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.overlayId)).toBe('congestion');
  await page.getByRole('tab', { name: 'Comprendre les leviers' }).count();
  await page.keyboard.press('p');
  await page.getByRole('tab', { name: 'Comprendre les leviers' }).click();
  await expect(page.locator('#panel-host')).toContainText('Comment se forme un embouteillage');
  await shot(page, 'v9-levers');
  expect(errors).toEqual([]);
});
