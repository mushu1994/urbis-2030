import { test, expect } from '@playwright/test';

/**
 * v1.5 — vue 3D (Three.js) branchée sur la vraie partie : bascule 2D/3D, outils, sélection, crises mises en scène,
 * lecture seule (la vue ne modifie jamais la partie) et gestes tactiles.
 * Les autres parcours restent en 2D (réglage view3d: false dans playwright.config.js).
 */
const SETTINGS = { muted: true, dayNight: false, weatherFx: false, effects: true, view3d: true, pauseOnCrisis: false };
test.use({ storageState: { cookies: [], origins: [{ origin: 'http://localhost:5173', localStorage: [{ name: 'urbis2030.settings', value: JSON.stringify(SETTINGS) }] }] } });

async function shot(page, name) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

async function startTown(page, errors) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 240_000 });
  await page.evaluate(() => {
    const app = window.__urbis;
    app.setSpeed(0);
    app.notifications.clear();
    app.session.execute({ type: 'debug', op: 'treasury', euros: 2_000_000 });
  });
  // la scène est entièrement construite
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.debugInfo?.().chunksDirty), { timeout: 60_000 }).toBe(0);
}

async function tileToPage(page, x, y) {
  return page.evaluate(([x, y]) => {
    const r = window.__urbis.renderer;
    const p = r.tileToScreen(x, y);
    const b = r.canvas.getBoundingClientRect();
    return { x: b.left + p.x, y: b.top + p.y };
  }, [x, y]);
}

/** Empreinte de l'état de la partie (cases, bâtiments, économie, crises, délinquance, générateur). */
function fingerprint(page) {
  return page.evaluate(() => {
    const s = window.__urbis.session.state;
    const g = s.grid;
    let h = 0;
    for (const k of ['terrain', 'altitude', 'zone', 'road', 'building', 'rail', 'bridge', 'traffic', 'congestion', 'garbage']) {
      const a = g[k];
      for (let i = 0; i < a.length; i++) h = (h * 31 + Math.round((a[i] || 0) * 1000)) | 0;
    }
    return JSON.stringify({ h, tick: s.time.tick, rng: s.rng.state, treasury: s.economy.treasury, ledger: s.economy.ledger.length, buildings: [...s.buildings.values()], crises: s.crises, crime: s.crime, weather: s.weather });
  });
}

