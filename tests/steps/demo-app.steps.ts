import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

const { Given, When, Then } = createBdd();

Given('I am on the login screen', async ({ page }) => {
  await page.goto('/');
});

Given('I am logged in', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('email-input').fill('user@example.com');
  await page.getByTestId('password-input').fill('password123');
  await page.getByTestId('login-button').click();
});

Given('I have added a todo {string}', async ({ page }, text: string) => {
  await page.getByTestId('todo-input').fill(text);
  await page.getByTestId('add-todo-button').click();
});

When('I log in with {string} and {string}', async ({ page }, email: string, password: string) => {
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('login-button').click();
});

When('I add a todo {string}', async ({ page }, text: string) => {
  await page.getByTestId('todo-input').fill(text);
  await page.getByTestId('add-todo-button').click();
});

When('I click the todo {string}', async ({ page }, text: string) => {
  await page.getByTestId('todo-item').filter({ hasText: text }).click();
});

Then('the login button should be visible', async ({ page }) => {
  await expect(page.getByTestId('login-button')).toBeVisible();
});

Then('I should see the todo app screen', async ({ page }) => {
  await expect(page.getByTestId('todo-input')).toBeVisible();
});

Then('I should see the login error {string}', async ({ page }, message: string) => {
  await expect(page.getByTestId('login-error')).toHaveText(message);
});

Then('I should see the add-todo error {string}', async ({ page }, message: string) => {
  await expect(page.getByTestId('add-todo-error')).toHaveText(message);
});

Then('{string} should appear in the todo list', async ({ page }, text: string) => {
  await expect(page.getByTestId('todo-item').filter({ hasText: text })).toBeVisible();
});

Then('I should see a success toast for the todo', async ({ page }) => {
  await expect(page.getByTestId('toast-success')).toBeVisible();
});

Then('the todo {string} should be marked done', async ({ page }, text: string) => {
  await expect(page.getByTestId('todo-item').filter({ hasText: text })).toHaveClass(/done/);
});
