import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createIdentityFromAccessClaims } from '../../../hosted/platform/identity.mjs';
import { authorizeOperation, MODULES, PERMISSIONS } from '../../../hosted/platform/authorization.mjs';
import { createD1Registry } from '../../../hosted/platform/d1-registry.mjs';
import { createPhotoRegistry } from '../../../hosted/platform/photo-registry.mjs';
import { authorizedSync, parseSyncPayload, reconcilePhotoReadModel } from '../../../hosted/platform/photo-sync.mjs';
import { createPhotoEventCreationRegistry, creationQualification } from '../../../hosted/platform/photo-event-creation.mjs';
import { createGalleryManagement } from '../../../hosted/platform/photo-gallery-management.mjs';
import { createPhotoDriveAccess } from '../../../hosted/platform/photo-drive-access.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function identity(request, env) {
  const cookieToken = request.headers.get('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  const token = request.headers.get('cf-access-jwt-assertion') || cookieToken;
  if (!token) throw new Error('missing_access_assertion');
  const team = env.CF_TEAM_DOMAIN?.replace(/\/$/, '');
  if (!team || !env.CF_ACCESS_AUD) throw new Error('access_configuration_missing');
  const jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(token, jwks, { audience: env.CF_ACCESS_AUD, issuer: team });
  return createIdentityFromAccessClaims(payload);
}

