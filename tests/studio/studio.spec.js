import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ARTWORK = fileURLToPath(new URL('../../public/art/club-4.jpg', import.meta.url));
const REGISTRY = fileURLToPath(new URL('../../public/templates.json', import.meta.url));
const sha = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');

async function openStudio(page) {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/studio/');
  await page.waitForFunction(() => window.__templateStudio?.state?.registry?.templates?.length === 14);
}

async function candidate(page, id = 'studio-fixture') {
  await page.locator('#artworkFile').setInputFiles(ARTWORK);
  await expect(page.locator('#artworkMeta')).toContainText('800 × 1080px');
  await page.locator('#templateId').fill(id);
  await page.locator('#label').fill('Studio Fixture');
}

test('Studio opens and loads an existing template as a non-mutating draft', async ({ page }) => {
  const before = await sha(REGISTRY);
  await openStudio(page);
  await expect(page.getByRole('heading', { name: 'VIAGO Template Studio' })).toBeVisible();
  await page.locator('#draftSource').selectOption('existing');
  await page.locator('#existingTemplate').selectOption('silver');
  await expect(page.locator('#templateId')).toHaveValue('silver');
  await expect(page.locator('#artworkMeta')).toContainText('1080 × 1080px');
  await expect(page.locator('#photoShape')).toHaveValue('rect');
  await expect(page.locator('#nameWrap')).toBeChecked();
  await expect(page.locator('#authorCanvas')).toBeVisible();
  expect(await sha(REGISTRY)).toBe(before);
});

test('candidate artwork dimensions, photo drawing/moving/resizing, and normalized values are visual', async ({ page }) => {
  await openStudio(page);
  await candidate(page);
  const canvas = page.locator('#authorCanvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .1, box.y + box.height * .2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .6, box.y + box.height * .7); await page.mouse.up();
  await expect(page.locator('#photoX')).toHaveValue('0.1');
  await expect(page.locator('#photoY')).toHaveValue('0.2');
  await expect(page.locator('#photoW')).toHaveValue('0.5');
  await expect(page.locator('#photoH')).toHaveValue('0.5');
  await page.locator('#photoShape').selectOption('circle');
  await expect(page.locator('#photoShape')).toHaveValue('circle');

  await page.locator('#movePhoto').click();
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .4); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .5); await page.mouse.up();
  expect(Number(await page.locator('#photoX').inputValue())).toBeCloseTo(.2, 2);
  expect(Number(await page.locator('#photoY').inputValue())).toBeCloseTo(.3, 2);

  const current = await page.evaluate(() => structuredClone(window.__templateStudio.state.draft.photo));
  await page.locator('#movePhoto').click();
  await page.mouse.move(box.x + box.width * (current.x + current.w), box.y + box.height * (current.y + current.h)); await page.mouse.down();
  await page.mouse.move(box.x + box.width * (current.x + current.w + .08), box.y + box.height * (current.y + current.h + .06)); await page.mouse.up();
  expect(Number(await page.locator('#photoW').inputValue())).toBeGreaterThan(current.w);
  expect(Number(await page.locator('#photoH').inputValue())).toBeGreaterThan(current.h);
});

test('name placement, presets, production preview, category, and insertion order stay inspectable', async ({ page }) => {
  await openStudio(page);
  await candidate(page);
  await page.getByRole('button', { name: 'Long' }).click();
  await expect(page.locator('#sampleName')).toHaveValue('Alexandria Montgomery Rivera');
  await page.locator('#nameWrap').check();
  await page.locator('#nameMaxLines').fill('2');
  await page.locator('#nameVAlign').selectOption('top');
  await page.locator('#moveName').click();
  const canvas = page.locator('#authorCanvas'); const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .85); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .62, box.y + box.height * .72); await page.mouse.up();
  expect(Number(await page.locator('#nameX').inputValue())).toBeCloseTo(.62, 2);
  expect(Number(await page.locator('#nameY').inputValue())).toBeCloseTo(.72, 2);
  await page.locator('#category').fill('Studio Category');
  await expect(page.locator('#categoryPosition')).toHaveValue('0');
  await expect(page.locator('#orderPreview .proposed')).toContainText('Studio Category: Studio Fixture');
  await page.locator('#previewMode').click();
  await expect(page.locator('#previewMode')).toHaveClass(/active/);
  await expect(page.locator('#jsonPreview')).toContainText('"maxLines": 2');
});

test('validation surfaces duplicate ID and artwork dimension mismatch without mutation', async ({ page }) => {
  const before = await sha(REGISTRY);
  await openStudio(page);
  await candidate(page, 'club-4');
  await page.locator('#validate').click();
  await expect(page.locator('#validationResult')).toContainText("duplicate template id 'club-4'");
  await page.locator('#templateId').fill('studio-fixture');
  await page.evaluate(() => { window.__templateStudio.state.draft.w = 801; });
  await page.locator('#validate').click();
  await expect(page.locator('#validationResult')).toContainText('artwork is 800x1080; registry declares 801x1080');
  expect(await sha(REGISTRY)).toBe(before);
});

test('review artifact and promotion plan are generated without production mutation', async ({ page }) => {
  const before = await sha(REGISTRY);
  await openStudio(page);
  await candidate(page);
  await page.locator('#provDesigner').fill('Test Designer');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#reviewArtifact').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('studio-fixture-review.json');
  const artifact = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(artifact.status).toBe('REVIEW_ONLY_NOT_PROMOTED');
  expect(artifact.template.id).toBe('studio-fixture');
  expect(artifact.artwork.sha256).toHaveLength(64);
  expect(artifact.validation.ok).toBe(true);
  await page.locator('#preparePromotion').click();
  await expect(page.locator('#planPreview')).toContainText('public/art/studio-fixture.jpg');
  await expect(page.locator('#promote')).toBeDisabled();
  await page.locator('#promotionConfirmation').fill('PROMOTE');
  await expect(page.locator('#promote')).toBeEnabled();
  expect(await sha(REGISTRY)).toBe(before);
});
