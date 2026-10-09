const clean = (value, maximum = 300) => String(value ?? '').trim().slice(0, maximum);
const operationId = (type = 'drive-access') => `${type}-${crypto.randomUUID()}`;

async function appsRequest(env, action, input = {}) {
  if (!env.PHOTO_EVENT_PROVISION_ENDPOINT || !env.PHOTO_STUDIO_SYNC_SECRET) throw new Error('drive_access_integration_unavailable');
  const response = await fetch(env.PHOTO_EVENT_PROVISION_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: env.PHOTO_STUDIO_SYNC_SECRET, action, operationId: operationId(action === 'AUDIT_DRIVE_ROOTS' ? 'drive-audit' : 'drive-access'), ...input })
  });
  let payload = {}; try { payload = await response.json(); } catch {}
  if (!response.ok || payload.success !== true) throw new Error(clean(payload.error || `drive_access_http_${response.status}`));
  return payload;
}

export function createPhotoDriveAccess(database, env, photos) {
  if (!database?.prepare) throw new Error('platform_database_missing');
  const qualified = env.PHOTO_DRIVE_ACCESS_ENABLED === 'true';

  async function target(userId) {
    const row = await database.prepare(`SELECT u.id,u.status,i.verified_email AS email,g.status AS grant_status,
      COALESCE(p.preset_key,'ASSIGNED') AS preset_key,COALESCE(p.event_scope,'ASSIGNED_ONLY') AS event_scope
      FROM platform_users u
      JOIN module_grants g ON g.user_id=u.id AND g.module_key='PHOTO_STUDIO' AND g.role_key='PHOTOGRAPHER'
      LEFT JOIN identity_bindings i ON i.user_id=u.id AND i.status='ACTIVE'
      LEFT JOIN photo_permission_profiles p ON p.user_id=u.id WHERE u.id=? LIMIT 1`).bind(userId).first();
    if (!row || !row.email) throw new Error('photographer_verified_identity_required');
    return row;
  }

  async function desiredEvents(person) {
    if (person.status !== 'ACTIVE' || person.grant_status !== 'ACTIVE') return [];
    if (person.event_scope !== 'ASSIGNED_ONLY') {
      const all = await database.prepare(`SELECT id,wix_item_id,public_name,all_photos_url FROM photo_events WHERE active=1 AND all_photos_url IS NOT NULL ORDER BY id`).all();
      return all.results || [];
    }
    const assigned = await database.prepare(`SELECT e.id,e.wix_item_id,e.public_name,e.all_photos_url FROM photo_events e JOIN event_assignments a ON a.event_id=e.id WHERE a.user_id=? AND a.status='ACTIVE' AND e.active=1 AND e.all_photos_url IS NOT NULL ORDER BY e.id`).bind(person.id).all();
    return assigned.results || [];
  }

  async function recordOperation(actor, person, event, type, state, result = {}, error = '') {
    const id = operationId();
    await database.prepare(`INSERT INTO photo_drive_access_operations (id,user_id,event_id,requested_by_user_id,operation_type,operation_state,permission_id,safe_result_json,safe_error,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(id,person?.id || null,event?.id || null,actor?.id || null,type,state,result.permissionId || null,JSON.stringify(result),error || null).run();
    return id;
  }

  async function grant(actor, person, event) {
    try {
      const result = await appsRequest(env, 'GRANT_DRIVE_ACCESS', { wixItemId: event.wix_item_id, email: person.email });
      const origin = result.studioManaged ? 'STUDIO_MANAGED' : result.inherited ? 'INHERITED' : 'PRE_EXISTING';
      await database.prepare(`INSERT INTO photo_drive_access_grants (id,user_id,event_id,verified_email,drive_folder_id,permission_id,access_role,grant_origin,operation_state,inherited_from,granted_at,last_verified_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(user_id,event_id) DO UPDATE SET verified_email=excluded.verified_email,drive_folder_id=excluded.drive_folder_id,permission_id=excluded.permission_id,access_role=excluded.access_role,grant_origin=excluded.grant_origin,operation_state='VERIFIED',inherited_from=excluded.inherited_from,safe_error=NULL,last_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
        .bind(operationId(),person.id,event.id,person.email,result.folderId,result.permissionId,result.role,origin,'VERIFIED',result.inheritedFrom || null).run();
      await recordOperation(actor, person, event, 'GRANT', 'SUCCEEDED', { permissionId: result.permissionId, origin, verified: result.verified === true });
      return { eventId: event.id, state: 'VERIFIED', origin };
    } catch (error) {
      await database.prepare(`INSERT INTO photo_drive_access_grants (id,user_id,event_id,verified_email,drive_folder_id,grant_origin,operation_state,safe_error)
        VALUES (?,?,?,?,?,'STUDIO_MANAGED','FAILED_NEEDS_ATTENTION',?) ON CONFLICT(user_id,event_id) DO UPDATE SET operation_state='FAILED_NEEDS_ATTENTION',safe_error=excluded.safe_error,updated_at=CURRENT_TIMESTAMP`)
        .bind(operationId(),person.id,event.id,person.email,'PENDING',clean(error.message)).run();
      await recordOperation(actor, person, event, 'GRANT', 'FAILED_NEEDS_ATTENTION', {}, clean(error.message));
      return { eventId: event.id, state: 'FAILED_NEEDS_ATTENTION' };
    }
  }

  async function revoke(actor, person, event, grant) {
    if (grant.grant_origin !== 'STUDIO_MANAGED') {
      await database.prepare(`UPDATE photo_drive_access_grants SET operation_state='EXTERNAL_ACCESS_REMAINS',last_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(grant.id).run();
      await recordOperation(actor, person, event, 'VERIFY', 'SUCCEEDED', { permissionId: grant.permission_id, externalAccessRemains: true, origin: grant.grant_origin });
      return { eventId: event.id, state: 'EXTERNAL_ACCESS_REMAINS' };
    }
    try {
      await database.prepare(`UPDATE photo_drive_access_grants SET operation_state='PENDING_REVOCATION',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(grant.id).run();
      const result = await appsRequest(env, 'REVOKE_DRIVE_ACCESS', { wixItemId: event.wix_item_id, email: person.email, permissionId: grant.permission_id, studioManaged: true });
      const state = result.remainingAccess ? 'EXTERNAL_ACCESS_REMAINS' : 'REVOKED';
      await database.prepare(`UPDATE photo_drive_access_grants SET operation_state=?,safe_error=NULL,revoked_at=CURRENT_TIMESTAMP,last_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(state,grant.id).run();
      await recordOperation(actor, person, event, 'REVOKE', 'SUCCEEDED', { permissionId: grant.permission_id, remainingAccess: result.remainingAccess === true });
      return { eventId: event.id, state };
    } catch (error) {
      await database.prepare(`UPDATE photo_drive_access_grants SET operation_state='FAILED_NEEDS_ATTENTION',safe_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(clean(error.message),grant.id).run();
      await recordOperation(actor, person, event, 'REVOKE', 'FAILED_NEEDS_ATTENTION', { permissionId: grant.permission_id }, clean(error.message));
      return { eventId: event.id, state: 'FAILED_NEEDS_ATTENTION' };
    }
  }

  return {
    qualified,
    assertQualified() { if (!qualified) throw new Error('drive_access_grant_revoke_pending_controlled_qualification'); },
    async audit(actor) {
      const result = await appsRequest(env, 'AUDIT_DRIVE_ROOTS');
      await recordOperation(actor, null, null, 'AUDIT', 'SUCCEEDED', { rootCount: (result.roots || []).length });
      return result;
    },
    async reconcileUser(actor, userId) {
      if (!qualified) throw new Error('drive_access_grant_revoke_pending_controlled_qualification');
      const person = await target(userId); const desired = await desiredEvents(person); const desiredIds = new Set(desired.map((event) => event.id));
      const existingResult = await database.prepare(`SELECT * FROM photo_drive_access_grants WHERE user_id=?`).bind(userId).all();
      const existing = existingResult.results || []; const byEvent = new Map(existing.map((grant) => [grant.event_id, grant])); const results = [];
      for (const event of desired) if (!byEvent.get(event.id) || !['VERIFIED','EXTERNAL_ACCESS_REMAINS'].includes(byEvent.get(event.id).operation_state)) results.push(await grant(actor, person, event));
      for (const access of existing.filter((grant) => !desiredIds.has(grant.event_id) && !['REVOKED'].includes(grant.operation_state))) {
        const event = await database.prepare(`SELECT id,wix_item_id,public_name FROM photo_events WHERE id=?`).bind(access.event_id).first();
        if (event) results.push(await revoke(actor, person, event, access));
      }
      await photos.audit(actor,'drive.access.reconcile','user',userId,results.some((r)=>r.state==='FAILED_NEEDS_ATTENTION')?'FAILED':'SUCCEEDED',{ preset: person.preset_key, eventScope: person.event_scope, results });
      return { userId, email: person.email, desiredEventCount: desired.length, results };
    },
    async accessFor(actor, eventId) {
      if (actor.role === 'PHOTO_ADMIN') return { authorized: true, source: 'ADMIN', driveFolderUrl: null };
      const row = await database.prepare(`SELECT a.operation_state,a.grant_origin,e.all_photos_url FROM photo_drive_access_grants a JOIN photo_events e ON e.id=a.event_id WHERE a.user_id=? AND a.event_id=?`).bind(actor.id,eventId).first();
      return { authorized: Boolean(row && ['VERIFIED','EXTERNAL_ACCESS_REMAINS'].includes(row.operation_state)), source: row?.grant_origin || null, driveFolderUrl: row?.all_photos_url || null, state: row?.operation_state || 'NOT_GRANTED' };
    }
  };
}
