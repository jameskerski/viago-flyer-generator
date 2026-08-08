import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const PHOTO = fileURLToPath(new URL('../fixtures/portrait.svg', import.meta.url));

test('public generator remains unauthenticated and usable inside a generic iframe', async ({ page, request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(response.headers()['x-frame-options']).toBeUndefined();
  expect(response.headers()['content-security-policy'] || '').not.toContain('frame-ancestors');
  expect((await (await request.get('/templates.json')).json()).templates).toHaveLength(14);

  await page.setContent('<iframe title="Embedded VIAGO generator" src="http://127.0.0.1:4173/" style="width:100%;height:2000px;border:0"></iframe>');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#templates .chip')).toHaveCount(4);
  await expect(frame.locator('.panel-brand')).toBeVisible();
  await frame.locator('#file').setInputFiles(PHOTO);
  await frame.locator('#nameInput').fill('Embedded Admin');
  await frame.locator('#rotation').fill('20');
  await expect(frame.locator('#rotationValue')).toHaveText('20°');
  await frame.locator('#zoom').fill('120');
  await frame.locator('body').evaluate(() => {
    const original = HTMLAnchorElement.prototype.click;
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = function captureBlob(blob) {
      window.__embeddedBlobType = blob.type;
      return createObjectURL.call(URL, blob);
    };
    HTMLAnchorElement.prototype.click = function captureDownload() {
      window.__embeddedDownload = { download: this.download, href: this.href };
      HTMLAnchorElement.prototype.click = original;
    };
  });
  await frame.getByRole('button', { name: /download/i }).click();
  const generated = await frame.locator('body').evaluate(() => ({ ...window.__embeddedDownload, type: window.__embeddedBlobType }));
  expect(generated.download).toMatch(/\.png$/); expect(generated.href).toMatch(/^blob:/); expect(generated.type).toBe('image/png');
});
