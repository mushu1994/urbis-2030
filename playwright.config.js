import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1100, height: 720 },
    actionTimeout: 60_000,
    // PW_CHROMIUM : chemin d'un Chromium déjà installé (sinon `npx playwright install chromium`)
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'], ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) },
    // Rendu logiciel sans GPU : son coupé et effets décoratifs désactivés pour que les parcours restent rapides
    // (ils testent l'interface et les règles ; les effets ont leurs propres vérifications).
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5173',
          localStorage: [{ name: 'urbis2030.settings', value: JSON.stringify({ muted: true, dayNight: false, weatherFx: false, effects: false }) }]
        }
      ]
    }
  },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000
  }
});
