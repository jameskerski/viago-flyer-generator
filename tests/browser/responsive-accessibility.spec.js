import { expect, test } from '@playwright/test';
import { boot } from './helpers.js';

for (const width of [320, 390, 430, 1280]) {
  test(`shell remains contained and usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 900 ? 844 : 900 });
    await boot(page);
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('#flyer').getBoundingClientRect();
      const upload = document.querySelector('label[for="file"]').getBoundingClientRect();
      const pickPanel = document.querySelector('.pick-panel').getBoundingClientRect();
      const logo = document.querySelector('.panel-brand');
      const logoBox = logo.getBoundingClientRect();
      const categories = document.querySelector('#cats').getBoundingClientRect();
      const nameStyle = getComputedStyle(document.querySelector('#nameInput'));
      return {
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        canvasLeft: canvas.left,
        canvasRight: canvas.right,
        uploadHeight: upload.height,
        logoNaturalWidth: logo.naturalWidth,
        logoNaturalHeight: logo.naturalHeight,
        logoWidth: logoBox.width,
        logoHeight: logoBox.height,
        logoRight: logoBox.right,
        panelRight: pickPanel.right,
        logoAboveCategories: logoBox.bottom <= categories.top,
        nameFontSize: nameStyle.fontSize,
        photoToolsHidden: document.querySelector('#photoTools').hidden,
        stagePointerEvents: getComputedStyle(document.querySelector('#stage')).pointerEvents,
        canvasPointerEvents: getComputedStyle(document.querySelector('#flyer')).pointerEvents
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.canvasLeft).toBeGreaterThanOrEqual(0);
    expect(layout.canvasRight).toBeLessThanOrEqual(layout.viewport);
    expect(layout.uploadHeight).toBeGreaterThanOrEqual(44);
    expect(layout.logoNaturalWidth).toBe(1913);
    expect(layout.logoNaturalHeight).toBe(779);
    expect(layout.logoWidth).toBe(width < 900 ? 84 : 128);
    expect(layout.logoHeight).toBeCloseTo(layout.logoWidth * 779 / 1913, 1);
    expect(layout.logoRight).toBeLessThan(layout.panelRight);
    expect(layout.logoAboveCategories).toBe(true);
    expect(layout.nameFontSize).toBe('16px');
    expect(layout.photoToolsHidden).toBe(true);
    expect(layout.stagePointerEvents).toBe('none');
    expect(layout.canvasPointerEvents).toBe('auto');
    await expect(page.locator('#download')).toBeVisible();
  });
}

test('bounded accessibility and keyboard smoke preserves current semantics', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#status')).toHaveAttribute('role', 'status');
  await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#nameInput')).toHaveAccessibleName('Name');
  await expect(page.locator('#file')).toHaveAttribute('accept', 'image/*');
  await expect(page.locator('.panel-brand')).toHaveAccessibleName('VIAGO');
  await expect(page.getByRole('button', { name: 'Download flyer' })).toBeVisible();
  const ranks = page.locator('#cats').getByRole('button', { name: 'Ranks', exact: true });
  await ranks.focus();
  await expect(ranks).toBeFocused();
  expect(await ranks.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('#templates .chip.is-on')).toContainText('Silver');
  await page.locator('#nameInput').focus();
  await page.keyboard.type('Keyboard Name');
  await expect(page.locator('#nameInput')).toHaveValue('Keyboard Name');
});
