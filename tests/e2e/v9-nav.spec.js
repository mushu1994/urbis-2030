import { test, expect } from '@playwright/test';

async function shot(page, name) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

async function tileToPage(page, x, y) {
  return page.evaluate(([x, y]) => {
    const app = window.__urbis;
    const p = app.renderer.tileToScreen(x, y);
    const r = app.renderer.canvas.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [x, y]);
}

/** Navigation (v0.9) : rotation de la carte par quarts de tour, boussole, vue de dessus, pointage juste. */
test('navigation : rotation de la carte et vue de dessus', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => {
    const app = window.__urbis;
    app.setSpeed(0);
    app.notifications.clear();
    app.session.execute({ type: 'debug', op: 'treasury', euros: 1_000_000 });
  });
  const center = await page.evaluate(() => {
    const r = window.__urbis.renderer;
    return r.tileAtScreen(r.view.width / 2, r.view.height / 2);
  });
  await shot(page, 'v9-nav-rot0');

  const widget = page.locator('#nav-widget');
  await expect(widget).toBeVisible();
  for (let k = 1; k <= 4; k++) {
    await widget.getByRole('button', { name: 'Tourner la carte vers la droite' }).click();
    await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode.rot)).toBe(k % 4);
    // La case au centre de l'écran reste au centre
    const c = await page.evaluate(() => {
      const r = window.__urbis.renderer;
      return r.tileAtScreen(r.view.width / 2, r.view.height / 2);
    });
    expect(Math.abs(c.x - center.x) + Math.abs(c.y - center.y)).toBeLessThanOrEqual(2);
    if (k < 4) await shot(page, `v9-nav-rot${k}`);
  }
  // Touche ; : un quart de tour ; clic sur la boussole : retour au nord
  await page.keyboard.press(';');
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode.rot)).toBe(1);
  await page.locator('.nav-compass').click();
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode.rot)).toBe(0);

  // Pointage juste dans une vue tournée : poser une route à la souris là où l'on clique
  await page.keyboard.press(';');
  await page.keyboard.press(';');
  const target = await page.evaluate(() => {
    const s = window.__urbis.session;
    const g = s.state.grid;
    const r = window.__urbis.renderer;
    const c = r.tileAtScreen(r.view.width / 2, r.view.height / 2);
    for (let d = 0; d < 12; d++) {
      for (const [x, y] of [[c.x + d, c.y], [c.x - d, c.y], [c.x, c.y + d], [c.x, c.y - d]]) {
        if (!g.inBounds(x, y)) continue;
        const i = g.idx(x, y);
        if (!g.road[i] && !g.building[i] && g.terrain[i] !== 1 && s.preview({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x, y } }).ok) return { x, y };
      }
    }
    return null;
  });
  expect(target).not.toBeNull();
  await page.evaluate(() => window.__urbis.toolbar.selectById('road:road_street'));
  const p = await tileToPage(page, target.x, target.y);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(([x, y]) => window.__urbis.session.state.grid.road[window.__urbis.session.state.grid.idx(x, y)] > 0, [target.x, target.y])).toBe(true);
  await page.keyboard.press('Escape');

  // Vue de dessus (bouton et touche V), aussi en orientation tournée
  await page.locator('.nav-view').click();
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode.top)).toBe(true);
  await expect(page.locator('.nav-view')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'v9-nav-top-rot2');
  await page.locator('.nav-compass').click();
  await shot(page, 'v9-nav-top');
  // Inspecter un bâtiment en vue de dessus
  const b = await page.evaluate(() => {
    const st = window.__urbis.session.state;
    const r = window.__urbis.renderer;
    for (const b of st.buildings.values()) {
      const p = r.tileToScreen(b.x, b.y);
      if (p.x > 120 && p.y > 120 && p.x < r.view.width - 120 && p.y < r.view.height - 120) return { id: b.id, x: b.x, y: b.y };
    }
    return null;
  });
  expect(b).not.toBeNull();
  await page.evaluate(() => window.__urbis.toolbar.selectById('select'));
  const bp = await tileToPage(page, b.x, b.y);
  await page.mouse.click(bp.x, bp.y);
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.selectedId)).toBe(b.id);
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode.top)).toBe(false);
  expect(errors).toEqual([]);
});

test.describe('au doigt', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('téléphone : boussole visible, rotation et vue de dessus au doigt', async ({ page }) => {
    test.setTimeout(300_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.getByLabel('Départ').selectOption('town');
    await page.getByRole('button', { name: 'Fonder la ville' }).tap();
    await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
    await page.evaluate(() => {
      window.__urbis.setSpeed(0);
      window.__urbis.notifications.clear();
    });
    const w = page.locator('#nav-widget');
    await expect(w).toBeVisible();
    const box = await w.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await w.getByRole('button', { name: 'Tourner la carte vers la gauche' }).tap();
    await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode.rot)).toBe(3);
    await page.locator('.nav-view').tap();
    await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode.top)).toBe(true);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/v9-nav-phone.png` });
    await page.locator('.nav-view').tap();
    await page.locator('.nav-compass').tap();
    await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode)).toEqual({ rot: 0, top: false });
    expect(errors).toEqual([]);
  });
});
