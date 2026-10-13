import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const baseURL = process.env.TC_UI_BASE_URL ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', fullyParallel: true, workers: 2, timeout: 30_000,
  reporter: 'list', outputDir: '../test-results',
  use: {
    baseURL, headless: true, viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath }, screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    url: baseURL, reuseExistingServer: true, timeout: 30_000,
  },
});
