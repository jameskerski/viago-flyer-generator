import { expect, test } from '@playwright/test';

const events = [
  { id: 'elevate-na-2026', public_name: 'Elevate North America', series: 'Elevate', region: 'North America', event_year: 2026, gallery_count: 5, photo_count: 4749, sync_status: 'CONFIRMED', galleries: [] },
  { id: 'playbook-na-2026', public_name: 'Playbook North America', series: 'Playbook', region: 'North America', event_year: 2026, gallery_count: 7, photo_count: 1194, sync_status: 'CONFIRMED', galleries: [] }
];
const sampleGallery = { drive_folder_id: 'drive-gallery-1', public_name: 'Stage & Speakers', photo_count: 12, sync_status: 'CONFIRMED', destination_url: 'https://drive.google.com/drive/folders/drive-gallery-1', cover_url: '' };

async function mockPhotoApi(page, role = 'PHOTO_ADMIN') {
  await page.route('**/api/photos/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/photos/', '');
    let body;
    if (path === 'session') body = { actor: { id: 'owner', displayName: role === 'PHOTO_ADMIN' ? 'GLT Owner' : 'Event Photographer', role, canCreateEvent: role === 'PHOTO_ADMIN' } };
    else if (path === 'events') body = { events: role === 'PHOTO_ADMIN' ? events : events.slice(0, 1) };
    else if (path === 'overview') body = { overview: { events: 7, photographers: 2, galleries: 26, photos: 10049 } };
    else if (path === 'photographers') body = { photographers: [{ id: 'photographer-1', display_name: 'Approved Photographer', email: 'photographer@example.com', status: 'ACTIVE', event_ids: 'elevate-na-2026' }] };
    else if (path === 'activity') body = { activity: [] };
    else if (path === 'setup') body = { operations: [], qualification: { enabled: false, blockers: ['Authorized Drive event-root provisioning is not configured.'] } };
    else if (path === 'creation-capabilities') body = { qualification: { enabled: false, blockers: ['Authorized Drive event-root provisioning is not configured.'] } };
    else if (path.includes('/galleries/drive-gallery-1/photos')) body = { gallery: { driveFolderId: 'drive-gallery-1', publicName: 'Stage & Speakers', coverFileId: 'photo-1' }, total: 2, nextCursor: '', photos: [{ fileId: 'photo-1', filename: 'stage-keynote.jpg', relativePath: 'Stage & Speakers/stage-keynote.jpg', thumbnailUrl: '/tests/fixtures/landscape.svg', currentCover: true }, { fileId: 'photo-2', filename: 'awards.jpg', relativePath: 'Stage & Speakers/awards.jpg', thumbnailUrl: '/tests/fixtures/portrait.svg', currentCover: false }] };
    else if (path.startsWith('events/')) body = { event: { ...events.find(({ id }) => id === path.slice(7)), capabilities: ['GALLERY_UPLOAD', 'GALLERY_COVER_SELECT'], galleries: [sampleGallery] }, uploadAccess: { authorized: role === 'PHOTO_ADMIN' || role === 'PHOTOGRAPHER', source: role === 'PHOTO_ADMIN' ? 'ADMIN' : 'STUDIO_MANAGED', state: 'VERIFIED' }, galleryOperations: [], galleryManagementQualified: true };
    else body = { ok: true };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('administrator wizard validates a draft without pretending external provisioning is qualified', async ({ page }) => {
  await mockPhotoApi(page);
  await page.goto('/studio/photos/index.html');
  await expect(page.getByRole('heading', { name: 'PHOTO STUDIO' })).toBeVisible();
  await expect(page.getByText('10,049')).toBeVisible();
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await expect(page.locator('.event-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('external provisioning is paused');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Validate event draft' })).toBeEnabled();
});

test('photographer sees only assigned events and no administrator navigation', async ({ page }) => {
  await mockPhotoApi(page, 'PHOTOGRAPHER');
  await page.goto('/studio/photos/index.html');
  await expect(page.getByText('Event Photographer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Photographers' })).toBeHidden();
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await expect(page.locator('.event-card')).toHaveCount(1);
  await expect(page.getByText('Playbook North America')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Create event' })).toBeHidden();
  await page.getByRole('button', { name: 'Open Elevate North America' }).click();
  const upload = page.getByRole('link', { name: 'Open upload folder' });
  await expect(upload).toBeVisible();
  await expect(upload).toHaveAttribute('href', 'https://drive.google.com/drive/folders/drive-gallery-1');
  await page.getByRole('button', { name: 'Set cover photo' }).click();
  await expect(page.getByRole('dialog')).toContainText('2 photographs');
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.getByRole('option', { name: /stage-keynote/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('option', { name: /awards/ }).click();
  await expect(page.getByRole('option', { name: /awards/ })).toHaveAttribute('aria-selected', 'true');
});

for (const width of [375, 390, 430, 1280, 1440]) {
  test(`Photo Studio has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await mockPhotoApi(page);
    await page.goto('/studio/photos/index.html');
    await expect(page.locator('#app')).toBeVisible();
    const geometry = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  });
}
