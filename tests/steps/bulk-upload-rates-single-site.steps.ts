import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

// Selectors below were confirmed against the live accessibility tree
// (schools.qa.bwtest.net) before writing these steps — not guessed.

Given('I am on the billing at-a-glance page', async ({ page }) => {
  await page.goto('/billing/overview');
});

Given('I have opened the bulk upload rates wizard', async ({ page }) => {
  await page.getByRole('button', { name: 'Select an action' }).click();
  await page.getByRole('menuitem', { name: 'Bulk upload rates' }).click();
});

When('I open the {string} menu', async ({ page }, name: string) => {
  await page.getByRole('button', { name }).click();
});

When('I open the bulk upload rates wizard', async ({ page }) => {
  await page.getByRole('button', { name: 'Select an action' }).click();
  await page.getByRole('menuitem', { name: 'Bulk upload rates' }).click();
});

When('I click Cancel', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
});

Then('I should see the {string} menu item', async ({ page }, name: string) => {
  await expect(page.getByRole('menuitem', { name })).toBeVisible();
});

Then('I should see the wizard steps {string}, {string}, {string}', async ({ page }, step1: string, step2: string, step3: string) => {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(step1, { exact: true })).toBeVisible();
  await expect(dialog.getByText(step2, { exact: true })).toBeVisible();
  await expect(dialog.getByText(step3, { exact: true })).toBeVisible();
});

Then('I should see a file drop zone', async ({ page }) => {
  await expect(page.getByRole('dialog').getByText('Drag and drop your file here')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose a file' })).toBeVisible();
});

Then('the accepted file types should include {string} and {string}', async ({ page }, type1: string, type2: string) => {
  const acceptedTypesText = page.getByRole('dialog').getByText('Accepted files');
  await expect(acceptedTypesText).toContainText(type1);
  await expect(acceptedTypesText).toContainText(type2);
});

Then('the {string} option should be visible', async ({ page }, name: string) => {
  await expect(page.getByRole('button', { name })).toBeVisible();
});

Then('I should be back on the at-a-glance page', async ({ page }) => {
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Select an action' })).toBeVisible();
});
