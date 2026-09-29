import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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

test('public generator boots from a legitimately reduced active catalog', async ({ page }) => {
  const catalog = JSON.parse(await readFile(new URL('../../public/templates.json', import.meta.url), 'utf8'));
  catalog.templates = catalog.templates.filter(({ id }) => id !== 'cyprus-im');
  await page.route('**/templates.json', (route) => route.fulfill({ json: catalog }));
  await page.goto('/');
  await page.waitForFunction(
    (expectedLength) => window.__studio?.state?.templates?.length === expectedLength,
    catalog.templates.length
  );
  expect(await page.evaluate(() => window.__studio.state.templates.some(({ id }) => id === 'cyprus-im'))).toBe(false);
  await expect(page.locator('#cats .cat')).toHaveText(['General', 'Ranks', 'Events']);
});

test('optional user text controls are template-driven, independent, rendered, exported, and backward-compatible', async ({ page }) => {
  let catalog = JSON.parse(await readFile(new URL('../../public/templates.json', import.meta.url), 'utf8'));
  await page.addInitScript(() => {
    window.__paintedText = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) { window.__paintedText.push(String(text)); return original.call(this, text, ...args); };
  });
  await page.route('**/templates.json', (route) => route.fulfill({ json: catalog }));
  const load = async () => {
    await page.goto('/'); await expect(page.locator('#statusText')).toHaveText('Ready');
    await page.waitForFunction((length) => window.__studio?.state?.templates?.length === length, catalog.templates.length);
  };
  const first = catalog.templates[0]; const region = (label) => ({ enabled: true, label, x: .7, y: .08, w: .2, h: .05, size: .045, font: 'Josefin Sans', weight: 700, color: '#ffffff', align: 'center' });
  await load(); const absentDigest = await canvasDigest(page);
  await expect(page.locator('#nameInput')).toBeVisible(); await expect(page.locator('#text2Input')).toHaveCount(0); await expect(page.locator('#text3Input')).toHaveCount(0);
  catalog = { ...catalog, templates: catalog.templates.map((template, index) => index ? template : { ...template, text3: { ...region('Number'), enabled: false, value: 'LEGACY MUST NOT RENDER' } }) };
  await load(); expect(await canvasDigest(page)).toBe(absentDigest); expect(await page.evaluate(() => window.__paintedText)).not.toContain('LEGACY MUST NOT RENDER');
  catalog = { ...catalog, templates: catalog.templates.map((template, index) => index === 0 ? { ...template, text2: region('Rank') } : index === 1 ? { ...template, text3: { ...region('Placement'), value: 'STALE' } } : index === 2 ? { ...template, text2: region('Team'), text3: region('Code') } : template) };
  await load();
  await expect(page.locator('#text2Input')).toBeVisible(); await expect(page.locator('#text2Input')).toHaveAccessibleName('Rank'); await expect(page.locator('#text3Input')).toHaveCount(0);
  await page.locator('#text2Input').fill('Gold'); await page.evaluate(() => window.__studio.render()); expect(await page.evaluate(() => window.__paintedText)).toContain('Gold');
  await page.evaluate(() => { window.__paintedText = []; });
  await selectTemplate(page, catalog.templates[1].label); await expect(page.locator('#text2Input')).toHaveCount(0); await expect(page.locator('#text3Input')).toHaveAccessibleName('Placement');
  await page.evaluate(() => window.__studio.render()); expect(await page.evaluate(() => window.__paintedText)).not.toContain('Gold'); expect(await page.evaluate(() => window.__paintedText)).not.toContain('STALE');
  await page.locator('#text3Input').fill('3 of 15');
  await selectTemplate(page, catalog.templates[2].label); await expect(page.locator('#text2Input')).toBeVisible(); await expect(page.locator('#text3Input')).toBeVisible();
  await page.locator('#text2Input').fill('Alpha'); await page.locator('#text3Input').fill('OK');
  await page.waitForFunction(() => window.__paintedText.includes('OK'));
  expect(await page.evaluate(() => window.__paintedText)).toEqual(expect.arrayContaining(['Alpha', 'OK']));
  const before = await page.evaluate(() => window.__paintedText.filter((value) => value === 'OK').length);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download').click();
  const png = await downloadedPng(await downloadPromise);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(await page.evaluate(() => window.__paintedText.filter((value) => value === 'OK').length)).toBeGreaterThan(before);
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
