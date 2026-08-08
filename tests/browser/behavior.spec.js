import { expect, test } from '@playwright/test';
import {
  boot,
  canvasDigest,
  downloadedPng,
  fixture,
  pngDimensions,
  selectCategory,
  selectTemplate,
  upload
} from './helpers.js';

const expected = {
  General: ['club-4', 'mission-30', 'amplified', 'welcome'],
  Ranks: ['silver', 'gold', 'sapphire', 'emerald', 'elite-emerald'],
  Events: ['jacksonville-im', 'jacksonville-we', 'cyprus-im', 'cyprus-we', 'kenya']
};

test('boot and category/template order are the accepted Version 1 order', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#cats .cat')).toHaveText(['General', 'Ranks', 'Events']);
  await expect(page.locator('#cats .cat.is-on')).toHaveText('General');
  await expect(page.locator('#templates .chip.is-on')).toContainText('Club 4');
  expect(await page.evaluate(() => window.__studio.state.templates.map(({ id, category }) => ({ id, category })))).toEqual(
    Object.entries(expected).flatMap(([category, ids]) => ids.map((id) => ({ id, category })))
  );

  await selectCategory(page, 'Ranks');
  await expect(page.locator('#templates .chip.is-on')).toContainText('Silver');
  expect(await page.evaluate(() => window.__studio.state.templateId)).toBe('silver');
  await selectCategory(page, 'Events');
  await expect(page.locator('#templates .chip.is-on')).toContainText('Jacksonville (Individual)');
  expect(await page.evaluate(() => window.__studio.state.templateId)).toBe('jacksonville-im');
});

test('typed name and uploaded photo survive selection while placement resets', async ({ page }) => {
  await boot(page);
  await page.locator('#nameInput').fill('Casey Rivera');
  await upload(page, 'portrait.svg');
  await page.locator('#zoom').fill('225');
  await page.locator('#zoom').dispatchEvent('input');
  expect(await page.evaluate(() => window.__studio.state.place.zoom)).toBe(2.25);

  await selectTemplate(page, 'Mission 30');
  expect(await page.evaluate(() => ({ name: window.__studio.state.name, hasPhoto: Boolean(window.__studio.state.photo), place: window.__studio.state.place }))).toEqual({
    name: 'Casey Rivera',
    hasPhoto: true,
    place: { dx: 0, dy: 0, zoom: 1, rotation: 0 }
  });
  await expect(page.locator('#zoom')).toHaveValue('100');
});

test('name rendering preserves empty, uppercase, wrapping, and single-line behavior', async ({ page }) => {
  await boot(page, { captureText: true });
  const empty = await canvasDigest(page);
  await page.evaluate(() => { window.__paintedText = []; });
  await page.locator('#nameInput').fill('Avery Stone');
  await page.waitForTimeout(50);
  expect(await canvasDigest(page)).not.toBe(empty);
  expect(await page.evaluate(() => window.__paintedText.at(-1))).toBe('AVERY STONE');

  await selectCategory(page, 'Ranks');
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__paintedText = []; });
  await page.locator('#nameInput').fill('Alexandria Montgomery Rivera');
  await page.waitForTimeout(50);
  const rankLines = await page.evaluate(() => window.__paintedText.slice());
  expect(rankLines.length).toBeGreaterThanOrEqual(2);
  expect(rankLines.join(' ')).toContain('ALEXANDRIA');

  await selectCategory(page, 'Events');
  // Let Version 1's un-ordered asynchronous render queue settle before
  // isolating this template's paint calls. A clean full-suite run reproduced
  // the documented race by delivering the prior Rank paint after selection.
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__paintedText = []; });
  await page.locator('#nameInput').fill('Kai Lee');
  await page.waitForTimeout(50);
  expect([...new Set(await page.evaluate(() => window.__paintedText.slice()))]).toEqual(['KAI LEE']);
});

test('upload, replacement, and clear follow the current lifecycle', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#photoTools')).toBeHidden();
  await expect(page.locator('#clearPhoto')).toBeHidden();
  await upload(page, 'portrait.svg');
  const firstSize = await page.evaluate(() => window.__studio.state.original.size);
  await page.locator('#file').setInputFiles(fixture('landscape.svg'));
  await expect(page.locator('#statusText')).toHaveText('Ready');
  const secondSize = await page.evaluate(() => window.__studio.state.original.size);
  expect(secondSize).not.toBe(firstSize);
  await page.locator('#clearPhoto').click();
  await expect(page.locator('#photoTools')).toBeHidden();
  await expect(page.locator('#clearPhoto')).toBeHidden();
  await expect(page.locator('#fileBtnText')).toHaveText('Choose photo');
  expect(await page.evaluate(() => ({ photo: window.__studio.state.photo, original: window.__studio.state.original }))).toEqual({ photo: null, original: null });
});

test('drag and zoom use current bounds and reproduce over-drag coverage defect', async ({ page }) => {
  await boot(page);
  await upload(page, 'landscape.svg');
  const canvas = page.locator('#flyer');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 2, box.y + box.height / 2);
  await page.mouse.up();
  const evidence = await page.evaluate(() => {
    const t = window.__studio.state.templates.find((item) => item.id === window.__studio.state.templateId);
    const img = window.__studio.state.photo.img;
    const ww = t.photo.w * t.w;
    const wh = t.photo.h * t.h;
    const cover = Math.max(ww / img.naturalWidth, wh / img.naturalHeight);
    const drawnWidth = img.naturalWidth * cover * window.__studio.state.place.zoom;
    const centerShift = window.__studio.state.place.dx * ww;
    return { dx: window.__studio.state.place.dx, exposesUnderlyingArt: Math.abs(centerShift) + ww / 2 > drawnWidth / 2 };
  });
  expect(evidence.dx).toBe(1);
  expect(evidence.exposesUnderlyingArt).toBe(true);

  await page.locator('#zoom').fill('300');
  await page.locator('#zoom').dispatchEvent('input');
  expect(await page.evaluate(() => window.__studio.state.place.zoom)).toBe(3);
  await page.locator('#zoom').fill('100');
  await page.locator('#zoom').dispatchEvent('input');
  expect(await page.evaluate(() => window.__studio.state.place.zoom)).toBe(1);
});

test.skip('pinch requires trusted multi-touch input unavailable in desktop Chromium automation', async () => {
  // Synthetic PointerEvents do not establish the native active-pointer state
  // required by setPointerCapture(). Claiming coverage would invent evidence.
});

test('PNG downloads preserve filenames, format, and portrait/square dimensions', async ({ page }) => {
  await boot(page);
  let pending = page.waitForEvent('download');
  await page.locator('#download').click();
  let download = await pending;
  expect(download.suggestedFilename()).toBe('flyer-club-4.png');
  expect(pngDimensions(await downloadedPng(download))).toEqual({ width: 800, height: 1080 });

  await page.locator('#nameInput').fill('Jane Doe');
  await selectCategory(page, 'Ranks');
  pending = page.waitForEvent('download');
  await page.locator('#download').click();
  download = await pending;
  expect(download.suggestedFilename()).toBe('jane-doe-silver.png');
  expect(pngDimensions(await downloadedPng(download))).toEqual({ width: 1080, height: 1080 });
});

test('static files remain static and local API boundary remains isolated', async ({ request }) => {
  await expect((await request.get('/templates.json')).status()).toBe(200);
  await expect((await request.get('/styles.css')).status()).toBe(200);
  await expect((await request.get('/brand/viago-plain-white.png')).status()).toBe(200);
  await expect((await request.post('/api/cutout')).status()).toBe(501);
});
