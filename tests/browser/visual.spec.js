import { expect, test } from '@playwright/test';
import { boot, selectCategory, selectTemplate, upload, waitForFlyerFont } from './helpers.js';

const templates = [
  ['General', 'Club 4', 'club-4'],
  ['General', 'Mission 30', 'mission-30'],
  ['General', 'Amplified Bonus', 'amplified'],
  ['General', 'Welcome', 'welcome'],
  ['Ranks', 'Silver', 'silver'],
  ['Ranks', 'Gold', 'gold'],
  ['Ranks', 'Sapphire', 'sapphire'],
  ['Ranks', 'Emerald', 'emerald'],
  ['Ranks', 'Elite Emerald', 'elite-emerald'],
  ['Events', 'Jacksonville (Individual)', 'jacksonville-im'],
  ['Events', 'Jacksonville (Couple)', 'jacksonville-we'],
  ['Events', 'Cyprus (Individual)', 'cyprus-im'],
  ['Events', 'Cyprus (Couple)', 'cyprus-we'],
  ['Events', 'Kenya', 'kenya']
];

test('@visual all 14 photo-and-name compositions match the controlled Chromium baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);
  await waitForFlyerFont(page);
  await upload(page, 'square.svg');
  await expect(page.locator('#dragHint')).not.toHaveClass(/show/);
  await page.locator('#nameInput').fill('Avery Stone');
  let category = 'General';
  for (const [nextCategory, label, id] of templates) {
    if (nextCategory !== category) {
      await selectCategory(page, nextCategory);
      category = nextCategory;
    }
    await selectTemplate(page, label);
    await page.waitForTimeout(50);
    await expect(page.locator('#flyer')).toHaveScreenshot(`${id}-photo-name.png`);
  }
});

test('@visual no-photo artwork and wrapped rank name match accepted baselines', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);
  await waitForFlyerFont(page);
  await expect(page.locator('#flyer')).toHaveScreenshot('club-4-no-photo.png');
  await selectCategory(page, 'Ranks');
  await upload(page, 'portrait.svg');
  await expect(page.locator('#dragHint')).not.toHaveClass(/show/);
  await page.locator('#nameInput').fill('Alexandria Montgomery Rivera');
  await page.waitForTimeout(50);
  await expect(page.locator('#flyer')).toHaveScreenshot('silver-long-wrapped-name.png');
});
