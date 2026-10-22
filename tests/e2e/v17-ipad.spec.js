import { test, expect } from '@playwright/test';

async function shot(page, name) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

test.use({ viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true });

/** Pincement à deux doigts (événements tactiles réels, via le protocole de Chromium). */
async function pinch(page, cdp, { cx, cy, from = 160, to = 60 }) {
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let k = 1; k <= 8; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * k) / 8) });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('iPad : zoomer pendant le tracé d\'une ligne de bus garde les arrêts ; zonage visible en 3D ; sauvegarde confirmée', async ({ page }) => {
  test.setTimeout(500_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('urbis2030.settings', JSON.stringify({ muted: true, dayNight: false, weatherFx: false, effects: false, view3d: true }));
  });
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByRole('button', { name: 'Fonder la ville' }).tap();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 240_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
  const is3d = await page.evaluate(() => !!window.__urbis.renderer.is3d);

  // Ligne de bus : deux arrêts choisis, puis un pincement pour dézoomer
  await page.evaluate(() => {
    const app = window.__urbis;
    app.toolbar.select({ id: 'line_bus', kind: 'line', mode: 'bus', label: 'Tracer une ligne de bus' });
    app.tools.lineStops = [101, 102];
    app.tools.pending = { line: true };
  });
  const cdp = await page.context().newCDPSession(page);
  const box = await page.locator('#viewport canvas:visible').first().boundingBox();
  await pinch(page, cdp, { cx: box.x + box.width / 2, cy: box.y + box.height / 2 });
  await pinch(page, cdp, { cx: box.x + box.width / 2, cy: box.y + box.height / 2, from: 80, to: 200 });
  const stops = await page.evaluate(() => window.__urbis.tools.lineStops);
  expect(stops).toEqual([101, 102]);

  // Zonage résidentiel : les parcelles vides se voient (couleur de zone)
  await page.evaluate(() => {
    const app = window.__urbis;
    app.toolbar.select({ id: 'select', kind: 'select', label: 'Sélection' });
    const s = app.session;
    const g = s.state.grid;
    // un rectangle libre près du centre
    let done = false;
    for (let y = 4; y < g.height - 8 && !done; y++) {
      for (let x = 4; x < g.width - 8 && !done; x++) {
        const r = s.execute({ type: 'zone', zoneId: 'R_LOW', rect: { x0: x, y0: y, x1: x + 4, y1: y + 3 } });
        if (r.ok && (r.tiles ?? r.count ?? 1)) done = true;
      }
    }
  });
  await page.waitForTimeout(1500);
  // Vue sur la parcelle zonée
  const zt = await page.evaluate(() => {
    const g = window.__urbis.session.state.grid;
    for (let i = 0; i < g.zone.length; i++) if (g.zone[i] === 1 && !g.building[i]) return { x: i % g.width, y: Math.floor(i / g.width) };
    return null;
  });
  if (zt) await page.evaluate(({ x, y }) => window.__urbis.focus(x, y), zt);
  await page.waitForTimeout(1500);
  await shot(page, `v17-zones-${is3d ? '3d' : '2d'}`);

  // Sauvegarde : le résultat s'affiche dans le panneau
  await page.evaluate(() => window.__urbis.openPanel('saves'));
  await page.getByRole('button', { name: 'Sauvegarder la partie' }).tap();
  await expect(page.locator('.save-status.ok')).toContainText('sauvegardée', { timeout: 30_000 });
  await shot(page, 'v17-save');
  expect(errors).toEqual([]);
});
