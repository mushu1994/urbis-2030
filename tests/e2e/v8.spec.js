import { test, expect } from '@playwright/test';

/** Capture facultative (vérification visuelle) : SHOT_DIR=/chemin npx playwright test v8 */
async function shot(page, name) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

/**
 * Version 0.8 : lignes de bus et de tramway tracées, panneau des lignes, fiscalité par quartier,
 * emprunts par échéances et marché régional à prix variables.
 */
test('lignes de bus et de tramway, quartiers, emprunts et marché régional', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });

  // Une rue droite du bourg : arrêts de bus, stations de tramway et dépôts le long de cette rue
  const town = await page.evaluate(() => {
    const app = window.__urbis;
    app.setSpeed(0);
    const s = app.session;
    s.execute({ type: 'debug', op: 'treasury', euros: 20_000_000 });
    s.execute({ type: 'debug', op: 'unlock', population: 50_000 });
    const g = s.state.grid;
    const ok = new Set(['road_street', 'road_avenue'].map((id) => s.catalog.road(id).code));
    let best = null;
    for (const horiz of [true, false]) {
      const outer = horiz ? g.height : g.width;
      const inner = horiz ? g.width : g.height;
      for (let a = 0; a < outer; a++) {
        let run = [];
        for (let b = 0; b <= inner; b++) {
          const i = b < inner ? (horiz ? g.idx(b, a) : g.idx(a, b)) : -1;
          if (i >= 0 && ok.has(g.road[i])) run.push(i);
          else {
            if (!best || run.length > best.length) best = run;
            run = [];
          }
        }
      }
    }
    const place = (defId, i, radius = 4) => {
      const x0 = g.xOf(i);
      const y0 = g.yOf(i);
      for (let r = 1; r <= radius; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const cmd = { type: 'building', defId, x: x0 + dx, y: y0 + dy, rot: 0 };
            if (s.preview(cmd).ok) {
              const res = s.execute(cmd);
              if (res.ok) return { id: res.building.id, x: res.building.x, y: res.building.y };
            }
          }
        }
      }
      return null;
    };
    // Emplacement libre le plus proche de la fraction f de la rue (en remontant ou en descendant la rue)
    const used = new Set();
    const along = (defId, f, radius = 3) => {
      const k0 = Math.floor(f * (best.length - 1));
      for (let d = 0; d < best.length; d++) {
        for (const k of [k0 + d, k0 - d]) {
          if (k < 0 || k >= best.length || used.has(k)) continue;
          const r = place(defId, best[k], radius);
          if (r) {
            used.add(k);
            return r;
          }
        }
      }
      return null;
    };
    const bus = [0.1, 0.5, 0.9].map((f) => along('bus_stop', f));
    const tram = [0.25, 0.75].map((f) => along('tram_stop', f));
    const busDepot = along('bus_depot', 0.4, 6);
    const tramDepot = along('tram_depot', 0.6, 6);
    return { run: best.length, bus, tram, busDepot, tramDepot };
  });
  expect(town.run).toBeGreaterThan(8);
  expect(JSON.stringify(town)).not.toContain('null');

  // Tracer une ligne de bus : outil du menu Transports, arrêts touchés dans l'ordre, puis Valider
  await page.locator('.tool-btn[aria-label="Transports et logistique"]').click();
  await page.locator('.flyout-item', { hasText: 'Tracer une ligne de bus' }).click();
  await expect(page.locator('#tool-chip')).toContainText('Touchez les arrêts');
  await page.evaluate((stops) => {
    const app = window.__urbis;
    for (const b of stops) app.tools.up({ x: b.x, y: b.y }, { moved: false });
    app.focus(stops[1].x, stops[1].y);
  }, town.bus);
  await expect(page.locator('#tool-chip .chip-validate')).toBeEnabled();
  await shot(page, 'v8-line-draft');
  await page.locator('#tool-chip .chip-validate').click();
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.lines.list.length)).toBe(1);

  // Ligne de tramway (commande) : rails posés sur la chaussée
  const tram = await page.evaluate((stops) => {
    const s = window.__urbis.session;
    const r = s.execute({ type: 'line', mode: 'tram', stops: stops.map((b) => b.id) });
    return { ok: r.ok, tracks: [...s.state.grid.tram].filter(Boolean).length };
  }, town.tram);
  expect(tram.ok).toBe(true);
  expect(tram.tracks).toBeGreaterThan(2);
  await page.evaluate(async () => {
    await window.__urbis.session.run(40);
  });

  // Panneau des lignes (K) : fréquentation, flotte, tracés affichés sur la carte
  await page.keyboard.press('Escape');
  await page.keyboard.press('k');
  await expect(page.locator('#panel-host .win-title')).toHaveText('Lignes de bus et de tramway');
  await expect(page.locator('.line-card')).toHaveCount(2);
  const before = await page.evaluate(() => window.__urbis.session.state.lines.list[0].vehicles);
  await page.locator('.line-card').first().getByRole('button', { name: 'Un véhicule de plus' }).click();
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.lines.list[0].vehicles)).toBe(before + 1);
  const stats = await page.evaluate(() => window.__urbis.session.state.lines.list.map((l) => ({ status: l.status, issue: l.stats?.issue ?? null, eff: l.stats?.effVehicles ?? 0 })));
  expect(stats.every((x) => x.status === 'ok')).toBe(true);
  expect(await page.evaluate(() => window.__urbis.renderer.showRoutes)).toBe(true);
  await shot(page, 'v8-lines-panel');
  await page.keyboard.press('Escape');

  // Finances → Quartiers : écart de taux d'un quartier
  await page.keyboard.press('b');
  await page.getByRole('tab', { name: 'Quartiers' }).click();
  await expect(page.locator('.district-cell').first()).toBeVisible();
  const slider = page.locator('.district-editor input[type="range"]').first();
  await slider.evaluate((el) => {
    el.value = '-2';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => Object.values(window.__urbis.session.state.districts.tax).some((t) => t.R === -2))).toBe(true);
  await shot(page, 'v8-districts');

  // Emprunts : profil in fine, échéancier
  await page.getByRole('tab', { name: 'Emprunts' }).click();
  await page.getByLabel('Remboursement').selectOption('bullet');
  await expect(page.locator('#panel-host')).toContainText('Intérêts seuls');
  await page.locator('#panel-host').getByRole('button', { name: 'Emprunter' }).click();
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.economy.loans.at(-1)?.type)).toBe('bullet');
  await expect(page.locator('#panel-host')).toContainText('Échéancier des 12 prochains mois');
  await shot(page, 'v8-loans');

  // Échanges régionaux : cours du marché et contrat à prix fixe
  await page.getByRole('tab', { name: 'Échanges régionaux' }).click();
  await expect(page.locator('.market-price').first()).toContainText('/ u.');
  await page.locator('.trade-card').first().locator('summary').click();
  await page.locator('.trade-card').first().getByRole('button', { name: 'Signer' }).first().click();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__urbis.session.state.market.contracts).length)).toBe(1);
  await shot(page, 'v8-market');
  await page.keyboard.press('Escape');

  // Couche « Fiscalité par quartier »
  await page.locator('.panel-btn[data-panel="layers"]').click();
  await page.locator('.ov-item', { hasText: 'Fiscalité par quartier' }).first().click();
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.overlayId)).toBe('districtTax');
  await shot(page, 'v8-district-layer');

  // Sauvegarde et rechargement : lignes, rails, quartiers et contrats conservés
  const reloaded = await page.evaluate(async () => {
    const app = window.__urbis;
    await app.host?.flush?.();
    const { serializeState, deserializeState } = await import('/src/persistence/SaveService.js');
    const st = deserializeState(JSON.parse(JSON.stringify(serializeState(app.session.state))));
    return { lines: st.lines.list.length, tram: [...st.grid.tram].filter(Boolean).length, contracts: Object.keys(st.market.contracts).length, districts: Object.keys(st.districts.tax).length };
  });
  expect(reloaded.lines).toBe(2);
  expect(reloaded.tram).toBeGreaterThan(2);
  expect(reloaded.contracts).toBe(1);
  expect(reloaded.districts).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
