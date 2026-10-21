import { test, expect } from '@playwright/test';

/** Version 0.4 : besoins détaillés, alertes localisées, emprunt maximal, Valider, déplacement, terrassement, routes. */
test('besoins, alertes, emprunt max, pose validée, déplacement, terrassement et démolition des routes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => {
    window.__urbis.setSpeed(0);
    window.__urbis.session.execute({ type: 'debug', op: 'treasury', euros: 2_000_000 });
    window.__urbis.session.execute({ type: 'debug', op: 'unlock', population: 50_000 });
  });

  // 1. Jauges de demande cliquables → panneau « Besoins de la ville »
  await page.locator('.demand-col', { hasText: 'I' }).click();
  await expect(page.locator('.win-title')).toHaveText('Besoins de la ville');
  await expect(page.locator('.demand-factors')).toBeVisible();
  await expect(page.locator('.demand-panel')).toContainText('Fermes');
  await page.getByRole('tab', { name: 'Vue d\'ensemble' }).click();
  await expect(page.locator('.demand-card')).toHaveCount(4);
  await page.keyboard.press('Escape');

  // 2. Emprunt : bouton Max et note de la dette
  await page.keyboard.press('b');
  await page.getByRole('tab', { name: 'Emprunts' }).click();
  await expect(page.locator('.kpi.credit .grade')).toHaveText('A');
  await page.locator('.loan-max').click();
  const max = await page.evaluate(() => window.__urbis.session.sim.economy.maxLoanEuros(window.__urbis.session.state));
  await expect(page.locator('.loan-form input')).toHaveValue(String(max));
  await page.keyboard.press('Escape');

  // Préparation : une route depuis l'entrée et un emplacement libre
  const spot = await page.evaluate(() => {
    const s = window.__urbis.session;
    const g = s.state.grid;
    const e = s.state.entries[0];
    const ex = g.xOf(e);
    const ey = g.yOf(e);
    s.execute({ type: 'road', roadId: 'road_street', from: { x: ex + 3, y: ey }, to: { x: ex + 16, y: ey } });
    for (let k = 4; k < 15; k++) {
      for (const dy of [1, -2]) {
        if (s.preview({ type: 'building', defId: 'park_small', x: ex + k, y: ey + dy }).ok) return { x: ex + k, y: ey + dy, ex, ey };
      }
    }
    return null;
  });
  expect(spot).not.toBeNull();
  const screenOf = (x, y) => page.evaluate(({ x, y }) => {
    const r = window.__urbis.renderer;
    window.__urbis.focus(x, y);
    const p = r.tileToScreen(x, y);
    const rc = r.canvas.getBoundingClientRect();
    return { x: rc.left + p.x, y: rc.top + p.y };
  }, { x, y });

  // 3. Pose avec bouton Valider (option activée pour la souris)
  await page.evaluate(() => window.__urbis.settings.set('confirmPlacement', true));
  await page.getByRole('button', { name: 'Parcs et loisirs' }).click();
  await page.locator('.flyout-item', { hasText: 'Square' }).click();
  const parks = () => page.evaluate(() => [...window.__urbis.session.state.buildings.values()].filter((b) => b.defId === 'park_small').length);
  const before = await parks();
  let p = await screenOf(spot.x, spot.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByRole('button', { name: /^Valider/ })).toBeEnabled();
  expect(await parks()).toBe(before);
  await page.getByRole('button', { name: /^Valider/ }).click();
  await expect.poll(parks).toBe(before + 1);

  // 4. Déplacer l'équipement : choisir, nouvel emplacement, Valider
  const parkId = await page.evaluate(() => Math.max(...[...window.__urbis.session.state.buildings.values()].filter((b) => b.defId === 'park_small').map((b) => b.id)));
  await page.evaluate(() => window.__urbis.toolbar.selectById('move'));
  p = await screenOf(spot.x, spot.y);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#tool-chip')).toContainText('nouvel emplacement');
  const target = await page.evaluate(({ id, spot }) => {
    const s = window.__urbis.session;
    for (let k = 1; k < 12; k++) {
      for (const dy of [1, -2]) {
        const x = spot.ex + 3 + k;
        const y = spot.ey + dy;
        if (s.preview({ type: 'move', buildingId: id, x, y }).ok) return { x, y };
      }
    }
    return null;
  }, { id: parkId, spot });
  expect(target).not.toBeNull();
  p = await screenOf(target.x, target.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.getByRole('button', { name: /^Valider/ }).click();
  await expect.poll(() => page.evaluate((id) => { const b = window.__urbis.session.state.buildings.get(id); return `${b.x},${b.y}`; }, parkId)).toBe(`${target.x},${target.y}`);

  // 5. Terrassement par la barre d'outils (élever une case)
  await page.getByRole('button', { name: 'Terrain', exact: true }).click();
  await page.locator('.flyout-item', { hasText: 'Élever le terrain' }).click();
  const free = await page.evaluate(({ spot }) => {
    const g = window.__urbis.session.state.grid;
    for (let y = spot.ey + 4; y < spot.ey + 12; y++) {
      for (let x = spot.ex + 4; x < spot.ex + 14; x++) {
        const i = g.idx(x, y);
        if (g.terrain[i] !== 1 && !g.road[i] && !g.building[i] && g.altitude[i] < 4) return { x, y, alt: g.altitude[i] };
      }
    }
    return null;
  }, { spot });
  p = await screenOf(free.x, free.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => page.evaluate(({ x, y }) => window.__urbis.session.state.grid.altitude[window.__urbis.session.state.grid.idx(x, y)], free)).toBe(free.alt + 1);

  // 6. Démolir les routes seulement
  await page.getByRole('button', { name: 'Démolir et déplacer' }).click();
  await page.locator('.flyout-item', { hasText: 'Démolir les routes' }).click();
  const roadTile = { x: spot.ex + 16, y: spot.ey };
  p = await screenOf(roadTile.x, roadTile.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => page.evaluate(({ x, y }) => window.__urbis.session.state.grid.road[window.__urbis.session.state.grid.idx(x, y)], roadTile)).toBe(0);

  // 7. Bouton d'alerte : mène au bâtiment sans électricité le plus proche
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__urbis.session.run(40));
  const alertKind = await page.evaluate(() => window.__urbis.hud.alertKind);
  if (alertKind === 'power' || alertKind === 'water') {
    await page.locator('.hud-alerts').click();
    await expect(page.locator('#inspector')).toBeVisible();
  }

  // 8. Notifications rangées sur le bord droit (v1.6 : en haut à droite)
  const box = await page.locator('#toasts').boundingBox();
  const vp = page.viewportSize();
  expect(box.x + box.width).toBeGreaterThan(vp.width - 40);
  expect(errors).toEqual([]);
});
