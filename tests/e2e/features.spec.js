import { test, expect } from '@playwright/test';

async function tileToPage(page, x, y) {
  return page.evaluate(([x, y]) => {
    const app = window.__urbis;
    const p = app.renderer.tileToScreen(x, y);
    const r = app.renderer.canvas.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [x, y]);
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

async function newTown(page) {
  await page.goto('/');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 120_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
}

test('pont, bus, couches, progression, tutoriel et débogage depuis l\'interface', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newTown(page);

  // Tutoriel : la carte des objectifs est visible et compte les objectifs déjà atteints par le bourg
  await expect(page.locator('#objectives')).toBeVisible();
  await expect(page.locator('#objectives .obj-title small')).toHaveText(/\d+ \/ 13/);

  // Pont : on cherche une ligne où la rivière peut être franchie, puis on trace à la souris
  const crossing = await page.evaluate(() => {
    const s = window.__urbis.session;
    const g = s.state.grid;
    for (let y = 8; y < g.height - 8; y++) {
      let x = 0;
      while (x < g.width && g.terrain[g.idx(x, y)] !== 1) x++;
      if (x >= g.width - 3) continue;
      const from = { x: x - 2, y };
      let e = x;
      while (e < g.width && g.terrain[g.idx(e, y)] === 1) e++;
      const to = { x: e + 1, y };
      if (to.x >= g.width) continue;
      const pv = s.preview({ type: 'road', roadId: 'road_street', from, to });
      if (pv.ok && pv.tiles.some((t) => t.bridge)) {
        const cam = window.__urbis;
        cam.focus(Math.round((from.x + to.x) / 2), y);
        return { from, to };
      }
    }
    return null;
  });
  expect(crossing).not.toBeNull();
  await page.waitForTimeout(300);
  await chooseTool(page, 'Routes', 'Rue');
  await drag(page, crossing.from, crossing.to);
  const bridges = await page.evaluate(() => window.__urbis.session.state.grid.bridge.reduce((a, v) => a + (v ? 1 : 0), 0));
  expect(bridges).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/e2e-pont.png' });

  // Bus : dépôt et arrêt posés depuis la barre d'outils
  const town = await page.evaluate(() => {
    const s = window.__urbis.session;
    s.state.stats.peakPopulation = Math.max(s.state.stats.peakPopulation, 500);
    const find = (defId) => {
      for (let y = 10; y < 54; y++) for (let x = 6; x < 34; x++) if (s.preview({ type: 'building', defId, x, y }).ok) return { x, y };
      return null;
    };
    const depot = find('bus_depot');
    window.__urbis.focus(depot.x, depot.y);
    return { depot };
  });
  await page.waitForTimeout(300);
  await chooseTool(page, 'Transports et logistique', 'Dépôt de bus');
  let p = await tileToPage(page, town.depot.x, town.depot.y);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => [...window.__urbis.session.state.buildings.values()].some((b) => b.defId === 'bus_depot'))).toBe(true);
  const stop = await page.evaluate(() => {
    const s = window.__urbis.session;
    const depot = [...s.state.buildings.values()].find((b) => b.defId === 'bus_depot');
    for (let r = 3; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (s.preview({ type: 'building', defId: 'bus_stop', x: depot.x + dx, y: depot.y + dy }).ok) return { x: depot.x + dx, y: depot.y + dy };
    }
    return null;
  });
  await chooseTool(page, 'Transports et logistique', 'Arrêt de bus');
  p = await tileToPage(page, stop.x, stop.y);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__urbis.session.run(40));
  expect(await page.evaluate(() => window.__urbis.session.state.transit.stats.activeStops)).toBeGreaterThan(0);

  // Couches de données : déchets et transports en commun
  await page.getByRole('button', { name: 'Couches de données (L)' }).click();
  await page.locator('.ov-item', { hasText: 'Transports en commun' }).click();
  await expect(page.locator('.ov-toggle')).toHaveText('Transports en commun');
  await page.locator('.ov-item', { hasText: 'Déchets' }).click();
  await expect(page.locator('.ov-toggle')).toHaveText('Déchets');
  await page.locator('.ov-clear').click();

  // Tableau de bord : progression, déchets, transports
  await page.keyboard.press('c');
  await page.getByRole('tab', { name: 'Progression' }).click();
  await expect(page.locator('.era-card')).toContainText('Ville connectée');
  await expect(page.getByText('Pour atteindre l\'ère « Ville autonome »')).toBeVisible();
  await page.getByRole('tab', { name: 'Déchets' }).click();
  await expect(page.getByText('Taux de collecte')).toBeVisible();
  await page.getByRole('tab', { name: 'Transports en commun' }).click();
  await expect(page.getByText('Arrêts de bus (actifs / construits)')).toBeVisible();
  await page.keyboard.press('Escape');

  // Inspecteur : conditions d'évolution d'une maison
  const house = await page.evaluate(() => {
    const app = window.__urbis;
    const b = [...app.session.state.buildings.values()].find((x) => x.defId === 'res_low_1' && x.residents > 0);
    app.select({ buildingId: b.id });
    return b.id;
  });
  expect(house).toBeTruthy();
  await expect(page.locator('#inspector h3', { hasText: 'Prochain niveau' })).toBeVisible();
  await expect(page.locator('#inspector ul.checks li').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // Débogage : contrôle de cohérence
  await page.keyboard.press('F3');
  await expect(page.getByRole('heading', { name: 'Outils de débogage' })).toBeVisible();
  await page.getByRole('button', { name: 'Vérifier la cohérence' }).click();
  await expect(page.getByText('Aucune anomalie')).toBeVisible();
  await page.keyboard.press('Escape');

  expect(errors).toEqual([]);
});

