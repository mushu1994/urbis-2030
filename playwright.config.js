import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1100, height: 720 },
    actionTimeout: 60_000,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }
  },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000
  }
});
