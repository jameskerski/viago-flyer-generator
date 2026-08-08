import { expect, test } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt } from 'jose';
import { createGitHubAppJwt, createGitHubAppTokenProvider } from '../../hosted/github-app-auth.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

test('GitHub App JWT is short lived and identifies the configured App', async () => {
  const now = Date.parse('2026-08-08T18:00:00Z');
  const jwt = await createGitHubAppJwt({ appId: '123456', privateKeyPem, now: () => now });
  const claims = decodeJwt(jwt);
  expect(claims.iss).toBe('123456');
  expect(claims.exp - claims.iat).toBe(540);
  expect(claims.iat).toBe(Math.floor(now / 1000) - 60);
});

test('installation token exchange is scoped to the installation and refreshes near expiry', async () => {
  let now = Date.parse('2026-08-08T18:00:00Z');
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const count = requests.length;
    return Response.json({ token: `installation-token-${count}`, expires_at: new Date(now + 60 * 60 * 1000).toISOString() });
  };
  const token = createGitHubAppTokenProvider({ appId: '123456', installationId: '7890', privateKeyPem, fetchImpl, now: () => now });
  expect(await token()).toBe('installation-token-1');
  expect(await token()).toBe('installation-token-1');
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe('https://api.github.com/app/installations/7890/access_tokens');
  expect(requests[0].options.headers.Authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
  now += 56 * 60 * 1000;
  expect(await token()).toBe('installation-token-2');
  expect(requests).toHaveLength(2);
});

test('partial or failed GitHub App configuration fails closed', async () => {
  expect(() => createGitHubAppTokenProvider({ appId: '123', installationId: '', privateKeyPem })).toThrow('installation ID is not configured');
  const token = createGitHubAppTokenProvider({
    appId: '123', installationId: '456', privateKeyPem,
    fetchImpl: async () => Response.json({ message: 'Bad credentials' }, { status: 401 })
  });
  await expect(token()).rejects.toThrow('token exchange failed (401)');
});
