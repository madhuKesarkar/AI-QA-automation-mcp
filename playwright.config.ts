import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

// playwright-bdd reads .feature files and generates real Playwright test
// files under .features-gen (gitignored). You run `npx bddgen` before
// `playwright test`, or use the combined `npm test` script below.
const testDir = defineBddConfig({
  features: 'tests/features/**/*.feature',
  steps: 'tests/steps/**/*.ts',
});

export default defineConfig({
  testDir,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://schools.sandbox.bwtest.net',
    // Reuses a session captured once via `npx playwright codegen
    // --save-storage=storageState.json <url>` (log in manually, close the
    // browser). Without this, every test starts logged out — and since
    // our feature files assume you're already on the billing dashboard
    // (no login steps), tests will fail at the first step without it.
    storageState: process.env.STORAGE_STATE || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});