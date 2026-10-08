const MAX_BYTES = 900_000;
const MAX_GALLERIES = 200;
const clean = (value, max = 500) => String(value || '').trim().slice(0, max);
const count = (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 10_000_000) throw new Error('invalid_count');
  return number;
};
const safeUrl = (value) => {
  const url = clean(value, 2048);
  if (!url) return '';
  if (!/^https:\/\//i.test(url)) throw new Error('invalid_url');
  return url;
};
const sourceId = (value) => {
  const result = clean(value, 200);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new Error('invalid_source_id');
  return result;
};

export async function authorizedSync(request, env) {
  const expected = env.PHOTO_STUDIO_SYNC_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  const [a, b] = [expected, supplied].map((value) => new TextEncoder().encode(value));
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function parseSyncPayload(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error('payload_too_large');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('payload_too_large');
  const body = JSON.parse(raw);
  if (body.success !== true || body.scanValid !== true || body.wixWriteAccepted !== true) throw new Error('authoritative_write_not_confirmed');
  const galleries = Array.isArray(body.galleries) ? body.galleries : [];
  if (galleries.length > MAX_GALLERIES) throw new Error('too_many_galleries');
  const event = body.event || {};
  const normalized = {
    wixItemId: sourceId(event.wixItemId),
    publicName: clean(event.publicName, 200),
    series: clean(event.series, 100),
    region: clean(event.region, 100),
    year: count(event.year),
    artworkUrl: safeUrl(event.artworkUrl),
    allPhotosUrl: safeUrl(event.allPhotosUrl),
    fingerprint: clean(body.fingerprint, 128),
    reconciledAt: clean(body.reconciledAt, 64),
    galleries: galleries.map((gallery, index) => ({
      folderId: sourceId(gallery.sourceFolderId || gallery.galleryId),
      title: clean(gallery.title, 200),
      sourceFolderName: clean(gallery.sourceFolderName || gallery.title, 200),
      photoCount: count(gallery.photoCount),
      coverUrl: safeUrl(gallery.coverImage),
      coverFileId: gallery.coverFileId ? sourceId(gallery.coverFileId) : '',
      coverSource: clean(gallery.coverSource, 80),
      destinationUrl: safeUrl(gallery.destinationUrl),
      displayOrder: count(gallery.displayOrder || index + 1)
    }))
  };
  if (!normalized.publicName || !normalized.series || !normalized.region || normalized.year < 2000 || !normalized.fingerprint || !normalized.reconciledAt) throw new Error('invalid_event_metadata');
  const folderIds = new Set(normalized.galleries.map((gallery) => gallery.folderId));
  if (folderIds.size !== normalized.galleries.length) throw new Error('duplicate_gallery_identity');
  const galleryCount = count(body.galleryCount);
  const photoCount = count(body.totalPhotoCount);
  if (galleryCount !== normalized.galleries.length || photoCount !== normalized.galleries.reduce((sum, gallery) => sum + gallery.photoCount, 0)) throw new Error('aggregate_mismatch');
  return { ...normalized, galleryCount, photoCount };
}

export async function reconcilePhotoReadModel(database, payload) {
  const existingEvent = await database.prepare(`SELECT id, source_fingerprint FROM photo_events WHERE wix_item_id = ?`).bind(payload.wixItemId).first();
  const eventId = existingEvent?.id || `wix-${payload.wixItemId}`;
  const idempotencyKey = `wix:${payload.wixItemId}:${payload.fingerprint}`;
  const existingReceipt = await database.prepare(`SELECT operation_outcome FROM source_sync_receipts WHERE idempotency_key = ?`).bind(idempotencyKey).first();
  if (existingReceipt?.operation_outcome === 'SUCCEEDED') return { changed: false, idempotent: true, eventId, galleryCount: payload.galleryCount, photoCount: payload.photoCount };
  const statements = [
    database.prepare(`INSERT OR REPLACE INTO source_sync_receipts (idempotency_key, source_system, source_event_id, source_fingerprint, operation_outcome, gallery_count, photo_count, completed_at) VALUES (?, 'WIX_PHOTO_EVENT_YEARS', ?, ?, 'SUCCEEDED', ?, ?, CURRENT_TIMESTAMP)`).bind(idempotencyKey, payload.wixItemId, payload.fingerprint, payload.galleryCount, payload.photoCount),
    database.prepare(`INSERT INTO photo_events (id, wix_item_id, public_name, series, region, event_year, artwork_url, gallery_count, photo_count, sync_status, source_fingerprint, active, last_reconciled_at, source_reconciled_at, all_photos_url, sync_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, 1, CURRENT_TIMESTAMP, ?, ?, NULL)
      ON CONFLICT(wix_item_id) DO UPDATE SET public_name=excluded.public_name, series=excluded.series, region=excluded.region, event_year=excluded.event_year, artwork_url=excluded.artwork_url, gallery_count=excluded.gallery_count, photo_count=excluded.photo_count, sync_status='CONFIRMED', source_fingerprint=excluded.source_fingerprint, active=1, last_reconciled_at=CURRENT_TIMESTAMP, source_reconciled_at=excluded.source_reconciled_at, all_photos_url=excluded.all_photos_url, sync_error=NULL, updated_at=CURRENT_TIMESTAMP`)
      .bind(eventId, payload.wixItemId, payload.publicName, payload.series, payload.region, payload.year, payload.artworkUrl || null, payload.galleryCount, payload.photoCount, payload.fingerprint, payload.reconciledAt, payload.allPhotosUrl || null),
    database.prepare(`UPDATE photo_galleries SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE event_id = ?`).bind(eventId)
  ];
  for (const gallery of payload.galleries) {
    statements.push(database.prepare(`INSERT INTO photo_galleries (id, event_id, drive_folder_id, public_name, cover_url, photo_count, sync_status, active, destination_url, cover_file_id, cover_source, source_folder_name, display_order, last_reconciled_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED', 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(drive_folder_id) DO UPDATE SET event_id=excluded.event_id, public_name=excluded.public_name, cover_url=excluded.cover_url, photo_count=excluded.photo_count, sync_status='CONFIRMED', active=1, destination_url=excluded.destination_url, cover_file_id=excluded.cover_file_id, cover_source=excluded.cover_source, source_folder_name=excluded.source_folder_name, display_order=excluded.display_order, last_reconciled_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP`)
      .bind(`drive-${gallery.folderId}`, eventId, gallery.folderId, gallery.title, gallery.coverUrl || null, gallery.photoCount, gallery.destinationUrl, gallery.coverFileId || null, gallery.coverSource || null, gallery.sourceFolderName, gallery.displayOrder));
  }
  statements.push(database.prepare(`INSERT INTO audit_records (id, actor_email, module_key, operation, target_type, target_id, event_id, authorization_outcome, operation_outcome, correlation_id, idempotency_key, safe_metadata_json) VALUES (?, 'SYSTEM:WIX_PHOTO_AUTOMATION', 'PHOTO_STUDIO', 'sync.reconcile', 'photo_event', ?, ?, 'ALLOWED', 'SUCCEEDED', ?, ?, ?)`)
    .bind(`audit-${crypto.randomUUID()}`, eventId, eventId, crypto.randomUUID(), idempotencyKey, JSON.stringify({ fingerprint: payload.fingerprint, galleryCount: payload.galleryCount, photoCount: payload.photoCount })));
  await database.batch(statements);
  return { changed: existingEvent?.source_fingerprint !== payload.fingerprint, idempotent: false, eventId, galleryCount: payload.galleryCount, photoCount: payload.photoCount };
}
