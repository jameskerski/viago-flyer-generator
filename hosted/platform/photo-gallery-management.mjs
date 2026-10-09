const clean = (value, max = 200) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const folderId = (value) => { const id = clean(value); if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error('invalid_gallery_identity'); return id; };
export function normalizeGalleryName(value) {
  const name = clean(value, 120);
  if (!name) throw new Error('gallery_name_required');
  if (name.startsWith('_')) throw new Error('reserved_gallery_name');
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name) || name === '.' || name === '..') throw new Error('invalid_gallery_name');
  return name;
}
async function hash(value) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))); return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
const operationId = () => `gallery-operation-${crypto.randomUUID()}`;
const select = `SELECT id,idempotency_key,request_hash,requested_by_user_id,event_id,operation_type,operation_state,gallery_folder_id,requested_name,cover_file_id,drive_folder_url,safe_error_code,safe_error_message,retry_count,created_at,updated_at,confirmed_at FROM photo_gallery_operations`;

export function createGalleryManagement(database, env, photos) {
  const endpointReady = Boolean(env.PHOTO_EVENT_PROVISION_ENDPOINT && env.PHOTO_STUDIO_SYNC_SECRET);
  const get = (id) => database.prepare(`${select} WHERE id = ?`).bind(id).first();
  async function send(action, operation, event) {
    const response = await fetch(env.PHOTO_EVENT_PROVISION_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: env.PHOTO_STUDIO_SYNC_SECRET, action, operationId: operation.id, wixItemId: event.wix_item_id, galleryFolderId: operation.gallery_folder_id || '', galleryName: operation.requested_name || '', coverFileId: operation.cover_file_id || '' }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success !== true) throw new Error(payload.error || `gallery_operation_http_${response.status}`);
    return payload;
  }
  async function browse(event, galleryFolderId, cursor = '') {
    if (!endpointReady) throw new Error('gallery_management_not_qualified');
    const operation = { id: operationId(), gallery_folder_id: folderId(galleryFolderId) };
    const response = await fetch(env.PHOTO_EVENT_PROVISION_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: env.PHOTO_STUDIO_SYNC_SECRET, action: 'LIST_GALLERY_PHOTOS', operationId: operation.id, wixItemId: event.wix_item_id, galleryFolderId: operation.gallery_folder_id, cursor: clean(cursor, 32), pageSize: 48 }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success !== true) throw new Error(payload.error || `gallery_photos_http_${response.status}`);
    return { photos: Array.isArray(payload.photos) ? payload.photos.map((photo) => ({ fileId: folderId(photo.fileId), filename: clean(photo.filename, 300), thumbnailUrl: String(photo.thumbnailUrl || ''), shortcut: photo.shortcut === true, currentCover: photo.currentCover === true, relativePath: clean(photo.relativePath, 500) })) : [], nextCursor: clean(payload.nextCursor, 32), total: Number(payload.total || 0) };
  }
  async function run(operation, event) {
    if (!endpointReady) throw new Error('gallery_management_not_qualified');
    try {
      const action = operation.operation_type === 'CREATE' ? 'CREATE_GALLERY' : operation.operation_type === 'RENAME' ? 'RENAME_GALLERY' : 'SET_GALLERY_COVER';
      const result = await send(action, operation, event);
      const state = operation.operation_type === 'SET_COVER' ? 'CONFIRMED' : 'SYNC_PENDING';
      await database.prepare(`UPDATE photo_gallery_operations SET operation_state=?,gallery_folder_id=COALESCE(?,gallery_folder_id),drive_folder_url=COALESCE(?,drive_folder_url),safe_error_code=NULL,safe_error_message=NULL,confirmed_at=CASE WHEN ?='CONFIRMED' THEN CURRENT_TIMESTAMP ELSE confirmed_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(state, result.galleryFolderId || null, result.driveFolderUrl || null, state, operation.id).run();
      return { operation: await get(operation.id), result };
    } catch (error) {
      await database.prepare(`UPDATE photo_gallery_operations SET operation_state='FAILED_NEEDS_ATTENTION',safe_error_code='DRIVE_OPERATION_FAILED',safe_error_message=?,retry_count=retry_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(clean(error.message, 400), operation.id).run();
      return { operation: await get(operation.id), result: null };
    }
  }
  async function request(actor, event, type, input, key) {
    const operationType = clean(type, 20).toUpperCase();
    if (!['CREATE','RENAME','SET_COVER'].includes(operationType)) throw new Error('unsupported_gallery_operation');
    const normalized = { eventId: event.id, operationType, galleryFolderId: input.galleryFolderId ? folderId(input.galleryFolderId) : '', requestedName: operationType === 'SET_COVER' ? '' : normalizeGalleryName(input.galleryName), coverFileId: operationType === 'SET_COVER' ? folderId(input.coverFileId) : '' };
    if (operationType !== 'CREATE' && !normalized.galleryFolderId) throw new Error('gallery_identity_required');
    const idempotencyKey = clean(key, 128); if (idempotencyKey.length < 16) throw new Error('idempotency_key_required');
    const requestHash = await hash(normalized);
    const existing = await database.prepare(`${select} WHERE idempotency_key=?`).bind(idempotencyKey).first();
    if (existing) { if (existing.request_hash !== requestHash) throw new Error('idempotency_key_conflict'); return { operation: existing, idempotent: true }; }
    const id = operationId();
    await database.prepare(`INSERT INTO photo_gallery_operations (id,idempotency_key,request_hash,requested_by_user_id,requested_by_email,event_id,operation_type,operation_state,gallery_folder_id,requested_name,cover_file_id) VALUES (?,?,?,?,?,?,?,'VALIDATED',NULLIF(?,''),NULLIF(?,''),NULLIF(?,''))`).bind(id,idempotencyKey,requestHash,actor.id,actor.email,event.id,operationType,normalized.galleryFolderId,normalized.requestedName,normalized.coverFileId).run();
    const completed = await run(await get(id), event);
    if (operationType === 'SET_COVER' && completed.operation.operation_state !== 'FAILED_NEEDS_ATTENTION') {
      await database.prepare(`INSERT INTO photo_gallery_cover_selections (gallery_folder_id,event_id,selected_file_id,selected_by_user_id,selected_by_email,selection_state,selected_at,confirmed_at,last_error_code,updated_at)
        VALUES (?,?,?,?,?,'SYNC_PENDING',CURRENT_TIMESTAMP,NULL,NULL,CURRENT_TIMESTAMP)
        ON CONFLICT(gallery_folder_id) DO UPDATE SET event_id=excluded.event_id,selected_file_id=excluded.selected_file_id,selected_by_user_id=excluded.selected_by_user_id,selected_by_email=excluded.selected_by_email,selection_state='SYNC_PENDING',selected_at=CURRENT_TIMESTAMP,confirmed_at=NULL,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP`)
        .bind(normalized.galleryFolderId,event.id,normalized.coverFileId,actor.id,actor.email).run();
    }
    await photos.audit(actor, `gallery.${operationType.toLowerCase()}`, 'photo_gallery', completed.operation.gallery_folder_id || id, completed.operation.operation_state === 'FAILED_NEEDS_ATTENTION' ? 'FAILED' : 'SUCCEEDED', { eventId: event.id, operationId: id, state: completed.operation.operation_state });
    return { ...completed, idempotent: false };
  }
  return { endpointReady, request, browse, async list(eventId) { const rows = await database.prepare(`${select} WHERE event_id=? ORDER BY created_at DESC`).bind(eventId).all(); return rows.results || []; } };
}
