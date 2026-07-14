#!/usr/bin/env node
// Run this directly with Node (not inside the Docker sandbox — it needs
// a visible browser window for a human to log in through).
//
//   node agent/src/captureSession.ts --env=sandbox
//   node agent/src/captureSession.ts --env=qa
//
// This opens a real, headed browser. Log in manually, then press Enter
// in the terminal. The session (cookies/localStorage) gets saved to
// agent/storageState.<env>.json, which the headless runner stage then
// reuses for every subsequent ticket — this is the one unavoidable
// human-in-the-loop step for a brand-new environment/account, same as
// noted in the design: headless agents can't complete an interactive
// login (2FA, SSO, etc.) on their own, and guessing around it would
// undermine the whole "don't fake verification" principle this tool
// exists to uphold.

import { chromium } from '@playwright/test';
import { createInterface } from 'node:readline/promises';

const envArg = process.argv.find((a) => a.startsWith('--env='));
const env = envArg?.split('=')[1];
if (env !== 'sandbox' && env !== 'qa') {
  console.error('Usage: node agent/src/captureSession.ts --env=sandbox|qa');
  process.exit(2);
}

const urls: Record<string, string> = {
  sandbox: process.env.SANDBOX_URL ?? 'https://schools.sandbox.bwtest.net',
  qa: process.env.QA_URL ?? 'https://schools.qa.bwtest.net',
};

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(urls[env as string]);

  console.log(`\nLog in manually in the browser window that just opened (${urls[env as string]}).`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('Once logged in and you can see the billing dashboard, press Enter here...');
  rl.close();

  const outPath = `./agent/storageState.${env}.json`;
  await context.storageState({ path: outPath });
  console.log(`Saved session to ${outPath}`);

  await browser.close();
}

main();
