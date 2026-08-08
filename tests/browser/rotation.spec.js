import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { boot, canvasDigest, downloadedPng, fixture, selectCategory, selectTemplate, upload } from './helpers.js';

async function rotate(page, degrees) {
  await page.locator('#rotation').fill(String(degrees));
  await page.locator('#rotation').dispatchEvent('input');
  await page.waitForTimeout(50);
}

test('rotation control has the authorized range, degree display, boundaries, and keyboard behavior', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#rotation')).toBeHidden();
  await upload(page, 'square.svg');
  const rotation = page.locator('#rotation');
  await expect(rotation).toBeVisible();
  await expect(rotation).toHaveAttribute('min', '-180');
  await expect(rotation).toHaveAttribute('max', '180');
  await expect(rotation).toHaveValue('0');
  await expect(page.locator('#rotationValue')).toHaveText('0°');

  for (const degrees of [30, -30, 180, -180]) {
    await rotate(page, degrees);
    expect(await page.evaluate(() => window.__studio.state.place.rotation)).toBe(degrees);
    await expect(page.locator('#rotationValue')).toHaveText(`${degrees}°`);
  }

  await rotation.focus();
  await page.keyboard.press('Home');
  await expect(rotation).toHaveValue('-180');
  await page.keyboard.press('ArrowRight');
  await expect(rotation).toHaveValue('-179');
  expect(await page.evaluate(() => window.__studio.state.place.rotation)).toBe(-179);
});

test('upload, replacement, template, category, clear, and re-upload reset placement consistently', async ({ page }) => {
  await boot(page);
  await upload(page, 'portrait.svg');
  await page.evaluate(() => { window.__studio.state.place = { dx: .4, dy: -.3, zoom: 2, rotation: 60 }; });
  await page.locator('#zoom').fill('200');
  await rotate(page, 60);
  await page.locator('#file').setInputFiles(fixture('landscape.svg'));
  await expect(page.locator('#statusText')).toHaveText('Ready');
  expect(await page.evaluate(() => window.__studio.state.place)).toEqual({ dx: 0, dy: 0, zoom: 1, rotation: 0 });

  await rotate(page, 35);
  await selectTemplate(page, 'Mission 30');
  expect(await page.evaluate(() => window.__studio.state.place)).toEqual({ dx: 0, dy: 0, zoom: 1, rotation: 0 });
  await rotate(page, -35);
  await selectCategory(page, 'Ranks');
  expect(await page.evaluate(() => window.__studio.state.place)).toEqual({ dx: 0, dy: 0, zoom: 1, rotation: 0 });

  await rotate(page, 90);
  await page.locator('#clearPhoto').click();
  expect(await page.evaluate(() => window.__studio.state.place)).toEqual({ dx: 0, dy: 0, zoom: 1, rotation: 0 });
  await upload(page, 'square.svg');
  await expect(page.locator('#rotation')).toHaveValue('0');
  await expect(page.locator('#rotationValue')).toHaveText('0°');
});

test('rotation composes with zoom and the existing drag model', async ({ page }) => {
  await boot(page);
  await upload(page, 'landscape.svg');
  const zero = await canvasDigest(page);
  await rotate(page, 45);
  const rotated = await canvasDigest(page);
  expect(rotated).not.toBe(zero);
  await page.locator('#zoom').fill('175');
  await page.locator('#zoom').dispatchEvent('input');
  await page.waitForTimeout(50);
  const zoomed = await canvasDigest(page);
  expect(zoomed).not.toBe(rotated);

  const canvas = page.locator('#flyer');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .55);
  await page.mouse.up();
  await page.waitForTimeout(50);
  const place = await page.evaluate(() => window.__studio.state.place);
  expect(place.rotation).toBe(45);
  expect(place.zoom).toBe(1.75);
  expect(Math.abs(place.dx) + Math.abs(place.dy)).toBeGreaterThan(0);
  expect(await canvasDigest(page)).not.toBe(zoomed);
});

for (const fixture of ['portrait.svg', 'landscape.svg', 'square.svg']) {
  test(`exact rotated-cover geometry covers rectangle and ellipse windows for ${fixture}`, async ({ page }) => {
    await boot(page);
    await upload(page, fixture);
    const evidence = await page.evaluate(() => {
      const state = window.__studio.state;
      const image = state.photo.img;
      const cases = state.templates.filter((template) => ['welcome', 'club-4'].includes(template.id));
      return cases.flatMap((template) => [-180, -45, -30, 30, 45, 180].map((degrees) => {
        const ww = template.photo.w * template.w, wh = template.photo.h * template.h;
        const radians = degrees * Math.PI / 180;
        const scale = window.__studio.rotatedCoverScale(ww, wh, image.naturalWidth, image.naturalHeight, radians);
        const c = Math.cos(radians), s = Math.sin(radians);
        const mapped = [[-ww/2,-wh/2],[ww/2,-wh/2],[ww/2,wh/2],[-ww/2,wh/2]].map(([x,y]) => ({
          x: Math.abs(x * c + y * s), y: Math.abs(-x * s + y * c)
        }));
        return {
          template: template.id, shape: template.photo.shape, degrees,
          covered: mapped.every((point) => point.x <= image.naturalWidth * scale / 2 + 1e-7 && point.y <= image.naturalHeight * scale / 2 + 1e-7)
        };
      }));
    });
    expect(evidence.every(({ covered }) => covered)).toBe(true);
    expect(new Set(evidence.map(({ shape }) => shape))).toEqual(new Set(['rect', 'circle']));
  });
}

test('downloaded PNG exactly matches the rotated preview canvas', async ({ page }) => {
  await boot(page);
  await upload(page, 'portrait.svg');
  await rotate(page, -45);
  await page.locator('#zoom').fill('140');
  await page.locator('#zoom').dispatchEvent('input');
  await page.waitForTimeout(50);
  const preview = await canvasDigest(page);
  const pending = page.waitForEvent('download');
  await page.locator('#download').click();
  const bytes = await downloadedPng(await pending);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(preview);
});

for (const width of [320, 390, 430, 1280]) {
  test(`rotation remains contained and usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 900 ? 844 : 900 });
    await boot(page);
    await upload(page, 'square.svg');
    const layout = await page.evaluate(() => {
      const control = document.querySelector('#rotation').getBoundingClientRect();
      return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, left: control.left, right: control.right, height: control.height };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.viewport);
    expect(layout.height).toBeGreaterThanOrEqual(44);
    await rotate(page, 30);
    await expect(page.locator('#rotationValue')).toHaveText('30°');
  });
}
