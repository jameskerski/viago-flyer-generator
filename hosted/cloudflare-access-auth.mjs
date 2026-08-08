const ALLOWED_DOMAIN = 'goodlifetrainings.com';

export function authorizeGoogleIdentity(claims) {
  const email = typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || parts[1] !== ALLOWED_DOMAIN) return null;
  return { id: email, displayName: claims.name || email, email, role: 'TEMPLATE_ADMIN' };
}

function bytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}
const decode = (value) => JSON.parse(new TextDecoder().decode(bytes(value)));

export function createCloudflareAccessAuthenticator({ teamDomain, audience, fetchImpl = fetch, cryptoImpl = globalThis.crypto }) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain || '')) throw new Error('Cloudflare Access team domain is required');
  if (!audience) throw new Error('Cloudflare Access application audience is required');
  let cached;
  return async function authenticate(headers) {
    const token = headers['cf-access-jwt-assertion'] || headers.get?.('cf-access-jwt-assertion');
    if (!token) return null;
    const parts = token.split('.'); if (parts.length !== 3) return null;
    const header = decode(parts[0]); const claims = decode(parts[1]);
    if (claims.aud !== audience && !(Array.isArray(claims.aud) && claims.aud.includes(audience))) return null;
    if (claims.iss !== teamDomain || claims.exp * 1000 <= Date.now()) return null;
    cached ||= await fetchImpl(`${teamDomain}/cdn-cgi/access/certs`).then((response) => {
      if (!response.ok) throw new Error('unable to load Cloudflare Access signing keys'); return response.json();
    });
    const jwk = cached.keys.find(({ kid }) => kid === header.kid); if (!jwk) return null;
    const key = await cryptoImpl.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await cryptoImpl.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return valid ? authorizeGoogleIdentity(claims) : null;
  };
}

export { ALLOWED_DOMAIN };