test('vue 3D : démarrage, bascule 2D/3D et réglage persistant', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = [];
  await startTown(page, errors);
  const info = await page.evaluate(() => {
    const app = window.__urbis;
    const d = app.renderer.debugInfo();
    return { use3d: app.use3d, is3d: !!app.renderer.is3d, buildings: d.buildings, state: app.session.state.buildings.size, vehicles: d.vehicles, c2d: getComputedStyle(app.renderer2d.canvas).display, c3d: getComputedStyle(app.renderer3d.canvas).display };
  });
  expect(info.use3d).toBe(true);
  expect(info.is3d).toBe(true);
  expect(info.buildings).toBe(info.state);
  expect(info.vehicles).toBeGreaterThan(0);
  expect(info.c2d).toBe('none');
  expect(info.c3d).toBe('block');
  // la surface de l'eau est tournée vers le ciel (sinon elle est invisible, éliminée comme face arrière)
  const water = await page.evaluate(() => {
    const r = window.__urbis.renderer;
    let up = 0;
    let down = 0;
    r.scene.traverse((o) => {
      if (o.material !== r.world.waterMat) return;
      const p = o.geometry.attributes.position.array;
      for (let k = 0; k < p.length; k += 9) {
        const ax = p[k + 3] - p[k];
        const az = p[k + 5] - p[k + 2];
        const bx = p[k + 6] - p[k];
        const bz = p[k + 8] - p[k + 2];
        if (az * bx - ax * bz > 0) up++;
        else down++;
      }
    });
    return { up, down };
  });
  expect(water.down).toBe(0);
  expect(water.up).toBeGreaterThan(0);
  await shot(page, 'v15-3d-start');

  const center = () => page.evaluate(() => {
    const r = window.__urbis.renderer;
    return r.tileAtScreen(r.view.width / 2, r.view.height / 2);
  });
  const c3 = await center();
  // vers la 2D : la même case reste au centre, l'outil et la sélection sont conservés
  await page.locator('.nav-3d').click();
  await expect.poll(() => page.evaluate(() => window.__urbis.use3d)).toBe(false);
  const c2 = await center();
  expect(Math.abs(c2.x - c3.x) + Math.abs(c2.y - c3.y)).toBeLessThanOrEqual(3);
  expect(await page.evaluate(() => getComputedStyle(window.__urbis.renderer3d.canvas).display)).toBe('none');
  await shot(page, 'v15-3d-to-2d');
  await page.locator('.nav-3d').click();
  await expect.poll(() => page.evaluate(() => window.__urbis.use3d)).toBe(true);
  const c3b = await center();
  expect(Math.abs(c3b.x - c2.x) + Math.abs(c3b.y - c2.y)).toBeLessThanOrEqual(3);

  // rotation par quarts de tour et boussole, vue de dessus
  await page.keyboard.press(';');
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode.rot)).toBe(1);
  await page.locator('.nav-compass').click();
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode.rot)).toBe(0);
  await page.keyboard.press('v');
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode.top)).toBe(true);
  await page.keyboard.press('v');
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.viewMode.top)).toBe(false);

  // le choix est mémorisé : désactivée dans les paramètres, la 3D ne revient pas au rechargement
  await page.evaluate(() => {
    const app = window.__urbis;
    app.settings.set('view3d', false);
    app.applySettings();
  });
  await expect.poll(() => page.evaluate(() => window.__urbis.use3d)).toBe(false);
  await page.reload();
  await page.waitForFunction(() => window.__urbis && document.getElementById('menu'), null, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__urbis.use3d)).toBe(false);
  expect(errors).toEqual([]);
});

