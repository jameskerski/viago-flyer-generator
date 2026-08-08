import { expect, test } from '@playwright/test';
import { boot, selectCategory, selectTemplate, upload, waitForFlyerFont } from './helpers.js';

const cases = [
  { category: 'General', label: 'Club 4', id: 'club-4', fixture: 'landscape.svg', degrees: 30 },
  { category: 'General', label: 'Welcome', id: 'welcome', fixture: 'portrait.svg', degrees: -30 },
  { category: 'Ranks', label: 'Silver', id: 'silver', fixture: 'square.svg', degrees: 45 },
  { category: 'Events', label: 'Jacksonville (Individual)', id: 'jacksonville-im', fixture: 'landscape.svg', degrees: -45 }
];

for (const item of cases) {
  test(`@visual @rotation ${item.id} at ${item.degrees} degrees`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await boot(page);
    await waitForFlyerFont(page);
    if (item.category !== 'General') await selectCategory(page, item.category);
    await selectTemplate(page, item.label);
    await upload(page, item.fixture);
    await expect(page.locator('#dragHint')).not.toHaveClass(/show/, { timeout: 4_000 });
    await page.locator('#nameInput').fill('Avery Stone');
    await page.locator('#rotation').fill(String(item.degrees));
    await page.locator('#rotation').dispatchEvent('input');
    await page.waitForTimeout(50);
    await expect(page.locator('#flyer')).toHaveScreenshot(`${item.id}-rotation-${item.degrees}.png`);
  });
}
