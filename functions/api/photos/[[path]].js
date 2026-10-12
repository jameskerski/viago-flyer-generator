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
  if (!team || !env.PHOTO_CF_ACCESS_AUD) throw new Error('photo_access_configuration_missing');
  const jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(token, jwks, { audience: env.PHOTO_CF_ACCESS_AUD, issuer: team });
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
  const galleryPhotosMatch = path.match(/^events\/([^/]+)\/galleries\/([^/]+)\/photos$/);
  const galleryDeleteMatch = path.match(/^events\/([^/]+)\/galleries\/([^/]+)$/);
  const photoDeleteMatch = path.match(/^events\/([^/]+)\/galleries\/([^/]+)\/photos\/([^/]+)$/);
  const creationRoute = path === 'setup' || path === 'creation-capabilities' || Boolean(creationMatch);
  const manage = request.method !== 'GET' || ['photographers', 'activity', 'overview', 'drive-access/audit'].includes(path);
  const permission = creationRoute || galleryMatch || galleryDeleteMatch || photoDeleteMatch ? PERMISSIONS.PHOTO_READ : manage ? PERMISSIONS.PHOTO_MANAGE : PERMISSIONS.PHOTO_READ;
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
      return json({ actor: { ...actor, profile, headshotCapabilities: await photos.headshotCapabilities(actor), canCreateEvent: await photos.canCreateEvent(actor) } });
    }
    if (request.method === 'GET' && path === 'events') return json({ events: await photos.listEvents(actor) });
    if (request.method === 'GET' && eventMatch) {
      const event = await photos.event(actor, eventMatch[1]);
      if (!event) return json({ error: 'event_not_found' }, 404);
      const manager = createGalleryManagement(env.PLATFORM_DB, env, photos);
      return json({ event, uploadAccess: await driveAccess.accessFor(actor, event.id), galleryOperations: await manager.list(event.id), galleryManagementQualified: manager.endpointReady });
    }
    if (request.method === 'GET' && galleryPhotosMatch) {
      const event = await photos.event(actor, galleryPhotosMatch[1]);
      if (!event) return json({ error: 'event_not_found' }, 404);
      const gallery = event.galleries.find((item) => item.drive_folder_id === galleryPhotosMatch[2]);
      if (!gallery) return json({ error: 'gallery_not_found' }, 404);
      if (!event.capabilities.includes('GALLERY_COVER_SELECT')) return json({ error: 'gallery_permission_required' }, 403);
      const manager = createGalleryManagement(env.PLATFORM_DB, env, photos);
      return json({ gallery: { driveFolderId: gallery.drive_folder_id, publicName: gallery.public_name, coverFileId: gallery.cover_file_id || '' }, ...(await manager.browse(event, gallery.drive_folder_id, url.searchParams.get('cursor') || '')) });
    }
    if (request.method === 'DELETE' && photoDeleteMatch) {
      const event = await photos.event(actor, photoDeleteMatch[1]);
      if (!event) return json({ error: 'event_not_found' }, 404);
      if (!event.capabilities.includes('PHOTO_REMOVE')) return json({ error: 'photo_remove_permission_required' }, 403);
      const gallery = event.galleries.find((item) => item.drive_folder_id === photoDeleteMatch[2]);
      if (!gallery) return json({ error: 'gallery_not_found' }, 404);
      const body = await request.json();
      if (body.fileId !== photoDeleteMatch[3]) return json({ error: 'photo_identity_mismatch' }, 400);
      return json(await createGalleryManagement(env.PLATFORM_DB, env, photos).destructive(actor, event, 'REMOVE_PHOTO', { ...body, galleryFolderId: gallery.drive_folder_id }, request.headers.get('idempotency-key')), 202);
    }
    if (request.method === 'DELETE' && galleryDeleteMatch) {
      const event = await photos.event(actor, galleryDeleteMatch[1]);
      if (!event) return json({ error: 'event_not_found' }, 404);
      const gallery = event.galleries.find((item) => item.drive_folder_id === galleryDeleteMatch[2]);
      if (!gallery) return json({ error: 'gallery_not_found' }, 404);
      const allowed = event.capabilities.includes('GALLERY_DELETE_ANY') || event.capabilities.includes('GALLERY_DELETE_OWN');
      if (!allowed) return json({ error: 'gallery_delete_permission_required' }, 403);
      const body = await request.json();
      if (Number(body.photoCount) !== Number(gallery.photo_count)) return json({ error: 'gallery_photo_count_changed' }, 409);
      return json(await createGalleryManagement(env.PLATFORM_DB, env, photos).destructive(actor, event, 'DELETE_GALLERY', { galleryFolderId: gallery.drive_folder_id, galleryName: gallery.public_name, photoCount: gallery.photo_count }, request.headers.get('idempotency-key')), 202);
    }
    if (request.method === 'GET' && path === 'overview') return json({ overview: await photos.overview() });
    if (request.method === 'GET' && path === 'photographers') return json({ photographers: await photos.listPhotographers() });
    if (request.method === 'GET' && path === 'activity') return json({ activity: await photos.activity() });
    if (path === 'media-assets' || path.startsWith('headshots')) {
      const capabilities = await photos.headshotCapabilities(actor);
      if (!capabilities.includes('HEADSHOT_VIEW')) return json({ error: 'headshot_view_permission_required' }, 403);
      if (request.method !== 'GET') return json({ error: 'headshot_writes_not_qualified' }, 403);
      return json({ collections: await photos.mediaAssets(), leaders: await photos.headshotLeaders(), capabilities, writesEnabled: false });
    }
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
      if (result.operation?.operation_state === 'READY_FOR_PUBLICATION' && driveAccess.qualified) {
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
    if (request.method === 'POST' && path === 'invitations/revoke') return json({ invitation: await photos.revokeInvitation(actor, body.invitationId) });
    if (request.method === 'POST' && path === 'photographers/status') {
      driveAccess.assertQualified();
      await photos.setUserStatus(actor, body.userId, body.status);
      return json({ ok: true, driveAccess: await driveAccess.reconcileUser(actor, body.userId) });
    }
    if (request.method === 'POST' && path === 'photographers/permissions') {
      driveAccess.assertQualified();
      await photos.setPermissionProfile(actor, body.userId, body.preset);
      return json({ ok: true, driveAccess: await driveAccess.reconcileUser(actor, body.userId) });
    }
    if (request.method === 'POST' && path === 'assignments') {
      driveAccess.assertQualified();
      await photos.setAssignment(actor, body.userId, body.eventId, body.active === true);
      return json({ ok: true, driveAccess: await driveAccess.reconcileUser(actor, body.userId) });
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
}
