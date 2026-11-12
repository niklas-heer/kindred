// The browser journeys (mise run e2e): a production Node build on a scratch data folder with the fake AI provider.
// One worker and one browser, in order: 01-first-run makes the steward and the family the other journeys use.
// Locally it drives the installed Brave and downloads nothing. KINDRED_E2E_BROWSER names another Chromium (CI does).
import { defineConfig } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const executablePath = process.env.KINDRED_E2E_BROWSER || (existsSync(BRAVE) ? BRAVE : undefined);
const port = process.env.KINDRED_E2E_PORT || '5251';
const origin = `http://localhost:${port}`;

// This file is loaded again in each worker: the folder is made once and handed on in the environment.
process.env.KINDRED_E2E_DATA ??= mkdtempSync(join(tmpdir(), 'kindred-e2e-'));
const data = process.env.KINDRED_E2E_DATA;
export const SETUP_CODE = 'E2E1-TEST-SETUP-CODE';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/e2e',
  globalTeardown: './e2e/teardown.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: origin,
    viewport: { width: 1280, height: 800 },
    locale: 'en-GB',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: { executablePath, args: ['--hide-scrollbars'] },
  },
  projects: [
    { name: 'first-run', testMatch: /01-first-run\.spec\.ts/ },
    { name: 'journeys', testIgnore: /01-first-run\.spec\.ts/, dependencies: ['first-run'], use: { storageState: join(data, 'steward.json') } },
  ],
  webServer: {
    command: 'node server/node.ts',
    url: `${origin}/api/health`,
    // Never another worker's or the owner's server: a port already in use fails the run.
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: port,
      HOST: '127.0.0.1',
      KINDRED_ORIGIN: origin,
      KINDRED_DATA_DIR: data,
      KINDRED_ACCOUNTS_DB: join(data, 'accounts.db'),
      KINDRED_AI_FAKE: '1',
      KINDRED_JOBS: 'off',
      // The journeys never ask OpenStreetMap: the address box suggests offline towns only.
      KINDRED_ADDRESS_LOOKUP: 'off',
      KINDRED_SETUP_CODE: SETUP_CODE,
      // Sign-up's Turnstile is a local stand-in (journey 32): nothing reaches Cloudflare.
      KINDRED_TURNSTILE_FAKE: '1',
      // Email is off until journey 38 sets a provider; then every email lands in mail-outbox.jsonl, none is sent.
      KINDRED_MAIL_FAKE: '1',
    },
  },
});
