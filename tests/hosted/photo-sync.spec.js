import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSyncPayload, reconcilePhotoReadModel } from '../../hosted/platform/photo-sync.mjs';

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

test('idempotent snapshots still reapply gallery membership and invalidate missing covers', async () => {
  const executed = [];
  const database = {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes('FROM photo_events')) return { id: 'wix-event', source_fingerprint: 'same-fingerprint' };
          if (sql.includes('FROM source_sync_receipts')) return { operation_outcome: 'SUCCEEDED' };
          return null;
        }
      };
    },
    async batch(statements) { executed.push(...statements); }
  };
  const result = await reconcilePhotoReadModel(database, {
    wixItemId: 'event-item', publicName: 'Inactive test event', series: '', region: '', year: 2027,
    artworkUrl: '', allPhotosUrl: 'https://drive.google.com/drive/folders/event-root',
    fingerprint: 'same-fingerprint', reconciledAt: '2026-10-10T23:12:48.000Z',
    galleries: [], galleryCount: 0, photoCount: 0
  });

  assert.equal(result.idempotent, true);
  assert.equal(result.galleryCount, 0);
  assert.ok(executed.some(({ sql }) => sql.includes('UPDATE photo_galleries SET active = 0')));
  assert.ok(executed.some(({ sql }) => sql.includes("selection_state='INVALID_FALLBACK'")));
  assert.ok(executed.some(({ sql }) => sql.includes("UPDATE photo_removal_operations")));
  assert.ok(executed.some(({ sql }) => sql.includes("UPDATE photo_gallery_deletion_operations")));
  assert.ok(!executed.some(({ sql }) => sql.includes('INSERT OR REPLACE INTO source_sync_receipts')));
  assert.ok(!executed.some(({ sql }) => sql.includes('INSERT INTO audit_records')));
});

test('reconciliation confirms only gallery deletions absent from the Wix snapshot', async () => {
  const executed = [];
  const database = {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() { return null; }
      };
    },
    async batch(statements) { executed.push(...statements); }
  };
  await reconcilePhotoReadModel(database, {
    wixItemId: 'event-item', publicName: 'Qualification event', series: 'Test', region: 'Test', year: 2027,
    artworkUrl: '', allPhotosUrl: 'https://drive.google.com/drive/folders/event-root',
    fingerprint: 'changed-fingerprint', reconciledAt: '2026-10-12T16:00:00.000Z',
    galleries: [{ folderId: 'remaining-gallery', title: 'Remaining', sourceFolderName: 'Remaining', photoCount: 2, coverUrl: '', coverFileId: '', coverSource: '', destinationUrl: 'https://drive.google.com/drive/folders/remaining-gallery', displayOrder: 1 }],
    galleryCount: 1, photoCount: 2
  });
  const deletionConfirmation = executed.find(({ sql }) => sql.includes('UPDATE photo_gallery_deletion_operations'));
  assert.ok(deletionConfirmation.sql.includes('gallery_folder_id NOT IN (?)'));
  assert.deepEqual(deletionConfirmation.args.slice(-1), ['remaining-gallery']);
});
