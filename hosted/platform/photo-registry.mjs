import { MODULES, ROLES } from './authorization.mjs';

const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const normalizedEmail = (value) => String(value || '').trim().toLowerCase();
const stableId = async (prefix, value) => {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `${prefix}-${[...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

export function createPhotoRegistry(database) {
  if (!database?.prepare) throw new Error('D1 platform registry binding is required');

  async function audit(actor, operation, targetType, targetId, outcome = 'SUCCEEDED', metadata = {}) {
    await database.prepare(`INSERT INTO audit_records
      (id, actor_user_id, actor_email, module_key, operation, target_type, target_id, authorization_outcome, operation_outcome, correlation_id, safe_metadata_json)
      VALUES (?, ?, ?, 'PHOTO_STUDIO', ?, ?, ?, 'ALLOWED', ?, ?, ?)`)
      .bind(id('audit'), actor?.id || null, actor?.email || null, operation, targetType, targetId || null, outcome, crypto.randomUUID(), JSON.stringify(metadata)).run();
  }

  return {
    async bootstrap(identity, configuredEmails = '') {
      const allowed = configuredEmails.split(',').map(normalizedEmail).filter(Boolean);
      if (!allowed.includes(identity.verifiedEmail)) return;
      const binding = await database.prepare(`SELECT user_id FROM identity_bindings WHERE provider = ? AND issuer = ? AND provider_subject = ? AND status = 'ACTIVE'`)
        .bind(identity.provider, identity.issuer, identity.providerSubject).first();
      if (binding) return;
      const identityKey = `${identity.provider}:${identity.issuer}:${identity.providerSubject}`;
      const userId = await stableId('user', identityKey);
      const identityId = await stableId('identity', identityKey);
      const grantId = await stableId('grant', `${userId}:${MODULES.PHOTO_STUDIO}`);
      await database.batch([
        database.prepare(`INSERT OR IGNORE INTO platform_users (id, display_name, status) VALUES (?, ?, 'ACTIVE')`).bind(userId, identity.displayName),
        database.prepare(`INSERT OR IGNORE INTO identity_bindings (id, user_id, provider, issuer, provider_subject, verified_email, status, last_authenticated_at) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`).bind(identityId, userId, identity.provider, identity.issuer, identity.providerSubject, identity.verifiedEmail),
        database.prepare(`INSERT OR IGNORE INTO module_grants (id, user_id, module_key, role_key, status) VALUES (?, ?, ?, ?, 'ACTIVE')`).bind(grantId, userId, MODULES.PHOTO_STUDIO, ROLES.PHOTO_ADMIN)
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
      statements.push(database.prepare(`INSERT OR REPLACE INTO module_grants (id, user_id, module_key, role_key, status) VALUES (COALESCE((SELECT id FROM module_grants WHERE user_id = ? AND module_key = 'PHOTO_STUDIO'), ?), ?, 'PHOTO_STUDIO', ?, 'ACTIVE')`).bind(userId, id('grant'), userId, invitation.role_key));
      if (invitation.event_id) statements.push(database.prepare(`INSERT OR REPLACE INTO event_assignments (id, user_id, event_id, permission_key, status) VALUES (COALESCE((SELECT id FROM event_assignments WHERE user_id = ? AND event_id = ? AND permission_key = 'PHOTO_UPLOAD'), ?), ?, ?, 'PHOTO_UPLOAD', 'ACTIVE')`).bind(userId, invitation.event_id, id('assignment'), userId, invitation.event_id));
      statements.push(database.prepare(`UPDATE invitations SET status = 'CLAIMED', claimed_by_user_id = ?, claimed_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(userId, invitation.id));
      await database.batch(statements);
      return true;
    },

    async listEvents(actor) {
      const where = actor.role === ROLES.PHOTO_ADMIN ? '' : `AND e.id IN (SELECT event_id FROM event_assignments WHERE user_id = ? AND status = 'ACTIVE')`;
      const query = database.prepare(`SELECT e.*, (SELECT COUNT(*) FROM photo_galleries g WHERE g.event_id = e.id AND g.active = 1) AS discovered_gallery_records FROM photo_events e WHERE e.active = 1 ${where} ORDER BY e.event_year DESC, e.public_name`);
      const result = actor.role === ROLES.PHOTO_ADMIN ? await query.all() : await query.bind(actor.id).all();
      return result.results || [];
    },

    async event(actor, eventId) {
      const event = await database.prepare(`SELECT * FROM photo_events WHERE id = ? AND active = 1`).bind(eventId).first();
      if (!event) return null;
      const galleries = await database.prepare(`SELECT * FROM photo_galleries WHERE event_id = ? AND active = 1 ORDER BY public_name`).bind(eventId).all();
      return { ...event, galleries: galleries.results || [] };
    },

    async overview() {
      const events = await database.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(gallery_count),0) AS galleries, COALESCE(SUM(photo_count),0) AS photos FROM photo_events WHERE active = 1`).first();
      const photographers = await database.prepare(`SELECT COUNT(*) AS count FROM module_grants g JOIN platform_users u ON u.id = g.user_id WHERE g.module_key = 'PHOTO_STUDIO' AND g.role_key = 'PHOTOGRAPHER' AND g.status = 'ACTIVE' AND u.status = 'ACTIVE'`).first();
      return { events: events.count, galleries: events.galleries, photos: events.photos, photographers: photographers.count };
    },

    async listPhotographers() {
      const result = await database.prepare(`SELECT u.id, u.display_name, u.status, i.verified_email AS email,
        GROUP_CONCAT(DISTINCT a.event_id) AS event_ids
        FROM platform_users u JOIN module_grants g ON g.user_id = u.id
        LEFT JOIN identity_bindings i ON i.user_id = u.id AND i.status = 'ACTIVE'
        LEFT JOIN event_assignments a ON a.user_id = u.id AND a.status = 'ACTIVE'
        WHERE g.module_key = 'PHOTO_STUDIO' AND g.role_key = 'PHOTOGRAPHER'
        GROUP BY u.id ORDER BY u.display_name`).all();
      return result.results || [];
    },

    async invite(actor, { email, eventId }) {
      const normalized = normalizedEmail(email);
      if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error('A valid Google account email is required');
      if (!eventId || !(await database.prepare(`SELECT id FROM photo_events WHERE id = ? AND active = 1`).bind(eventId).first())) throw new Error('Select an active event');
      const invitationId = id('invite');
      await database.prepare(`INSERT INTO invitations (id, normalized_email, module_key, role_key, event_id, status, expires_at) VALUES (?, ?, 'PHOTO_STUDIO', 'PHOTOGRAPHER', ?, 'PENDING', datetime('now', '+14 days'))`).bind(invitationId, normalized, eventId).run();
      await audit(actor, 'photographer.invite', 'invitation', invitationId, 'SUCCEEDED', { email: normalized, eventId });
      return { id: invitationId, email: normalized, eventId, status: 'PENDING' };
    },

    async setUserStatus(actor, userId, status) {
      if (!['ACTIVE', 'INACTIVE', 'REVOKED'].includes(status)) throw new Error('Invalid account status');
      await database.prepare(`UPDATE platform_users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(status, userId).run();
      await audit(actor, 'photographer.status', 'user', userId, 'SUCCEEDED', { status });
    },

    async setAssignment(actor, userId, eventId, active) {
      if (active) await database.prepare(`INSERT OR REPLACE INTO event_assignments (id, user_id, event_id, permission_key, status) VALUES (COALESCE((SELECT id FROM event_assignments WHERE user_id = ? AND event_id = ? AND permission_key = 'PHOTO_UPLOAD'), ?), ?, ?, 'PHOTO_UPLOAD', 'ACTIVE')`).bind(userId, eventId, id('assignment'), userId, eventId).run();
      else await database.prepare(`UPDATE event_assignments SET status = 'REVOKED', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND event_id = ?`).bind(userId, eventId).run();
      await audit(actor, active ? 'assignment.grant' : 'assignment.revoke', 'event_assignment', `${userId}:${eventId}`, 'SUCCEEDED');
    },

    async activity() {
      const result = await database.prepare(`SELECT occurred_at, actor_email, operation, target_type, target_id, operation_outcome, safe_metadata_json FROM audit_records WHERE module_key = 'PHOTO_STUDIO' ORDER BY occurred_at DESC LIMIT 30`).all();
      return result.results || [];
    }
  };
}
