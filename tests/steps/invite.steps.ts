import { createBdd } from 'playwright-bdd';

const { Given, When, Then } = createBdd();

// NOTE: locators here are placeholders. In the real pipeline, Playwright MCP
// drives the live staging app to capture the actual selectors — prefer
// role/testid locators over CSS. Swap these once MCP has explored the app.

Given('I am logged in as a school admin', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('placeholder-password');
  await page.getByRole('button', { name: 'Log in' }).click();
});

Given('I am on the parents page', async ({ page }) => {
  await page.goto('/parents');
});

Given('the invite modal is open', async ({ page }) => {
  await page.getByRole('button', { name: 'Invite parents' }).click();
});

Given('{string} has already been invited', async ({ page }, email: string) => {
  // Placeholder: seed via API/test fixture rather than UI in the real version.
  await page.request.post('/api/test/seed-invite', { data: { email } });
});

When('I click {string}', async ({ page }, label: string) => {
  await page.getByRole('button', { name: label }).click();
});

When('I enter {string} in the email field', async ({ page }, value: string) => {
  await page.getByLabel('Email address').fill(value);
});

Then('the invite modal should be visible', async ({ page }) => {
  await page.getByRole('dialog', { name: 'Invite parents' }).waitFor({ state: 'visible' });
});

Then('I should see a success toast', async ({ page }) => {
  await page.getByRole('status').filter({ hasText: 'Invite sent' }).waitFor();
});

Then('the parent should appear in the pending list', async ({ page }) => {
  await page.getByRole('row', { name: /pending/i }).waitFor();
});

Then('I should see an inline error {string}', async ({ page }, message: string) => {
  await page.getByText(message).waitFor();
});

Then('the submit button should be disabled', async ({ page }) => {
  await page.getByRole('button', { name: 'Send invite' }).isDisabled();
});

Then('I should see a warning {string}', async ({ page }, message: string) => {
  await page.getByText(message).waitFor();
});
