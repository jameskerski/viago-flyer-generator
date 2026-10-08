import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createIdentityFromAccessClaims } from '../../../hosted/platform/identity.mjs';
import { authorizeOperation, MODULES, PERMISSIONS } from '../../../hosted/platform/authorization.mjs';
import { createD1Registry } from '../../../hosted/platform/d1-registry.mjs';
import { createPhotoRegistry } from '../../../hosted/platform/photo-registry.mjs';

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
  const eventMatch = path.match(/^events\/([^/]+)$/);
  const manage = request.method !== 'GET' || ['photographers', 'activity', 'overview'].includes(path);
  const permission = manage ? PERMISSIONS.PHOTO_MANAGE : PERMISSIONS.PHOTO_READ;
  let auth;
  try {
    auth = await context(request, env, permission, eventMatch?.[1] || null);
  } catch (error) {
    return json({ error: 'authentication validation failed', code: error.message }, 401);
  }
  if (!auth.decision.allowed) return json({ error: auth.decision.reason }, auth.decision.reason === 'authentication_required' ? 401 : 403);
  const actor = auth.decision.actor;
  const photos = auth.photos;

  try {
    if (request.method === 'GET' && path === 'session') return json({ actor });
    if (request.method === 'GET' && path === 'events') return json({ events: await photos.listEvents(actor) });
    if (request.method === 'GET' && eventMatch) {
      const event = await photos.event(actor, eventMatch[1]);
      return event ? json({ event }) : json({ error: 'event_not_found' }, 404);
    }
    if (request.method === 'GET' && path === 'overview') return json({ overview: await photos.overview() });
    if (request.method === 'GET' && path === 'photographers') return json({ photographers: await photos.listPhotographers() });
    if (request.method === 'GET' && path === 'activity') return json({ activity: await photos.activity() });

    const body = await request.json();
    if (request.method === 'POST' && path === 'invitations') return json({ invitation: await photos.invite(actor, body) }, 201);
    if (request.method === 'POST' && path === 'photographers/status') {
      await photos.setUserStatus(actor, body.userId, body.status);
      return json({ ok: true });
    }
    if (request.method === 'POST' && path === 'assignments') {
      await photos.setAssignment(actor, body.userId, body.eventId, body.active === true);
      return json({ ok: true });
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
}
