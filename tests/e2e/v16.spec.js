import { test, expect } from '@playwright/test';

async function shot(page, name) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

async function startTown(page, settings = {}) {
  await page.addInitScript((s) => {
    localStorage.setItem('urbis2030.settings', JSON.stringify({ muted: true, dayNight: false, weatherFx: false, effects: false, view3d: false, simWorker: false, ...s }));
  }, settings);
  await page.goto('/');
  await page.getByLabel('Départ').selectOption('town');
  await page.getByLabel('Graine du terrain').fill('2030');
  await page.getByRole('button', { name: 'Fonder la ville' }).click();
  await page.waitForFunction(() => window.__urbis.session && document.getElementById('busy').hidden, null, { timeout: 180_000 });
  await page.evaluate(() => window.__urbis.setSpeed(0));
}

/** Version 1.6 : notifications en haut à droite, importantes permanentes, déroulé (cloche). */
test('notifications : coin supérieur droit, deux importantes au plus, déroulé des notifications', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startTown(page);
  await page.evaluate(() => {
    const n = window.__urbis.notifications;
    n.clear();
    n.push({ level: 'info', message: 'Information ordinaire' });
    n.push({ level: 'warning', message: 'Décision 1 : un adjoint attend votre réponse', panel: 'politics', tab: 'council', decision: true, action: 'Répondre' });
    n.push({ level: 'warning', message: 'Décision 2 : polémique en cours', panel: 'politics', tab: 'press', decision: true, action: 'Répondre' });
    n.push({ level: 'danger', message: 'Décision 3 : scandale', panel: 'politics', decision: true });
  });
  const box = await page.locator('#toasts').boundingBox();
  const vp = page.viewportSize();
  expect(box.y).toBeLessThan(140);
  expect(box.x + box.width).toBeGreaterThan(vp.width - 40);
  // Deux importantes au plus : la plus ancienne retourne dans le déroulé, toujours à traiter
  await expect(page.locator('.toast.important:not(.leaving)')).toHaveCount(2);
  await expect(page.locator('.toast.important', { hasText: 'Décision 1' })).toHaveCount(0);
  await expect(page.locator('.toast.important').first()).toContainText('À traiter');
  // Elles ne disparaissent pas d'elles-mêmes
  await page.waitForTimeout(1500);
  await expect(page.locator('.toast.important:not(.leaving)')).toHaveCount(2);
  await expect(page.locator('.hud-bell-badge')).toHaveClass(/pending/);
  await shot(page, 'v16-toasts');
  // Le déroulé liste tout, avec un filtre « À traiter »
  await page.locator('.hud-bell').click();
  await expect(page.locator('#notif-history')).toBeVisible();
  await expect(page.locator('#notif-history')).toContainText('Information ordinaire');
  await page.locator('.nh-tab', { hasText: 'À traiter' }).click();
  await expect(page.locator('.nh-item')).toHaveCount(3);
  await shot(page, 'v16-history');
  // « Répondre » depuis le déroulé ouvre le panneau et règle la décision
  await page.locator('.nh-item', { hasText: 'Décision 1' }).getByRole('button', { name: 'Répondre' }).click();
  await expect(page.locator('#notif-history')).toBeHidden();
  await expect(page.locator('#panel-host')).toContainText('Conseil');
  await page.keyboard.press('Escape');
  // Suivre l'action d'une notification importante la retire
  await page.locator('.toast.important', { hasText: 'Décision 2' }).getByRole('button', { name: 'Répondre' }).click();
  await expect(page.locator('.toast.important', { hasText: 'Décision 2' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const pending = await page.evaluate(() => window.__urbis.notifications.pending);
  expect(pending).toBe(1);
  expect(errors).toEqual([]);
});

/** Bourrage des urnes en campagne, dépouillement animé puis verdict. */
test('campagne : bourrage des urnes, puis soirée électorale animée', async ({ page }) => {
  test.setTimeout(500_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startTown(page);
  await page.evaluate(() => {
    const s = window.__urbis.session;
    s.execute({ type: 'debug', op: 'treasury', euros: 500000 });
    s.execute({ type: 'debug', op: 'election', months: 3 });
    s.run(31);
  });
  await page.keyboard.press('e');
  await page.locator('#panel-host').getByRole('tab', { name: 'Campagne' }).click();
  await expect(page.locator('.backroom')).toContainText('Dans les coulisses');
  await page.locator('.backroom').getByRole('button', { name: /Quelques urnes/ }).click();
  await page.getByRole('button', { name: 'Bourrer les urnes' }).click();
  await expect(page.locator('.backroom')).toContainText('préparées');
  await expect(page.locator('.vote-estimate')).toContainText('urnes');
  await shot(page, 'v16-backroom');
  await page.keyboard.press('Escape');
  // Scrutin (popularité confortable pour que la soirée se termine sans second tour, le plus souvent)
  await page.evaluate(() => {
    const s = window.__urbis.session;
    const p = s.state.politics;
    for (let k = 0; k < 140 && !p.secondRound && p.elections.length === 0; k++) {
      p.approval = 66;
      s.run(1);
    }
  });
  await expect(page.locator('.election-count')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.election-count')).toContainText('Bureaux dépouillés');
  await page.waitForTimeout(2500);
  await shot(page, 'v16-counting');
  if (await page.locator('.round-one').count()) {
    await page.locator('.round-one .btn.primary').first().click({ timeout: 60_000 });
  }
  await expect(page.locator('.election-night.revealed')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.election-night')).toContainText('Urnes bourrées');
  await shot(page, 'v16-election');
  await page.locator('.election-night .btn.primary').click();
  const e = await page.evaluate(() => window.__urbis.session.state.politics.elections.at(-1));
  expect(e.fraud.level).toBe('discreet');
  expect(errors).toEqual([]);
});

/** Sauvegardes : partager la ville (fichier), encart Google Drive. */
test('sauvegardes : partage par fichier et encart de sauvegarde en ligne', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startTown(page);
  await page.evaluate(() => window.__urbis.openPanel('saves'));
  await expect(page.locator('.cloud-box')).toContainText('Sauvegarde en ligne');
  await page.getByRole('button', { name: 'Partager la ville' }).click();
  await expect(page.locator('.share-dialog')).toContainText('Par fichier');
  await shot(page, 'v16-share');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Envoyer le fichier' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.urbis$/);
  // Le fichier reçu se rouvre dans le jeu
  const path = await file.path();
  await page.locator('.share-dialog').getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('button', { name: 'Ouvrir une partie reçue' }).click();
  await page.locator('.dialog input[type=file]').setInputFiles({ name: 'ville.urbis', mimeType: 'application/octet-stream', buffer: await import('node:fs').then((fs) => fs.readFileSync(path)) });
  await expect(page.locator('.dialog textarea')).not.toHaveValue('', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Importer' }).click();
  await page.evaluate(() => { window.__before = window.__urbis.session; });
  await page.locator('.dialog').getByRole('button', { name: 'Charger' }).click();
  await page.waitForFunction(() => window.__urbis.session && window.__urbis.session !== window.__before && document.getElementById('busy').hidden, null, { timeout: 120_000 });
  const saves = await page.evaluate(() => window.__urbis.saves.list());
  expect(saves.some((x) => /importée/.test(x.name))).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('notifications en haut, déroulé plein écran', async ({ page }) => {
    test.setTimeout(300_000);
    await startTown(page);
    await page.evaluate(() => {
      const n = window.__urbis.notifications;
      n.clear();
      n.push({ level: 'info', message: 'Sauvegarde automatique effectuée' });
      n.push({ level: 'warning', message: 'Polémique : fumées d\'usine près des habitations', panel: 'politics', tab: 'press', decision: true, action: 'Répondre' });
    });
    const box = await page.locator('#toasts').boundingBox();
    expect(box.y).toBeLessThan(150);
    await shot(page, 'v16-phone-toasts');
    await page.locator('.hud-bell').tap();
    await expect(page.locator('#notif-history')).toBeVisible();
    await shot(page, 'v16-phone-history');
  });
});