async function context(request, env, permission, eventId = null) {
  if (!env.PLATFORM_DB) throw new Error('platform_database_missing');
  const verifiedIdentity = await identity(request, env);
  if (!verifiedIdentity?.providerSubject) throw new Error('immutable_identity_unavailable');
  const photos = createPhotoRegistry(env.PLATFORM_DB);
  await photos.bootstrap(verifiedIdentity, env.PHOTO_STUDIO_BOOTSTRAP_ADMINS || '');
  await photos.claimInvitation(verifiedIdentity);
  const decision = await authorizeOperation({
    identity: verifiedIdentity,
    registry: createD1Registry(env.PLATFORM_DB),
    module: MODULES.PHOTO_STUDIO,
    permission,
    eventId
  });
  return { decision, photos };
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/photos\/?/, '');
  if (request.method === 'POST' && path === 'sync') {
    if (!(await authorizedSync(request, env))) return json({ error: 'unauthorized_sync' }, 401);
    try {
      const payload = await parseSyncPayload(request);
      return json({ success: true, ...(await reconcilePhotoReadModel(env.PLATFORM_DB, payload)) });
    } catch (error) {
      return json({ success: false, error: error.message }, error.message === 'payload_too_large' ? 413 : 400);
    }
  }
  const eventMatch = path.match(/^events\/([^/]+)$/);
  const creationMatch = path.match(/^setup\/([^/]+)\/retry$/);
  const galleryMatch = path.match(/^events\/([^/]+)\/galleries(?:\/operations)?$/);
  const creationRoute = path === 'setup' || path === 'creation-capabilities' || Boolean(creationMatch);
  const manage = request.method !== 'GET' || ['photographers', 'activity', 'overview', 'drive-access/audit'].includes(path);
  const permission = creationRoute || galleryMatch ? PERMISSIONS.PHOTO_READ : manage ? PERMISSIONS.PHOTO_MANAGE : PERMISSIONS.PHOTO_READ;
  let auth;
  try {
    // Event-scope authorization is resolved from the explicit Photo Studio
    // permission profile in the registry, not from a browser-supplied id.
    auth = await context(request, env, permission, null);
  } catch (error) {
    return json({ error: 'authentication validation failed', code: error.message }, 401);
  }
  if (!auth.decision.allowed) return json({ error: auth.decision.reason }, auth.decision.reason === 'authentication_required' ? 401 : 403);
  const actor = auth.decision.actor;
  const photos = auth.photos;
  const driveAccess = createPhotoDriveAccess(env.PLATFORM_DB, env, photos);

  try {
    if (creationRoute && !(await photos.canCreateEvent(actor))) return json({ error: 'event_create_permission_required' }, 403);
    const creations = creationRoute ? createPhotoEventCreationRegistry(env.PLATFORM_DB, env) : null;
    if (request.method === 'GET' && path === 'session') {
      const profile = actor.role === 'PHOTOGRAPHER' ? await photos.photographerProfile(actor.id) : null;
      return json({ actor: { ...actor, profile, canCreateEvent: await photos.canCreateEvent(actor) } });
    }
    if (request.method === 'GET' && path === 'events') return json({ events: await photos.listEvents(actor) });
    if (request.method === 'GET' && eventMatch) {
      const event = await photos.event(actor, eventMatch[1]);
      if (!event) return json({ error: 'event_not_found' }, 404);
      const manager = createGalleryManagement(env.PLATFORM_DB, env, photos);
      return json({ event, uploadAccess: await driveAccess.accessFor(actor, event.id), galleryOperations: await manager.list(event.id), galleryManagementQualified: manager.endpointReady });
    }
    if (request.method === 'GET' && path === 'overview') return json({ overview: await photos.overview() });
    if (request.method === 'GET' && path === 'photographers') return json({ photographers: await photos.listPhotographers() });
    if (request.method === 'GET' && path === 'activity') return json({ activity: await photos.activity() });
    if (request.method === 'GET' && path === 'media-assets') return json({ collections: await photos.mediaAssets() });
    if (request.method === 'GET' && path === 'creation-capabilities') return json({ qualification: creationQualification(env) });
    if (request.method === 'GET' && path === 'drive-access/audit') return json({ audit: await driveAccess.audit(actor) });
    if (request.method === 'GET' && path === 'setup') return json({ operations: await creations.list(actor), qualification: creations.qualification });

    const body = await request.json();
    if (request.method === 'POST' && galleryMatch) {
      const event = await photos.event(actor, galleryMatch[1]);
      if (!event) return json({ error: 'event_not_found' }, 404);
      const action = String(body.action || '').toUpperCase();
      const required = action === 'RENAME' ? 'GALLERY_RENAME' : action === 'SET_COVER' ? 'GALLERY_COVER_SELECT' : 'GALLERY_CREATE';
      if (!event.capabilities.includes(required)) return json({ error: 'gallery_permission_required' }, 403);
      const result = await createGalleryManagement(env.PLATFORM_DB, env, photos).request(actor, event, action, body, request.headers.get('idempotency-key'));
      return json(result, 202);
    }
    if (request.method === 'POST' && path === 'setup') {
      const result = await creations.request(actor, body, request.headers.get('idempotency-key'));
      if (result.operation?.operation_state === 'READY_FOR_PUBLICATION') {
        for (const userId of await photos.futureAccessUserIds()) await driveAccess.reconcileUser(actor, userId);
      }
      await photos.audit(actor, 'event.creation.request', 'event_creation_operation', result.operation.id, 'SUCCEEDED', { state: result.operation.operation_state, eventType: result.operation.event_type, enabled: result.qualification.enabled });
      return json(result, 202);
    }
    if (request.method === 'POST' && creationMatch) {
      const result = await creations.retry(actor, creationMatch[1]);
      await photos.audit(actor, 'event.creation.retry', 'event_creation_operation', creationMatch[1], 'SUCCEEDED', { resumed: result.resumed, state: result.operation.operation_state });
      return json(result, 202);
    }
    if (request.method === 'POST' && path === 'invitations') return json({ invitation: await photos.invite(actor, body) }, 201);
    if (request.method === 'POST' && path === 'photographers/status') {
      await photos.setUserStatus(actor, body.userId, body.status);
      return json({ ok: true, driveAccess: await driveAccess.reconcileUser(actor, body.userId) });
    }
    if (request.method === 'POST' && path === 'photographers/permissions') {
      await photos.setPermissionProfile(actor, body.userId, body.preset);
      return json({ ok: true, driveAccess: await driveAccess.reconcileUser(actor, body.userId) });
    }
    if (request.method === 'POST' && path === 'assignments') {
      await photos.setAssignment(actor, body.userId, body.eventId, body.active === true);
      return json({ ok: true, driveAccess: await driveAccess.reconcileUser(actor, body.userId) });
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
}