test('aucun bouton principal n\'est décoratif', async ({ page }) => {
  await newTown(page);
  const panelTitles = {
    finance: 'Finances municipales', city: 'Tableau de bord de la ville', ai: 'IA urbaine et politiques publiques',
    saves: 'Sauvegardes', settings: 'Paramètres', help: 'Aide'
  };
  // Boutons de catégories : ouvrent un menu d'outils ou activent un outil
  const cats = await page.locator('#toolbar .toolbar-group').first().locator('.tool-btn').all();
  expect(cats.length).toBe(10);
  for (const btn of cats) {
    const name = await btn.getAttribute('aria-label');
    await btn.click();
    const effect = await page.evaluate(() => ({
      flyout: document.querySelector('.flyout.open .flyout-item') !== null,
      tool: window.__urbis.tools.tool.kind
    }));
    expect(effect.flyout || effect.tool !== 'select' || name === 'Sélectionner', name).toBe(true);
    if (effect.flyout) {
      const items = await page.locator('.flyout.open .flyout-item:not([disabled])').count();
      expect(items, name).toBeGreaterThan(0);
      await btn.click();
    }
  }
  await page.keyboard.press('Escape');
  // Boutons de panneaux : ouvrent la fenêtre correspondante (ou la liste des couches)
  for (const [id, title] of Object.entries(panelTitles)) {
    await page.locator(`.panel-btn[data-panel="${id}"]`).click();
    await expect(page.locator('#panel-host .win-title')).toHaveText(title);
    await page.locator('#panel-host .panel-close').click();
  }
  await page.locator('.panel-btn[data-panel="layers"]').click();
  await expect(page.locator('.ov-list')).toBeVisible();
  // Barre du haut : vitesses, trésorerie, habitants, plein écran
  for (const [i, label] of ['Pause', 'Normale', 'Rapide', 'Très rapide'].entries()) {
    await page.getByRole('button', { name: label, exact: true }).click();
    expect(await page.evaluate(() => window.__urbis.clock.speedIndex)).toBe(i);
  }
  await page.locator('.hud-money').click();
  await expect(page.locator('#panel-host .win-title')).toHaveText('Finances municipales');
  await page.locator('.hud-pop').click();
  await expect(page.locator('#panel-host .win-title')).toHaveText('Tableau de bord de la ville');
  await page.locator('.hud-fullscreen').click();
  await expect.poll(() => page.evaluate(() => window.__urbis.fullscreen.active)).toBe(true);
});

test('pas de duplication d\'objets graphiques ni de fuite mémoire importante', async ({ page }) => {
  await newTown(page);
  const result = await page.evaluate(async () => {
    const app = window.__urbis;
    const s = app.session;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    s.state.economy.treasury += 1e9;
    s.state.economy.opening += 1e9;
    const spots = [];
    for (let y = 2; y < 62 && spots.length < 30; y++) for (let x = 2; x < 62 && spots.length < 30; x++) {
      if (s.preview({ type: 'building', defId: 'park_small', x, y }).ok) spots.push({ x, y });
    }
    const counts = [];
    const heap0 = performance.memory?.usedJSHeapSize ?? 0;
    for (let round = 0; round < 8; round++) {
      for (const p of spots) s.execute({ type: 'building', defId: 'park_small', x: p.x, y: p.y });
      await frame();
      for (const p of spots) s.execute({ type: 'demolish', rect: { x0: p.x, y0: p.y, x1: p.x, y1: p.y } });
      await frame();
      await frame();
      counts.push({ sim: s.state.buildings.size, gfx: app.renderer.buildingGfx.size, children: app.renderer.layers.objects.children.length });
    }
    s.run(360);
    await frame();
    await frame();
    const heap1 = performance.memory?.usedJSHeapSize ?? 0;
    return { spots: spots.length, counts, final: { sim: s.state.buildings.size, gfx: app.renderer.buildingGfx.size }, heapGrowthMb: (heap1 - heap0) / 1048576 };
  });
  expect(result.spots).toBe(30);
  for (const c of result.counts) expect(c.gfx).toBe(c.sim);
  // le nombre d'objets du calque reste stable d'une série à l'autre (aucune accumulation)
  expect(new Set(result.counts.map((c) => c.children)).size).toBe(1);
  expect(result.final.gfx).toBe(result.final.sim);
  expect(result.heapGrowthMb).toBeLessThan(60);
});
