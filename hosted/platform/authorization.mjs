import { compatibilityTemplateActor } from './identity.mjs';

export const MODULES = Object.freeze({ TEMPLATE_STUDIO: 'TEMPLATE_STUDIO', PHOTO_STUDIO: 'PHOTO_STUDIO' });
export const ROLES = Object.freeze({ TEMPLATE_ADMIN: 'TEMPLATE_ADMIN', PHOTO_ADMIN: 'PHOTO_ADMIN', PHOTOGRAPHER: 'PHOTOGRAPHER' });
export const PERMISSIONS = Object.freeze({
  TEMPLATE_READ: 'template:read', TEMPLATE_PUBLISH: 'template:publish', TEMPLATE_RETIRE: 'template:retire',
  PHOTO_READ: 'photo:read', PHOTO_MANAGE: 'photo:manage', PHOTO_UPLOAD: 'photo:upload'
});

const ROLE_PERMISSIONS = Object.freeze({
  TEMPLATE_ADMIN: new Set([PERMISSIONS.TEMPLATE_READ, PERMISSIONS.TEMPLATE_PUBLISH, PERMISSIONS.TEMPLATE_RETIRE]),
  PHOTO_ADMIN: new Set([PERMISSIONS.PHOTO_READ, PERMISSIONS.PHOTO_MANAGE, PERMISSIONS.PHOTO_UPLOAD]),
  PHOTOGRAPHER: new Set([PERMISSIONS.PHOTO_READ, PERMISSIONS.PHOTO_UPLOAD])
});

const deny = (reason) => ({ allowed: false, reason });

export async function authorizeOperation({ identity, registry, module, permission, eventId = null, allowTemplateCompatibility = false }) {
  if (!identity) return deny('authentication_required');
  const account = registry ? await registry.resolveIdentity(identity) : null;
  if (!account) {
    if (allowTemplateCompatibility && module === MODULES.TEMPLATE_STUDIO) {
      const actor = compatibilityTemplateActor(identity);
      if (actor && ROLE_PERMISSIONS.TEMPLATE_ADMIN.has(permission)) return { allowed: true, actor };
    }
    return deny('account_not_registered');
  }
  if (account.status !== 'ACTIVE') return deny('account_not_active');
  const grant = account.moduleGrants?.find((candidate) => candidate.module === module && candidate.status === 'ACTIVE');
  if (!grant) return deny('module_not_granted');
  if (!ROLE_PERMISSIONS[grant.role]?.has(permission)) return deny('permission_denied');
  if (module === MODULES.PHOTO_STUDIO && eventId) {
    const assigned = account.eventAssignments?.some((assignment) => assignment.eventId === eventId && assignment.status === 'ACTIVE');
    if (!assigned && grant.role !== ROLES.PHOTO_ADMIN) return deny('event_not_assigned');
  }
  return {
    allowed: true,
    actor: {
      id: account.id,
      identityKey: `${identity.provider}:${identity.issuer}:${identity.providerSubject}`,
      displayName: account.displayName || identity.displayName,
      email: identity.verifiedEmail,
      role: grant.role,
      authorizationSource: 'platform_registry'
    }
  };
}

export function requiredTemplatePermission(method, pathname) {
  if (method === 'POST' && pathname.endsWith('/publish')) return PERMISSIONS.TEMPLATE_PUBLISH;
  if (method === 'POST' && pathname.endsWith('/retire')) return PERMISSIONS.TEMPLATE_RETIRE;
  return PERMISSIONS.TEMPLATE_READ;
}
