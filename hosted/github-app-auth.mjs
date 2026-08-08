import { importPKCS8, SignJWT } from 'jose';

const TOKEN_ENDPOINT = 'https://api.github.com/app/installations';
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is not configured`);
  return value.trim();
}

function privateKey(value) {
  return required(value, 'GitHub App private key').replace(/\\n/g, '\n');
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
