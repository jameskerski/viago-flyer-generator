import { MODULES, ROLES } from './authorization.mjs';

const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const normalizedEmail = (value) => String(value || '').trim().toLowerCase();
const stableId = async (prefix, value) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return `${prefix}-${[...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

export const PHOTO_PRESETS = Object.freeze({
  ASSIGNED: Object.freeze({ scope: 'ASSIGNED_ONLY', capabilities: ['EVENT_VIEW_ASSIGNED', 'GALLERY_UPLOAD', 'GALLERY_COVER_SELECT'] }),
  GENERAL: Object.freeze({ scope: 'ALL_CURRENT', capabilities: ['EVENT_VIEW_ASSIGNED', 'EVENT_VIEW_ALL', 'GALLERY_UPLOAD', 'GALLERY_CREATE', 'GALLERY_COVER_SELECT'] }),
  LEAD: Object.freeze({ scope: 'ALL_CURRENT_FUTURE', capabilities: ['EVENT_VIEW_ASSIGNED', 'EVENT_VIEW_ALL', 'GALLERY_UPLOAD', 'GALLERY_CREATE', 'GALLERY_RENAME', 'GALLERY_COVER_SELECT', 'EVENT_CREATE'] })
});
const profileFor = (key = 'ASSIGNED') => ({ preset: key, eventScope: PHOTO_PRESETS[key].scope, capabilities: [...PHOTO_PRESETS[key].capabilities] });

export function createPhotoRegistry(database) {
  if (!database?.prepare) throw new Error('D1 platform registry binding is required');

  async function audit(actor, operation, targetType, targetId, outcome = 'SUCCEEDED', metadata = {}, correlationId = crypto.randomUUID()) {
    await database.prepare(`INSERT INTO audit_records
      (id, actor_user_id, actor_email, module_key, operation, target_type, target_id, authorization_outcome, operation_outcome, correlation_id, safe_metadata_json)
      VALUES (?, ?, ?, 'PHOTO_STUDIO', ?, ?, ?, 'ALLOWED', ?, ?, ?)`)
      .bind(id('audit'), actor?.id || null, actor?.email || null, operation, targetType, targetId || null, outcome, correlationId, JSON.stringify(metadata)).run();
  }

  async function photographerProfile(userId) {
    const row = await database.prepare(`SELECT preset_key, event_scope, capabilities_json FROM photo_permission_profiles WHERE user_id = ?`).bind(userId).first();
    if (!row) return profileFor('ASSIGNED');
    return { preset: row.preset_key, eventScope: row.event_scope, capabilities: JSON.parse(row.capabilities_json || '[]') };
  }

  async function eventAllowed(actor, eventId) {
    if (actor.role === ROLES.PHOTO_ADMIN) return true;
    const profile = await photographerProfile(actor.id);
    if (profile.eventScope !== 'ASSIGNED_ONLY') return true;
    return Boolean(await database.prepare(`SELECT 1 FROM event_assignments WHERE user_id = ? AND event_id = ? AND status = 'ACTIVE' LIMIT 1`).bind(actor.id, eventId).first());
  }

  return {
    async bootstrap(identity, configuredEmails = '') {
      const allowed = configuredEmails.split(',').map(normalizedEmail).filter(Boolean);
      if (!allowed.includes(identity.verifiedEmail)) return;
      const binding = await database.prepare(`SELECT user_id FROM identity_bindings WHERE provider = ? AND issuer = ? AND provider_subject = ? AND status = 'ACTIVE'`).bind(identity.provider, identity.issuer, identity.providerSubject).first();
      const identityKey = `${identity.provider}:${identity.issuer}:${identity.providerSubject}`;
      const userId = binding?.user_id || await stableId('user', identityKey);
      await database.batch([
        database.prepare(`INSERT OR IGNORE INTO platform_users (id, display_name, status) VALUES (?, ?, 'ACTIVE')`).bind(userId, identity.displayName),
        database.prepare(`INSERT OR IGNORE INTO identity_bindings (id, user_id, provider, issuer, provider_subject, verified_email, status, last_authenticated_at) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`).bind(await stableId('identity', identityKey), userId, identity.provider, identity.issuer, identity.providerSubject, identity.verifiedEmail),
        database.prepare(`INSERT OR IGNORE INTO module_grants (id, user_id, module_key, role_key, status) VALUES (?, ?, ?, ?, 'ACTIVE')`).bind(await stableId('grant', `${userId}:${MODULES.PHOTO_STUDIO}`), userId, MODULES.PHOTO_STUDIO, ROLES.PHOTO_ADMIN),
        database.prepare(`INSERT OR IGNORE INTO module_grants (id, user_id, module_key, role_key, status) VALUES (?, ?, ?, ?, 'ACTIVE')`).bind(await stableId('grant', `${userId}:${MODULES.TEMPLATE_STUDIO}`), userId, MODULES.TEMPLATE_STUDIO, ROLES.TEMPLATE_ADMIN)
      ]);
    },

    async claimInvitation(identity) {
      const invitation = await database.prepare(`SELECT * FROM invitations WHERE normalized_email = ? AND module_key = 'PHOTO_STUDIO' AND status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP ORDER BY created_at LIMIT 1`).bind(identity.verifiedEmail).first();
      if (!invitation) return false;
      let user = await database.prepare(`SELECT u.id FROM identity_bindings i JOIN platform_users u ON u.id = i.user_id WHERE i.provider = ? AND i.issuer = ? AND i.provider_subject = ? LIMIT 1`).bind(identity.provider, identity.issuer, identity.providerSubject).first();
      const userId = user?.id || id('user');
      const statements = [];
      if (!user) {
        statements.push(database.prepare(`INSERT INTO platform_users (id, display_name, status) VALUES (?, ?, 'ACTIVE')`).bind(userId, identity.displayName));
        statements.push(database.prepare(`INSERT INTO identity_bindings (id, user_id, provider, issuer, provider_subject, verified_email, status, last_authenticated_at) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`).bind(id('identity'), userId, identity.provider, identity.issuer, identity.providerSubject, identity.verifiedEmail));
      }
      const assigned = profileFor('ASSIGNED');
      statements.push(database.prepare(`INSERT OR REPLACE INTO module_grants (id, user_id, module_key, role_key, status) VALUES (COALESCE((SELECT id FROM module_grants WHERE user_id = ? AND module_key = 'PHOTO_STUDIO'), ?), ?, 'PHOTO_STUDIO', 'PHOTOGRAPHER', 'ACTIVE')`).bind(userId, id('grant'), userId));
      statements.push(database.prepare(`INSERT OR REPLACE INTO photo_permission_profiles (user_id, preset_key, event_scope, capabilities_json, updated_at) VALUES (?, 'ASSIGNED', 'ASSIGNED_ONLY', ?, CURRENT_TIMESTAMP)`).bind(userId, JSON.stringify(assigned.capabilities)));
      statements.push(database.prepare(`UPDATE invitations SET status = 'CLAIMED', claimed_by_user_id = ?, claimed_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(userId, invitation.id));
      await database.batch(statements);
      return true;
    },

    photographerProfile,
    async canCreateEvent(actor) {
      if (actor.role === ROLES.PHOTO_ADMIN) return true;
      const profile = await photographerProfile(actor.id);
      return profile.capabilities.includes('EVENT_CREATE');
    },
    eventAllowed,

    async listEvents(actor) {
      const profile = actor.role === ROLES.PHOTO_ADMIN ? null : await photographerProfile(actor.id);
      const assignedOnly = actor.role !== ROLES.PHOTO_ADMIN && profile.eventScope === 'ASSIGNED_ONLY';
      const query = database.prepare(`SELECT e.*, (SELECT COUNT(*) FROM photo_galleries g WHERE g.event_id = e.id AND g.active = 1) AS discovered_gallery_records FROM photo_events e WHERE e.active = 1 ${assignedOnly ? `AND e.id IN (SELECT event_id FROM event_assignments WHERE user_id = ? AND status = 'ACTIVE')` : ''} ORDER BY e.event_year DESC, e.public_name`);
      const result = assignedOnly ? await query.bind(actor.id).all() : await query.all();
      return result.results || [];
    },

    async event(actor, eventId) {
      if (!(await eventAllowed(actor, eventId))) return null;
      const event = await database.prepare(`SELECT * FROM photo_events WHERE id = ? AND active = 1`).bind(eventId).first();
      if (!event) return null;
      const galleries = await database.prepare(`SELECT g.*,c.selection_state AS cover_selection_state,c.selected_file_id AS pending_cover_file_id FROM photo_galleries g LEFT JOIN photo_gallery_cover_selections c ON c.gallery_folder_id=g.drive_folder_id WHERE g.event_id = ? AND g.active = 1 ORDER BY g.display_order, g.public_name`).bind(eventId).all();
      const profile = actor.role === ROLES.PHOTO_ADMIN ? { capabilities: ['GALLERY_CREATE','GALLERY_RENAME','GALLERY_COVER_SELECT'] } : await photographerProfile(actor.id);
      return { ...event, galleries: galleries.results || [], capabilities: profile.capabilities || [] };
    },

    async overview() {
      const events = await database.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(gallery_count),0) AS galleries, COALESCE(SUM(photo_count),0) AS photos, MAX(last_reconciled_at) AS last_reconciled_at FROM photo_events WHERE active = 1`).first();
      const photographers = await database.prepare(`SELECT COUNT(*) AS count FROM module_grants g JOIN platform_users u ON u.id = g.user_id WHERE g.module_key = 'PHOTO_STUDIO' AND g.role_key = 'PHOTOGRAPHER' AND g.status = 'ACTIVE' AND u.status = 'ACTIVE'`).first();
      return { events: events.count, galleries: events.galleries, photos: events.photos, photographers: photographers.count, lastReconciledAt: events.last_reconciled_at };
    },

    async listPhotographers() {
      const result = await database.prepare(`SELECT u.id, u.display_name, u.status, i.verified_email AS email, p.preset_key, p.event_scope, p.capabilities_json,
        GROUP_CONCAT(DISTINCT a.event_id) AS event_ids FROM platform_users u JOIN module_grants g ON g.user_id = u.id
        LEFT JOIN identity_bindings i ON i.user_id = u.id AND i.status = 'ACTIVE'
        LEFT JOIN event_assignments a ON a.user_id = u.id AND a.status = 'ACTIVE'
        LEFT JOIN photo_permission_profiles p ON p.user_id = u.id
        WHERE g.module_key = 'PHOTO_STUDIO' AND g.role_key = 'PHOTOGRAPHER' GROUP BY u.id ORDER BY u.display_name`).all();
      return (result.results || []).map((row) => ({ ...row, preset_key: row.preset_key || 'ASSIGNED', event_scope: row.event_scope || 'ASSIGNED_ONLY', capabilities: JSON.parse(row.capabilities_json || JSON.stringify(PHOTO_PRESETS.ASSIGNED.capabilities)) }));
    },

    async futureAccessUserIds() {
      const result = await database.prepare(`SELECT p.user_id FROM photo_permission_profiles p JOIN platform_users u ON u.id=p.user_id JOIN module_grants g ON g.user_id=p.user_id AND g.module_key='PHOTO_STUDIO' AND g.role_key='PHOTOGRAPHER' AND g.status='ACTIVE' WHERE p.event_scope IN ('ALL_CURRENT','ALL_CURRENT_FUTURE') AND u.status='ACTIVE'`).all();
      return (result.results || []).map((row) => row.user_id);
    },

    async invite(actor, { email }) {
      const normalized = normalizedEmail(email);
      if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error('A valid Google account email is required');
      const invitationId = id('invite');
      await database.prepare(`INSERT INTO invitations (id, normalized_email, module_key, role_key, event_id, status, expires_at) VALUES (?, ?, 'PHOTO_STUDIO', 'PHOTOGRAPHER', NULL, 'PENDING', datetime('now', '+14 days'))`).bind(invitationId, normalized).run();
      await audit(actor, 'photographer.invite', 'invitation', invitationId, 'SUCCEEDED', { email: normalized, preset: 'ASSIGNED', assignmentCount: 0 });
      return { id: invitationId, email: normalized, preset: 'ASSIGNED', eventIds: [], status: 'PENDING' };
    },

    async setPermissionProfile(actor, userId, presetKey) {
      const key = String(presetKey || '').toUpperCase();
      const preset = PHOTO_PRESETS[key];
      if (!preset) throw new Error('Invalid photographer permission preset');
      const target = await database.prepare(`SELECT 1 FROM module_grants WHERE user_id = ? AND module_key = 'PHOTO_STUDIO' AND role_key = 'PHOTOGRAPHER'`).bind(userId).first();
      if (!target) throw new Error('Photographer not found');
      await database.prepare(`INSERT OR REPLACE INTO photo_permission_profiles (user_id, preset_key, event_scope, capabilities_json, updated_by_user_id, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).bind(userId, key, preset.scope, JSON.stringify(preset.capabilities), actor.id).run();
      await audit(actor, 'photographer.permissions', 'user', userId, 'SUCCEEDED', { preset: key, eventScope: preset.scope, capabilities: preset.capabilities });
      return { userId, preset: key, eventScope: preset.scope };
    },

    async setUserStatus(actor, userId, status) {
      if (!['ACTIVE', 'INACTIVE', 'REVOKED'].includes(status)) throw new Error('Invalid account status');
      await database.prepare(`UPDATE platform_users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(status, userId).run();
      await audit(actor, 'photographer.status', 'user', userId, 'SUCCEEDED', { status });
      return { userId, status };
    },

    async setAssignment(actor, userId, eventId, active) {
      if (!(await database.prepare(`SELECT id FROM photo_events WHERE id = ? AND active = 1`).bind(eventId).first())) throw new Error('Event not found');
      if (active) await database.prepare(`INSERT OR REPLACE INTO event_assignments (id, user_id, event_id, permission_key, status) VALUES (COALESCE((SELECT id FROM event_assignments WHERE user_id = ? AND event_id = ? AND permission_key = 'PHOTO_UPLOAD'), ?), ?, ?, 'PHOTO_UPLOAD', 'ACTIVE')`).bind(userId, eventId, id('assignment'), userId, eventId).run();
      else await database.prepare(`UPDATE event_assignments SET status = 'REVOKED', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND event_id = ?`).bind(userId, eventId).run();
      await audit(actor, active ? 'assignment.grant' : 'assignment.revoke', 'event_assignment', `${userId}:${eventId}`, 'SUCCEEDED', { userId, eventId });
      return { userId, eventId, active };
    },

    async activity() {
      const result = await database.prepare(`SELECT occurred_at, actor_email, operation, target_type, target_id, operation_outcome, safe_metadata_json FROM audit_records WHERE module_key = 'PHOTO_STUDIO' ORDER BY occurred_at DESC LIMIT 100`).all();
      return result.results || [];
    },

    async mediaAssets() {
      const result = await database.prepare(`SELECT * FROM media_asset_collections ORDER BY public_name`).all();
      return result.results || [];
    },
    audit
  };
}
