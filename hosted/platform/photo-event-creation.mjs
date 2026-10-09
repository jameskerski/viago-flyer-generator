const TYPES = new Set(['SIGNATURE_EVENT', 'TRIP_INCENTIVE', 'WELLNESS_ESCAPE', 'SPECIAL_EVENT', 'OTHER']);
export const CREATION_STATES = Object.freeze([
  'REQUESTED', 'VALIDATED', 'DRIVE_ROOT_CREATED', 'WIX_EVENT_REGISTERED',
  'VERIFIED', 'READY_FOR_PUBLICATION', 'FAILED_NEEDS_ATTENTION'
]);

const clean = (value, maximum = 160) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maximum);
const date = (value) => {
  const normalized = clean(value, 10);
  if (!normalized) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) throw new Error('invalid_date');
  return normalized;
};
const safeUrl = (value) => {
  const normalized = clean(value, 2048);
  if (!normalized) return '';
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'https:') throw new Error('invalid_artwork_url');
  return parsed.href;
};

export function normalizeEventCreation(input = {}) {
  const eventName = clean(input.eventName);
  const eventSeries = clean(input.eventSeries, 100);
  const region = clean(input.region, 100);
  const eventYear = Number(input.eventYear);
  const eventType = clean(input.eventType, 40).toUpperCase();
  const startDate = date(input.startDate);
  const endDate = date(input.endDate);
  if (!eventName || eventName.length < 2) throw new Error('event_name_required');
  if (!Number.isInteger(eventYear) || eventYear < 2020 || eventYear > 2100) throw new Error('invalid_event_year');
  if (!TYPES.has(eventType)) throw new Error('invalid_event_type');
  if (startDate && endDate && endDate < startDate) throw new Error('end_date_before_start_date');
  if (eventType === 'SIGNATURE_EVENT' && !eventSeries) throw new Error('signature_series_required');
  return {
    eventName, eventSeries, region, eventYear, eventType, startDate, endDate,
    location: clean(input.location, 180), artworkUrl: safeUrl(input.artworkUrl)
  };
}

export async function creationRequestHash(input) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function creationQualification(env = {}) {
  const drive = Boolean(env.PHOTO_EVENT_DRIVE_PROVISION_ENDPOINT && env.PHOTO_EVENT_DRIVE_PROVISION_SECRET);
  const wix = Boolean(env.PHOTO_EVENT_WIX_REGISTER_ENDPOINT && env.PHOTO_EVENT_WIX_REGISTER_SECRET);
  const parentMap = Boolean(env.PHOTO_EVENT_DRIVE_PARENT_MAP);
  const blockers = [];
  if (!drive) blockers.push('Authorized Drive event-root provisioning is not configured.');
  if (!parentMap) blockers.push('The server-side event parent-folder map is not configured.');
  if (!wix) blockers.push('Qualified Wix PHOTO_EVENT_YEARS registration is not configured.');
  return { enabled: drive && wix && parentMap, drive, wix, parentMap, blockers };
}

const operationId = () => `event-create-${crypto.randomUUID()}`;

export function createPhotoEventCreationRegistry(database, env = {}) {
  if (!database?.prepare) throw new Error('platform_database_missing');
  const qualification = creationQualification(env);
  const select = `SELECT id, idempotency_key, requested_by_user_id, operation_state, event_name, event_series, region, event_year, event_type,
    start_date, end_date, location, artwork_url, drive_root_folder_id, drive_root_url, wix_item_id,
    safe_error_code, safe_error_message, retry_count, created_at, updated_at, verified_at
    FROM photo_event_creation_operations`;
  return {
    qualification,
    async list(actor) {
      const result = actor.role === 'PHOTO_ADMIN'
        ? await database.prepare(`${select} ORDER BY created_at DESC LIMIT 100`).all()
        : await database.prepare(`${select} WHERE requested_by_user_id = ? ORDER BY created_at DESC LIMIT 100`).bind(actor.id).all();
      return result.results || [];
    },
    async request(actor, raw, idempotencyKey) {
      const input = normalizeEventCreation(raw);
      const key = clean(idempotencyKey, 128);
      if (key.length < 16) throw new Error('idempotency_key_required');
      const hash = await creationRequestHash(input);
      const existing = await database.prepare(`${select} WHERE idempotency_key = ? LIMIT 1`).bind(key).first();
      if (existing) {
        const stored = await database.prepare(`SELECT request_hash FROM photo_event_creation_operations WHERE id = ?`).bind(existing.id).first();
        if (stored.request_hash !== hash) throw new Error('idempotency_key_conflict');
        return { operation: existing, idempotent: true, qualification };
      }
      const duplicate = await database.prepare(`SELECT id FROM photo_event_creation_operations WHERE lower(event_name) = lower(?) AND event_year = ? AND lower(event_series) = lower(?) AND lower(region) = lower(?) AND operation_state != 'FAILED_NEEDS_ATTENTION' LIMIT 1`).bind(input.eventName, input.eventYear, input.eventSeries, input.region).first();
      if (duplicate) throw new Error('duplicate_event_operation');
      const id = operationId();
      await database.prepare(`INSERT INTO photo_event_creation_operations
        (id, idempotency_key, request_hash, requested_by_user_id, requested_by_email, operation_state,
         event_name, event_series, region, event_year, event_type, start_date, end_date, location, artwork_url)
        VALUES (?, ?, ?, ?, ?, 'REQUESTED', ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?)`)
        .bind(id, key, hash, actor.id, actor.email, input.eventName, input.eventSeries, input.region, input.eventYear, input.eventType, input.startDate, input.endDate, input.location, input.artworkUrl).run();
      const blocker = qualification.enabled ? null : qualification.blockers.join(' ');
      await database.prepare(`UPDATE photo_event_creation_operations SET operation_state = 'VALIDATED', safe_error_code = ?, safe_error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(blocker ? 'PROVISIONING_NOT_QUALIFIED' : null, blocker, id).run();
      const operation = await database.prepare(`${select} WHERE id = ?`).bind(id).first();
      return { operation, idempotent: false, qualification };
    },
    async retry(actor, id) {
      const operation = await database.prepare(`${select} WHERE id = ?`).bind(id).first();
      if (!operation) throw new Error('operation_not_found');
      if (actor.role !== 'PHOTO_ADMIN' && operation.requested_by_user_id !== actor.id) throw new Error('operation_not_owned');
      if (!qualification.enabled) return { operation, resumed: false, qualification };
      throw new Error('provisioning_adapter_not_implemented');
    }
  };
}
