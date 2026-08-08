import { importPKCS8, SignJWT } from 'jose';

const TOKEN_ENDPOINT = 'https://api.github.com/app/installations';
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is not configured`);
  return value.trim();
}

function privateKey(value) {
  let pem = required(value, 'GitHub App private key').replace(/\\n/g, '\n');
  if (!pem.includes('-----BEGIN')) {
    try {
      pem = Uint8Array.from(atob(pem), (character) => character.charCodeAt(0));
      pem = new TextDecoder().decode(pem);
    } catch {
      throw new Error('GitHub App private key must be PKCS#8 PEM or base64-encoded PKCS#8 PEM');
    }
  }
  if (!pem.includes('-----BEGIN PRIVATE KEY-----')) throw new Error('GitHub App private key must use PKCS#8 format');
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join('\n') || ''}\n-----END PRIVATE KEY-----`;
}

export async function createGitHubAppJwt({ appId, privateKeyPem, now = () => Date.now() }) {
  const issuedAt = Math.floor(now() / 1000) - 60;
  const key = await importPKCS8(privateKey(privateKeyPem), 'RS256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(required(appId, 'GitHub App ID'))
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 9 * 60)
    .sign(key);
}

export function createGitHubAppTokenProvider({ appId, installationId, privateKeyPem, fetchImpl = fetch, now = () => Date.now() }) {
  const id = required(appId, 'GitHub App ID');
  const installation = required(installationId, 'GitHub App installation ID');
  const pem = privateKey(privateKeyPem);
  let cached;

  return async function installationToken() {
    if (cached && cached.expiresAt - now() > REFRESH_WINDOW_MS) return cached.token;
    const jwt = await createGitHubAppJwt({ appId: id, privateKeyPem: pem, now });
    const response = await fetchImpl(`${TOKEN_ENDPOINT}/${encodeURIComponent(installation)}/access_tokens`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'User-Agent': 'VIAGO-Template-Studio',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    const result = await response.json();
    if (!response.ok || !result.token || !result.expires_at) {
      throw new Error(`GitHub App token exchange failed (${response.status}): ${result.message || 'invalid response'}`);
    }
    cached = { token: result.token, expiresAt: Date.parse(result.expires_at) };
    if (!Number.isFinite(cached.expiresAt)) throw new Error('GitHub App token exchange returned an invalid expiry');
    return cached.token;
  };
}
