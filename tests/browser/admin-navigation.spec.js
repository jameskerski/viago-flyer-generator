import { expect, test } from '@playwright/test';

test('public generator exposes an unobtrusive link to the protected Template Studio', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: 'Template Studio' });
  await expect(link).toHaveAttribute('href', 'https://viago-template-studio-worker.noisy-bread-8a99.workers.dev/');
  await expect(link).toHaveAttribute('target', '_blank');
  const catalog = await page.evaluate(() => fetch('templates.json').then((response) => response.json()));
  expect(catalog.templates).toHaveLength(14);
});
