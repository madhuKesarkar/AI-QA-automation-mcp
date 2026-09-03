import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

// Config for AGENT-GENERATED ticket plans only (project-envs/<TICKET>/*.feature,
// written by the test-planner and approved by PR merge). The curated suite in
// tests/features/ has its own playwright.config.ts.
//
// Why two configs instead of two projects in one config: bddgen fails as a unit.
// A generated plan whose step definitions don't exist yet makes bddgen exit 1,
// and if the curated suite shared that invocation it would go red too — turning
// CI red on PRs that have nothing to do with the generated plan. Separate
// configs mean separate bddgen runs, so the blast radius of a bad plan is
// itself.
//
// Step definitions are shared with the curated suite on purpose: glue code is
// reusable, and the step-generator agent writes into the same tests/steps/.
// GENERATED_FEATURES narrows the glob to a single ticket's feature. The agent
// sets it so that one ticket's unglued plan cannot make bddgen exit 1 for a
// different ticket's run — same blast-radius reasoning as splitting the config,
// one level down. Unset (e.g. running the generated suite by hand) means all of
// them.
const testDir = defineBddConfig({
  features: process.env.GENERATED_FEATURES || 'project-envs/**/*.feature',
  steps: 'tests/steps/**/*.ts',
  outputDir: '.features-gen-generated',
});

export default defineConfig({
  testDir,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report-generated' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://schools.sandbox.bwtest.net',
    // Session captured once by a human via `node agent/dist/captureSession.js`.
    // Without it every scenario starts logged out, and generated plans assume
    // an authenticated billing dashboard.
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
