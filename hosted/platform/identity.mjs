export const INTERNAL_EMAIL_DOMAIN = 'goodlifetrainings.com';

export function normalizeVerifiedEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  const parts = email.split('@');
  return parts.length === 2 && parts[0] && parts[1] ? email : null;
}

export function isInternalEmail(email) {
  return normalizeVerifiedEmail(email)?.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`) || false;
}

export function createIdentityFromAccessClaims(claims) {
  const email = normalizeVerifiedEmail(claims?.email);
  const issuer = typeof claims?.iss === 'string' && claims.iss ? claims.iss.replace(/\/$/, '') : null;
  const subject = typeof claims?.sub === 'string' && claims.sub ? claims.sub : null;
  if (!email || !issuer) return null;
  return Object.freeze({
    provider: 'cloudflare_access',
    providerSubject: subject,
    issuer,
    verifiedEmail: email,
    displayName: typeof claims?.name === 'string' && claims.name.trim() ? claims.name.trim() : email,
    subjectQualification: subject ? 'cloudflare_access_account_subject' : 'verified_email_legacy'
  });
}

export function compatibilityTemplateActor(identity) {
  if (!identity || !isInternalEmail(identity.verifiedEmail)) return null;
  return {
    id: identity.verifiedEmail,
    identityKey: identity.providerSubject
      ? `${identity.provider}:${identity.issuer}:${identity.providerSubject}`
      : `verified-email:${identity.verifiedEmail}`,
    displayName: identity.displayName,
    email: identity.verifiedEmail,
    role: 'TEMPLATE_ADMIN',
    authorizationSource: 'template_domain_compatibility'
  };
}

export function authorizeGoogleIdentity(claims) {
  return compatibilityTemplateActor(createIdentityFromAccessClaims({
    ...claims,
    iss: claims?.iss || 'https://legacy.cloudflareaccess.com'
  }));
}