test('vue 3D : outils de construction, sélection, démolition et annulation', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = [];
  await startTown(page, errors);
  // une route tracée à la souris là où l'on glisse (pointage sur le relief)
  const plan = await page.evaluate(() => {
    const app = window.__urbis;
    const s = app.session;
    const r = app.renderer;
    const c = r.tileAtScreen(r.view.width / 2, r.view.height / 2);
    for (let rad = 0; rad < 20; rad++) {
      for (let y = c.y - rad; y <= c.y + rad; y++) {
        for (let x = c.x - rad; x <= c.x + rad; x++) {
          const pv = s.preview({ type: 'road', roadId: 'road_street', from: { x, y }, to: { x: x + 4, y } });
          if (pv.ok && (pv.tiles ?? []).length === 5 && pv.tiles.every((t) => t.status !== 'same')) return { x, y };
        }
      }
    }
    return null;
  });
  expect(plan).toBeTruthy();
  await page.evaluate(() => window.__urbis.toolbar.selectById('road:road_street'));
  const a = await tileToPage(page, plan.x, plan.y);
  const b = await tileToPage(page, plan.x + 4, plan.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate((p) => {
    const g = window.__urbis.session.state.grid;
    return [0, 1, 2, 3, 4].every((k) => g.road[g.idx(p.x + k, p.y)] > 0);
  }, plan)).toBe(true);
  // le miroir 3D a pris la route en compte
  await expect.poll(() => page.evaluate((p) => window.__urbis.renderer.map.road[window.__urbis.renderer.map.idx(p.x + 2, p.y)], plan)).toBeGreaterThan(0);

  // pose d'un poste de police : fantôme 3D pendant le survol, puis construction au clic
  const spot = await page.evaluate(() => {
    const app = window.__urbis;
    const s = app.session;
    const r = app.renderer;
    const c = r.tileAtScreen(r.view.width / 2, r.view.height / 2);
    for (let rad = 0; rad < 25; rad++) {
      for (let y = c.y - rad; y <= c.y + rad; y++) for (let x = c.x - rad; x <= c.x + rad; x++) if (s.preview({ type: 'building', defId: 'police_post', x, y, rot: 0 }).ok) return { x, y };
    }
    return null;
  });
  expect(spot).toBeTruthy();
  await page.evaluate(() => window.__urbis.toolbar.selectById('building:police_post'));
  const p = await tileToPage(page, spot.x, spot.y);
  await page.mouse.move(p.x - 30, p.y, { steps: 2 });
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.ghostKey)).toContain('police_post');
  await shot(page, 'v15-3d-ghost');
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate((sp) => {
    const s = window.__urbis.session.state;
    return s.buildings.get(s.grid.building[s.grid.idx(sp.x, sp.y)])?.defId;
  }, spot)).toBe('police_post');
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.debugInfo().buildings === window.__urbis.session.state.buildings.size)).toBe(true);

  // sélection au clic : le bâtiment visé (premier touché par le rayon) s'ouvre dans l'inspecteur
  await page.evaluate(() => window.__urbis.toolbar.selectById('select'));
  const target = await page.evaluate(() => {
    const r = window.__urbis.renderer;
    const s = window.__urbis.session.state;
    for (const pk of r.world.picks) {
      const b = s.buildings.get(pk.b.id);
      if (!b) continue;
      const c = { x: (pk.box.min.x + pk.box.max.x) / 2, y: pk.box.max.y * 0.6, z: (pk.box.min.z + pk.box.max.z) / 2 };
      const sp = r.tileToScreen(c.x - 0.5, c.z - 0.5);
      if (sp.x < 120 || sp.y < 120 || sp.x > r.view.width - 120 || sp.y > r.view.height - 120) continue;
      const id = r.buildingAtScreen(sp.x, sp.y);
      if (id) return { id, sp };
    }
    return null;
  });
  expect(target).toBeTruthy();
  const box = await page.evaluate(() => window.__urbis.renderer.canvas.getBoundingClientRect().toJSON());
  await page.mouse.click(box.x + target.sp.x, box.y + target.sp.y);
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.selectedId)).toBe(target.id);
  await expect(page.locator('#inspector .insp-head')).toBeVisible();
  await shot(page, 'v15-3d-select');

  // démolition depuis l'inspecteur, puis annulation : le miroir suit
  const count = await page.evaluate(() => window.__urbis.session.state.buildings.size);
  // (la promesse attend la boîte de confirmation : on ne l'attend pas ici)
  await page.evaluate((id) => {
    window.__urbis.demolishBuilding(window.__urbis.session.state.buildings.get(id));
  }, target.id);
  const confirm = page.locator('.dialog-backdrop button', { hasText: 'Démolir' });
  if (await confirm.count()) await confirm.first().click();
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.buildings.size)).toBe(count - 1);
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.debugInfo().buildings)).toBe(count - 1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.buildings.size)).toBe(count);
  await expect.poll(() => page.evaluate(() => window.__urbis.renderer.debugInfo().buildings)).toBe(count);
  expect(errors).toEqual([]);
});

test('vue 3D : la vue ne modifie jamais la partie (lecture seule)', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = [];
  await startTown(page, errors);
  await page.evaluate(() => window.__urbis.session.execute({ type: 'triggerDisaster', kind: 'fire' }));
  await page.evaluate(() => window.__urbis.setSpeed(0));
  await page.waitForTimeout(500);
  const before = await fingerprint(page);
  // caméra, couches, survol des outils, transparence, bascules : rien ne doit toucher l'état
  await page.evaluate(async () => {
    const app = window.__urbis;
    const r = app.renderer;
    r.camera.zoomAt(1.8, 400, 300);
    r.camera.orbit(120, -40);
    r.camera.pan(80, -60);
    app.overlays.set('pollution');
    await new Promise((res) => setTimeout(res, 600));
    app.overlays.set('transit');
    await new Promise((res) => setTimeout(res, 600));
    app.overlays.set(null);
    app.toolbar.selectById('building:police');
    for (let k = 0; k < 10; k++) app.tools.hover(r.tileAtScreen(300 + k * 30, 300), { shift: false });
    app.toolbar.selectById('select');
    app.rotateView(1);
    app.toggleTopView();
  });
  await page.waitForTimeout(4000);
  expect(await fingerprint(page)).toBe(before);
  // et la simulation repart normalement
  const t0 = await page.evaluate(() => window.__urbis.session.state.time.tick);
  await page.evaluate(() => window.__urbis.setSpeed(3));
  await expect.poll(() => page.evaluate(() => window.__urbis.session.state.time.tick), { timeout: 60_000 }).toBeGreaterThan(t0 + 3);
  expect(errors).toEqual([]);
});

