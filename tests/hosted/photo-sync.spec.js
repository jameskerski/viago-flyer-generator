import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSyncPayload } from '../../hosted/platform/photo-sync.mjs';

const payload = (event = {}) => ({
  success: true,
  scanValid: true,
  wixWriteAccepted: true,
  fingerprint: 'fnv1a-fixture',
  reconciledAt: '2026-10-09T01:05:41.000Z',
  galleryCount: 1,
  totalPhotoCount: 3,
  event: {
    wixItemId: '06ba49a9-3a09-40ef-90c7-02f9b8c14ad2',
    publicName: 'VIAGO Fest',
    series: '',
    region: '',
    year: 2026,
    artworkUrl: 'https://static.wixstatic.com/media/event.png',
    allPhotosUrl: 'https://drive.google.com/drive/folders/event-root',
    ...event
  },
  galleries: [{
    sourceFolderId: 'gallery-folder',
    title: 'Highlights',
    sourceFolderName: 'Highlights',
    photoCount: 3,
    coverImage: 'https://drive.google.com/thumbnail?id=cover-file',
    coverFileId: 'cover-file',
    coverSource: 'deterministic-first-image',
    destinationUrl: 'https://drive.google.com/drive/folders/gallery-folder',
    displayOrder: 1
  }]
});

test('accepts authoritative events without optional series or region classifications', async () => {
  const request = new Request('https://example.test/api/photos/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload())
  });
  const result = await parseSyncPayload(request);
  assert.equal(result.publicName, 'VIAGO Fest');
  assert.equal(result.series, '');
  assert.equal(result.region, '');
  assert.equal(result.galleryCount, 1);
  assert.equal(result.photoCount, 3);
});

test('continues to reject a missing authoritative Drive root', async () => {
  const request = new Request('https://example.test/api/photos/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload({ allPhotosUrl: '' }))
  });
  await assert.rejects(() => parseSyncPayload(request), /invalid_event_metadata/);
});

test('continues to reject a missing canonical Wix event identity', async () => {
  const request = new Request('https://example.test/api/photos/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload({ wixItemId: '' }))
  });
  await assert.rejects(() => parseSyncPayload(request), /invalid_source_id/);
});
