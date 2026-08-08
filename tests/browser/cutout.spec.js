import { expect, test } from '@playwright/test';
import { boot, upload } from './helpers.js';

const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X1jPAAAAAElFTkSuQmCC', 'base64');

test('mocked server cutout success uses returned PNG without external calls', async ({ page }) => {
  await page.route('**/api/cutout', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
  await boot(page);
  await upload(page);
  await page.locator('label.toggle').click();
  await expect(page.locator('#note')).toHaveText('Background removed.');
  await expect(page.locator('#cutout')).toBeChecked();
  expect(await page.evaluate(() => window.__studio.state.cutoutOn)).toBe(true);
});

test('mocked server failure initiates deterministic browser fallback', async ({ page }) => {
  await page.route('**/api/cutout', (route) => route.fulfill({ status: 502, contentType: 'text/plain', body: 'provider unavailable' }));
  await page.route('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.6.0/+esm', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: 'export async function removeBackground(blob, options) { options?.progress?.("compute", 1, 1); return blob; }'
  }));
  await boot(page);
  await upload(page);
  await page.locator('label.toggle').click();
  await expect(page.locator('#note')).toHaveText('Background removed on this device.');
  await expect(page.locator('#cutout')).toBeChecked();
});

test('mocked total cutout failure restores original and disables toggle', async ({ page }) => {
  await page.route('**/api/cutout', (route) => route.fulfill({ status: 502, contentType: 'text/plain', body: 'provider unavailable' }));
  await page.route('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.6.0/+esm', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: 'export async function removeBackground() { throw new Error("synthetic local failure"); }'
  }));
  await boot(page);
  await upload(page);
  await page.locator('label.toggle').click();
  await expect(page.locator('#note')).toHaveText('Could not remove the background, so the photo went in as it was.');
  await expect(page.locator('#cutout')).not.toBeChecked();
  expect(await page.evaluate(() => ({ cutoutOn: window.__studio.state.cutoutOn, hasPhoto: Boolean(window.__studio.state.photo), hasOriginal: Boolean(window.__studio.state.original) }))).toEqual({
    cutoutOn: false,
    hasPhoto: true,
    hasOriginal: true
  });
});