test('vue 3D : crises, délinquance et inondation mises en scène', async ({ page }) => {
  test.setTimeout(500_000);
  const errors = [];
  await startTown(page, errors);
  const fx = () => page.evaluate(() => window.__urbis.renderer.debugInfo());
  // incendie : foyer et camion de pompiers envoyé depuis la caserne
  await page.evaluate(() => {
    const app = window.__urbis;
    app.session.execute({ type: 'triggerDisaster', kind: 'fire' });
    const c = app.session.state.crises.active.find((x) => x.kind === 'fire');
    app.renderer.lookAt(c.x, c.y);
    app.setSpeed(1);
  });
  await expect.poll(async () => (await fx()).fx.includes('fire'), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await fx()).emergency.some((v) => v.startsWith('firetruck')), { timeout: 30_000 }).toBe(true);
  await shot(page, 'v15-3d-fire');

  // manifestation : cortège sur la chaussée
  await page.evaluate(() => window.__urbis.session.execute({ type: 'triggerDisaster', kind: 'protest' }));
  await expect.poll(async () => (await fx()).fx.includes('protest'), { timeout: 30_000 }).toBe(true);

  // cambriolage ou braquage décidé par la simulation (CrimeSystem) : on avance jour après jour jusqu'à un incident,
  // que la scène met aussitôt en scène (alarme, malfaiteurs, police dépêchée)
  const inc = await page.evaluate(async () => {
    const app = window.__urbis;
    app.setSpeed(0);
    const s = app.session;
    const seen = (s.state.crime?.incidents ?? []).length;
    for (let k = 0; k < 1500; k++) {
      await s.run(1);
      const list = s.state.crime?.incidents ?? [];
      if (list.length > seen) {
        const f = list.at(-1);
        app.renderer.lookAt(f.x, f.y);
        return { ...f, days: k + 1 };
      }
    }
    return null;
  });
  expect(inc).toBeTruthy();
  expect(['burglary', 'robbery']).toContain(inc.kind);
  await expect.poll(async () => (await fx()).fx.some((t) => t === 'burglary' || t === 'robbery'), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => window.__urbis.setSpeed(1));
  await expect.poll(async () => (await fx()).emergency.some((v) => v.startsWith('police')), { timeout: 60_000 }).toBe(true);
  await shot(page, 'v15-3d-crime');

  // inondation : une rue au bord de l'eau, puis la crue (eau boueuse, bâtiments sinistrés)
  const flood = await page.evaluate(() => {
    const app = window.__urbis;
    const s = app.session;
    const g = s.state.grid;
    for (let i = 0; i < g.size; i++) {
      if (g.terrain[i] !== 1) continue;
      const x = g.xOf(i);
      const y = g.yOf(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ax = x + dx * 2;
        const ay = y + dy * 2;
        if (!g.inBounds(ax, ay) || !g.inBounds(ax + dy * 4, ay + dx * 4)) continue;
        const r = s.execute({ type: 'road', roadId: 'road_street', from: { x: ax, y: ay }, to: { x: ax + dy * 4, y: ay + dx * 4 } });
        if (!r.ok) continue;
        const f = s.execute({ type: 'triggerDisaster', kind: 'flood' });
        if (f.ok) return { x: f.crisis.x, y: f.crisis.y, tiles: f.crisis.tiles.length };
      }
    }
    return null;
  });
  if (flood) {
    await page.evaluate((f) => {
      window.__urbis.renderer.lookAt(f.x, f.y);
      window.__urbis.setSpeed(1);
    }, flood);
    await expect.poll(async () => (await fx()).flood?.mesh === true, { timeout: 30_000 }).toBe(true);
    await shot(page, 'v15-3d-flood');
  }
  expect(errors).toEqual([]);
});

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('vue 3D au doigt : glisser, pincer, tourner, incliner, double appui', async ({ page }) => {
    test.setTimeout(400_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.getByLabel('Départ').selectOption('town');
    await page.getByRole('button', { name: 'Fonder la ville' }).tap();
    await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 240_000 });
    await page.evaluate(() => window.__urbis.setSpeed(0));
    expect(await page.evaluate(() => window.__urbis.use3d)).toBe(true);
    // la navigation tient à l'écran
    const nav = await page.locator('#nav-widget').boundingBox();
    expect(nav.x).toBeGreaterThanOrEqual(0);
    expect(nav.x + nav.width).toBeLessThanOrEqual(390);
    await expect(page.locator('.nav-3d')).toBeVisible();

    const run = (steps) => page.evaluate((steps) => {
      const app = window.__urbis;
      const c = app.renderer.canvas;
      const r = c.getBoundingClientRect();
      const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: id === 1 }));
      for (const [type, id, x, y] of steps) ev(type, id, x, y);
      return { ...app.renderer.camera.cam };
    }, steps);
    const cam0 = await page.evaluate(() => ({ ...window.__urbis.renderer.camera.cam }));
    // un doigt : la carte suit le doigt
    const drag = [['pointerdown', 1, 200, 420]];
    for (let k = 1; k <= 8; k++) drag.push(['pointermove', 1, 200 - k * 12, 420 + k * 6]);
    drag.push(['pointerup', 1, 104, 468]);
    const cam1 = await run(drag);
    expect(Math.hypot(cam1.tx - cam0.tx, cam1.tz - cam0.tz)).toBeGreaterThan(0.5);
    // deux doigts écartés : zoom avant
    const pinch = [['pointerdown', 1, 150, 420], ['pointerdown', 2, 240, 420]];
    for (let k = 1; k <= 10; k++) pinch.push(['pointermove', 1, 150 - k * 6, 420], ['pointermove', 2, 240 + k * 6, 420]);
    pinch.push(['pointerup', 1, 90, 420], ['pointerup', 2, 300, 420]);
    const cam2 = await run(pinch);
    expect(cam2.d).toBeLessThan(cam1.d * 0.8);
    // torsion à deux doigts : la vue tourne librement
    const twist = [['pointerdown', 1, 150, 420], ['pointerdown', 2, 250, 420]];
    for (let k = 1; k <= 10; k++) {
      const a = (k / 10) * 0.8;
      twist.push(['pointermove', 1, 200 - 50 * Math.cos(a), 420 - 50 * Math.sin(a)], ['pointermove', 2, 200 + 50 * Math.cos(a), 420 + 50 * Math.sin(a)]);
    }
    twist.push(['pointerup', 1, 165, 384], ['pointerup', 2, 235, 456]);
    const cam3 = await run(twist);
    expect(Math.abs(cam3.az - cam2.az)).toBeGreaterThan(0.4);
    // deux doigts glissés vers le haut ensemble : inclinaison
    const tilt = [['pointerdown', 1, 150, 500], ['pointerdown', 2, 250, 500]];
    for (let k = 1; k <= 10; k++) tilt.push(['pointermove', 1, 150, 500 - k * 12], ['pointermove', 2, 250, 500 - k * 12]);
    tilt.push(['pointerup', 1, 150, 380], ['pointerup', 2, 250, 380]);
    const cam4 = await run(tilt);
    expect(Math.abs(cam4.el - cam3.el)).toBeGreaterThan(0.2);
    // double appui : zoom vers le point touché
    await run([['pointerdown', 1, 200, 400], ['pointerup', 1, 200, 400], ['pointerdown', 1, 202, 401], ['pointerup', 1, 202, 401]]);
    await expect.poll(() => page.evaluate(() => window.__urbis.renderer.camera.cam.d)).toBeLessThan(cam4.d * 0.75);
    await shot(page, 'v15-3d-phone');
    expect(errors).toEqual([]);
  });
});
