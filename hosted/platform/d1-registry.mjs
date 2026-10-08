export function createD1Registry(database) {
  if (!database?.prepare) throw new Error('D1 platform registry binding is required');
  return {
    async resolveIdentity(identity) {
      if (!identity.providerSubject) return null;
      const binding = await database.prepare(`
        SELECT u.id, u.display_name AS displayName, u.status
        FROM identity_bindings i
        JOIN platform_users u ON u.id = i.user_id
        WHERE i.provider = ? AND i.issuer = ? AND i.provider_subject = ? AND i.status = 'ACTIVE'
        LIMIT 1
      `).bind(identity.provider, identity.issuer, identity.providerSubject).first();
      if (!binding) return null;
      const grants = await database.prepare(`
        SELECT module_key AS module, role_key AS role, status
        FROM module_grants WHERE user_id = ?
      `).bind(binding.id).all();
      const assignments = await database.prepare(`
        SELECT event_id AS eventId, permission_key AS permission, status
        FROM event_assignments WHERE user_id = ?
      `).bind(binding.id).all();
      return { ...binding, moduleGrants: grants.results || [], eventAssignments: assignments.results || [] };
    }
  };
}
