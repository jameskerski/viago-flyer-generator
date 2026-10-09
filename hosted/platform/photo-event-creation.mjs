const TYPES = new Set(['SIGNATURE_EVENT', 'TRIP_INCENTIVE', 'WELLNESS_ESCAPE', 'SPECIAL_EVENT', 'OTHER']);
export const CREATION_STATES = Object.freeze(['REQUESTED', 'VALIDATED', 'DRIVE_ROOT_CREATED', 'WIX_EVENT_REGISTERED', 'VERIFIED', 'READY_FOR_PUBLICATION', 'FAILED_NEEDS_ATTENTION']);
const clean = (value, maximum = 160) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maximum);
const date = (value) => { const normalized = clean(value, 10); if (!normalized) return ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) throw new Error('invalid_date'); return normalized; };
const safeUrl = (value) => { const normalized = clean(value, 2048); if (!normalized) return ''; const parsed = new URL(normalized); if (parsed.protocol !== 'https:') throw new Error('invalid_artwork_url'); return parsed.href; };
export function normalizeEventCreation(input = {}) {
  const eventName = clean(input.eventName); const eventSeries = clean(input.eventSeries, 100); const region = clean(input.region, 100); const eventYear = Number(input.eventYear); const eventType = clean(input.eventType, 40).toUpperCase(); const startDate = date(input.startDate); const endDate = date(input.endDate);
  if (!eventName || eventName.length < 2) throw new Error('event_name_required');
  if (!Number.isInteger(eventYear) || eventYear < 2020 || eventYear > 2100) throw new Error('invalid_event_year');
  if (!TYPES.has(eventType)) throw new Error('invalid_event_type');
  if (startDate && endDate && endDate < startDate) throw new Error('end_date_before_start_date');
  if (eventType === 'SIGNATURE_EVENT' && !eventSeries) throw new Error('signature_series_required');
  return { eventName, eventSeries, region, eventYear, eventType, startDate, endDate, location: clean(input.location, 180), artworkUrl: safeUrl(input.artworkUrl) };
}
export async function creationRequestHash(input) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input))); return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
export function creationQualification(env = {}) {
  const endpoint = Boolean(env.PHOTO_EVENT_PROVISION_ENDPOINT); const secret = Boolean(env.PHOTO_STUDIO_SYNC_SECRET); const blockers = [];
  if (!endpoint) blockers.push('The governed Apps Script event-provisioning endpoint is not configured.');
  if (!secret) blockers.push('The server-side Photo Studio synchronization credential is not configured.');
  return { enabled: endpoint && secret, drive: endpoint && secret, wix: endpoint && secret, parentMap: endpoint, blockers };
}
const operationId = () => `event-create-${crypto.randomUUID()}`;
const select = `SELECT id, idempotency_key, requested_by_user_id, operation_state, event_name, event_series, region, event_year, event_type, start_date, end_date, location, artwork_url, drive_parent_key, drive_root_folder_id, drive_root_url, wix_item_id, safe_error_code, safe_error_message, retry_count, created_at, updated_at, verified_at FROM photo_event_creation_operations`;
async function provision(env, action, operation) {
  const response = await fetch(env.PHOTO_EVENT_PROVISION_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: env.PHOTO_STUDIO_SYNC_SECRET, action, operationId: operation.id, event: { eventName: operation.event_name, eventSeries: operation.event_series, region: operation.region, eventYear: operation.event_year, eventType: operation.event_type, startDate: operation.start_date, endDate: operation.end_date, location: operation.location, artworkUrl: operation.artwork_url }, driveRootFolderId: operation.drive_root_folder_id, driveRootUrl: operation.drive_root_url, wixItemId: operation.wix_item_id }) });
  let payload = {}; try { payload = await response.json(); } catch {}
  if (!response.ok || payload.success !== true) throw new Error(payload.error || payload.message || `provisioning_http_${response.status}`);
  return payload;
}
export function createPhotoEventCreationRegistry(database, env = {}) {
  if (!database?.prepare) throw new Error('platform_database_missing'); const qualification = creationQualification(env);
  const get = (id) => database.prepare(`${select} WHERE id = ?`).bind(id).first();
  async function advance(id, state, fields = {}) { await database.prepare(`UPDATE photo_event_creation_operations SET operation_state = ?, drive_parent_key = COALESCE(?, drive_parent_key), drive_root_folder_id = COALESCE(?, drive_root_folder_id), drive_root_url = COALESCE(?, drive_root_url), wix_item_id = COALESCE(?, wix_item_id), safe_error_code = NULL, safe_error_message = NULL, updated_at = CURRENT_TIMESTAMP, verified_at = CASE WHEN ? = 'VERIFIED' THEN CURRENT_TIMESTAMP ELSE verified_at END WHERE id = ?`).bind(state, fields.driveParentKey || null, fields.driveRootFolderId || null, fields.driveRootUrl || null, fields.wixItemId || null, state, id).run(); return get(id); }
  async function run(operation) {
    if (!qualification.enabled) return { operation, resumed: false, qualification };
    try {
      let current = operation;
      if (current.operation_state === 'VALIDATED' || current.operation_state === 'FAILED_NEEDS_ATTENTION') current = await advance(current.id, 'DRIVE_ROOT_CREATED', await provision(env, 'CREATE_DRIVE_ROOT', current));
      if (current.operation_state === 'DRIVE_ROOT_CREATED') current = await advance(current.id, 'WIX_EVENT_REGISTERED', await provision(env, 'REGISTER_WIX_EVENT', current));
      if (current.operation_state === 'WIX_EVENT_REGISTERED') current = await advance(current.id, 'VERIFIED', await provision(env, 'VERIFY_EVENT', current));
      if (current.operation_state === 'VERIFIED') current = await advance(current.id, 'READY_FOR_PUBLICATION');
      return { operation: current, resumed: true, qualification };
    } catch (error) {
      await database.prepare(`UPDATE photo_event_creation_operations SET operation_state = 'FAILED_NEEDS_ATTENTION', safe_error_code = 'PROVISIONING_FAILED', safe_error_message = ?, retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(clean(error.message, 400), operation.id).run();
      return { operation: await get(operation.id), resumed: false, qualification };
    }
  }
  return {
    qualification,
    async list(actor) { const result = actor.role === 'PHOTO_ADMIN' ? await database.prepare(`${select} ORDER BY created_at DESC LIMIT 100`).all() : await database.prepare(`${select} WHERE requested_by_user_id = ? ORDER BY created_at DESC LIMIT 100`).bind(actor.id).all(); return result.results || []; },
    async request(actor, raw, idempotencyKey) {
      const input = normalizeEventCreation(raw); const key = clean(idempotencyKey, 128); if (key.length < 16) throw new Error('idempotency_key_required'); const hash = await creationRequestHash(input);
      const existing = await database.prepare(`${select} WHERE idempotency_key = ? LIMIT 1`).bind(key).first();
      if (existing) { const stored = await database.prepare(`SELECT request_hash FROM photo_event_creation_operations WHERE id = ?`).bind(existing.id).first(); if (stored.request_hash !== hash) throw new Error('idempotency_key_conflict'); return { operation: existing, idempotent: true, qualification }; }
      const duplicate = await database.prepare(`SELECT id FROM photo_event_creation_operations WHERE lower(event_name) = lower(?) AND event_year = ? AND lower(event_series) = lower(?) AND lower(region) = lower(?) AND operation_state != 'FAILED_NEEDS_ATTENTION' LIMIT 1`).bind(input.eventName, input.eventYear, input.eventSeries, input.region).first();
      if (duplicate) throw new Error('duplicate_event_operation'); const id = operationId();
      await database.prepare(`INSERT INTO photo_event_creation_operations (id, idempotency_key, request_hash, requested_by_user_id, requested_by_email, operation_state, event_name, event_series, region, event_year, event_type, start_date, end_date, location, artwork_url) VALUES (?, ?, ?, ?, ?, 'VALIDATED', ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?)`).bind(id, key, hash, actor.id, actor.email, input.eventName, input.eventSeries, input.region, input.eventYear, input.eventType, input.startDate, input.endDate, input.location, input.artworkUrl).run();
      return { ...(await run(await get(id))), idempotent: false };
    },
    async retry(actor, id) { const operation = await get(id); if (!operation) throw new Error('operation_not_found'); if (actor.role !== 'PHOTO_ADMIN' && operation.requested_by_user_id !== actor.id) throw new Error('operation_not_owned'); return run(operation); }
  };
}
