import { expect, test } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boot } from './helpers.js';

const publicIndex = fileURLToPath(new URL('../../public/index.html', import.meta.url));

test('HTTP local review loads all templates and hides the file-protocol warning', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#localProtocolWarning')).toBeHidden();
  await expect(page.locator('#templates .chip')).toHaveCount(4);
  expect(await page.evaluate(() => window.__studio.state.templates.length)).toBe(14);
});

test('file protocol displays an actionable localhost warning before the shell can be mistaken for a valid review', async ({ page }) => {
  await page.goto(pathToFileURL(publicIndex).href, { waitUntil: 'domcontentloaded' });
  const warning = page.locator('#localProtocolWarning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('npm run app');
  await expect(warning).toContainText('http://127.0.0.1:4173/');
  await expect(warning).toContainText('file://');
});
