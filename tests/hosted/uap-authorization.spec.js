import { expect, test } from '@playwright/test';
import { authorizeOperation, MODULES, PERMISSIONS } from '../../hosted/platform/authorization.mjs';
import { createIdentityFromAccessClaims } from '../../hosted/platform/identity.mjs';

const identity = createIdentityFromAccessClaims({
  iss: 'https://team.cloudflareaccess.com', sub: 'access-user-1',
  email: 'photographer@gmail.com', name: 'Photo Helper'
});
const registryWith = (account) => ({ async resolveIdentity() { return account; } });
const photographer = {
  id: 'user-photo', displayName: 'Photo Helper', status: 'ACTIVE',
  moduleGrants: [{ module: MODULES.PHOTO_STUDIO, role: 'PHOTOGRAPHER', status: 'ACTIVE' }],
  eventAssignments: [{ eventId: 'amplify-2026', permission: 'PHOTO_UPLOAD', status: 'ACTIVE' }]
};

test('Access identity preserves verified facts without claiming the Access subject is a Google subject', () => {
  expect(identity).toMatchObject({
    provider: 'cloudflare_access', providerSubject: 'access-user-1',
    verifiedEmail: 'photographer@gmail.com', subjectQualification: 'cloudflare_access_account_subject'
  });
});

test('external photographer is denied Template Studio even when Photo Studio is granted', async () => {
  const decision = await authorizeOperation({ identity, registry: registryWith(photographer), module: MODULES.TEMPLATE_STUDIO, permission: PERMISSIONS.TEMPLATE_PUBLISH });
  expect(decision).toEqual({ allowed: false, reason: 'module_not_granted' });
});

test('revoked account is denied immediately', async () => {
  const decision = await authorizeOperation({ identity, registry: registryWith({ ...photographer, status: 'REVOKED' }), module: MODULES.PHOTO_STUDIO, permission: PERMISSIONS.PHOTO_UPLOAD, eventId: 'amplify-2026' });
  expect(decision).toEqual({ allowed: false, reason: 'account_not_active' });
});

test('photographer requires an active event assignment', async () => {
  const decision = await authorizeOperation({ identity, registry: registryWith(photographer), module: MODULES.PHOTO_STUDIO, permission: PERMISSIONS.PHOTO_UPLOAD, eventId: 'elevate-2026' });
  expect(decision).toEqual({ allowed: false, reason: 'event_not_assigned' });
});

test('active assignment permits the photo operation', async () => {
  const decision = await authorizeOperation({ identity, registry: registryWith(photographer), module: MODULES.PHOTO_STUDIO, permission: PERMISSIONS.PHOTO_UPLOAD, eventId: 'amplify-2026' });
  expect(decision.allowed).toBe(true);
  expect(decision.actor).toMatchObject({ id: 'user-photo', role: 'PHOTOGRAPHER', authorizationSource: 'platform_registry' });
});

test('photographer access never implies event creation authority', async () => {
  const decision = await authorizeOperation({ identity, registry: registryWith(photographer), module: MODULES.PHOTO_STUDIO, permission: PERMISSIONS.EVENT_CREATE });
  expect(decision).toEqual({ allowed: false, reason: 'permission_denied' });
});

test('Photo Studio administrator receives explicit event creation authority', async () => {
  const admin = { ...photographer, id: 'owner', moduleGrants: [{ module: MODULES.PHOTO_STUDIO, role: 'PHOTO_ADMIN', status: 'ACTIVE' }] };
  const decision = await authorizeOperation({ identity, registry: registryWith(admin), module: MODULES.PHOTO_STUDIO, permission: PERMISSIONS.EVENT_CREATE });
  expect(decision.allowed).toBe(true);
  expect(decision.actor.role).toBe('PHOTO_ADMIN');
});

test('browser role claims do not influence server authorization', async () => {
  const tampered = { ...identity, role: 'TEMPLATE_ADMIN', moduleGrants: [{ module: MODULES.TEMPLATE_STUDIO, role: 'TEMPLATE_ADMIN' }] };
  const decision = await authorizeOperation({ identity: tampered, registry: registryWith(photographer), module: MODULES.TEMPLATE_STUDIO, permission: PERMISSIONS.TEMPLATE_PUBLISH });
  expect(decision).toEqual({ allowed: false, reason: 'module_not_granted' });
});

test('compatibility policy is limited to internal Template Studio access', async () => {
  const internal = createIdentityFromAccessClaims({ iss: 'https://team.cloudflareaccess.com', sub: 'internal-1', email: 'admin@goodlifetrainings.com', name: 'Admin' });
  const template = await authorizeOperation({ identity: internal, registry: registryWith(null), module: MODULES.TEMPLATE_STUDIO, permission: PERMISSIONS.TEMPLATE_PUBLISH, allowTemplateCompatibility: true });
  const photo = await authorizeOperation({ identity: internal, registry: registryWith(null), module: MODULES.PHOTO_STUDIO, permission: PERMISSIONS.PHOTO_UPLOAD, eventId: 'amplify-2026', allowTemplateCompatibility: true });
  expect(template.allowed).toBe(true);
  expect(template.actor).toMatchObject({ role: 'TEMPLATE_ADMIN', authorizationSource: 'template_domain_compatibility' });
  expect(photo).toEqual({ allowed: false, reason: 'account_not_registered' });
});
