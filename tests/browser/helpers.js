import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

export async function boot(page, { captureText = false } = {}) {
  if (captureText) {
    await page.addInitScript(() => {
      window.__paintedText = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        window.__paintedText.push(String(text));
        return original.call(this, text, ...args);
      };
    });
  }
  await page.goto('/');
  await expect(page.locator('#statusText')).toHaveText('Ready');
  await page.waitForFunction(() => window.__studio?.state?.templates?.length === 14);
}

export async function upload(page, name = 'portrait.svg') {
  await page.locator('#file').setInputFiles(fixture(name));
  await expect(page.locator('#photoTools')).toBeVisible();
  await expect(page.locator('#clearPhoto')).toBeVisible();
  await expect(page.locator('#statusText')).toHaveText('Ready');
}

export async function selectCategory(page, category) {
  await page.locator('#cats').getByRole('button', { name: category, exact: true }).click();
}

export async function selectTemplate(page, label) {
  await page.locator('#templates').getByRole('button', { name: label, exact: true }).click();
}

export async function waitForFlyerFont(page) {
  await page.waitForFunction(async () => {
    await document.fonts.load('700 100px "Josefin Sans"');
    await document.fonts.ready;
    return document.fonts.check('700 100px "Josefin Sans"');
  }, null, { timeout: 20_000 });
}

export async function canvasDigest(page) {
  return page.locator('#flyer').evaluate(async (canvas) => {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  });
}

export function pngDimensions(buffer) {
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export async function downloadedPng(download) {
  const path = await download.path();
  return readFile(path);
}
