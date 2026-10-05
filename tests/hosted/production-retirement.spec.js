import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from 'jose';
import { onRequest, validateEvolvingCatalog, validateTemplate } from '../../functions/api/studio/[[path]].js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('production Worker route retires one template through GitHub App with an evolving catalog', async () => {
  const registry = JSON.parse(await readFile(`${ROOT}/public/templates.json`, 'utf8'));
  const { publicKey: accessPublic, privateKey: accessPrivate } = await generateKeyPair('ES256');
  const accessJwk = await exportJWK(accessPublic); accessJwk.kid = 'access-key';
  const accessToken = await new SignJWT({ email: 'admin@goodlifetrainings.com', name: 'Admin' })
    .setProtectedHeader({ alg: 'ES256', kid: accessJwk.kid }).setIssuer('https://team.cloudflareaccess.com')
    .setAudience('studio-audience').setIssuedAt().setExpirationTime('5m').sign(accessPrivate);
  const { privateKey: appPrivate } = await generateKeyPair('RS256', { extractable: true });
  const calls = [];
  let committedCatalog;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url); calls.push({ href, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (href.endsWith('/cdn-cgi/access/certs')) return response({ keys: [accessJwk] });
    if (href.endsWith('/app/installations/152276767/access_tokens')) return response({ token: 'installation-token', expires_at: new Date(Date.now() + 3600000).toISOString() });
    if (href.endsWith('/git/ref/heads/main')) return response({ object: { sha: 'base-sha' } });
    if (href.endsWith('/git/commits/base-sha') || href.endsWith('/git/commits/retirement-commit')) return response({ tree: { sha: 'tree-sha' } });
    if (href.includes('/contents/public/templates.json?ref=base-sha')) return response({ content: Buffer.from(JSON.stringify(registry)).toString('base64') });
    if (href.includes('/contents/public/templates.json?ref=retirement-commit')) return response({ content: Buffer.from(committedCatalog).toString('base64') });
    if (href.endsWith('/git/blobs')) { if (!committedCatalog) committedCatalog = Buffer.from(JSON.parse(options.body).content, 'base64').toString('utf8'); return response({ sha: `blob-${calls.filter(({ href: value }) => value.endsWith('/git/blobs')).length}` }); }
    if (href.endsWith('/git/trees')) return response({ sha: 'next-tree' });
    if (href.endsWith('/git/commits')) return response({ sha: 'retirement-commit' });
    if (href.endsWith('/git/refs/heads/main')) return response({ object: { sha: 'retirement-commit' } });
    return response({ message: `unexpected request ${href}` }, 500);
  };
  try {
    const request = new Request('https://studio.example/api/studio/retire', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-access-jwt-assertion': accessToken },
      body: JSON.stringify({ templateId: 'cyprus-im', baseRevision: 'base-sha', confirmed: true })
    });
    const result = await onRequest({ request, env: {
      CF_ACCESS_AUD: 'studio-audience', CF_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
      GITHUB_APP_ID: '4530195', GITHUB_APP_INSTALLATION_ID: '152276767', GITHUB_APP_PRIVATE_KEY: await exportPKCS8(appPrivate),
      GITHUB_OWNER: 'jameskerski', GITHUB_REPOSITORY: 'viago-flyer-generator', GITHUB_BRANCH: 'main'
    } });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ ok: true, commitSha: 'retirement-commit', affectedFiles: ['public/templates.json', 'public/art/cyprus-im.jpg'] });
    const tree = calls.find(({ href }) => href.endsWith('/git/trees')).body.tree;
    expect(tree).toContainEqual({ path: 'public/art/cyprus-im.jpg', mode: '100644', type: 'blob', sha: null });
    const catalogBlob = calls.filter(({ href }) => href.endsWith('/git/blobs'))[0].body;
    const reduced = JSON.parse(Buffer.from(catalogBlob.content, 'base64').toString('utf8'));
    expect(reduced.templates).toHaveLength(registry.templates.length - 1);
    expect(reduced.templates.some(({ id }) => id === 'cyprus-im')).toBe(false);
    const historical = reduced.templates.find(({ id }) => id === 'whatsapp-image-2026-09-28-at-20-56-09');
    expect(historical.text3).toMatchObject({ enabled: true, value: '1' });
    expect(historical.text3).not.toHaveProperty('label');
    const commit = calls.find(({ href }) => href.endsWith('/git/commits') && !href.endsWith('/git/commits/base-sha')).body;
    expect(commit.message).toContain('Published-by: admin@goodlifetrainings.com (Admin)');
    expect(calls.some(({ href }) => href.endsWith('/git/refs/heads/main'))).toBe(true);
  } finally { globalThis.fetch = originalFetch; }
});

test('legacy compatibility is catalog-only while current enabled regions require labels', async () => {
  const registry = JSON.parse(await readFile(`${ROOT}/public/templates.json`, 'utf8'));
  const legacy = registry.templates.find(({ id }) => id === 'whatsapp-image-2026-09-28-at-20-56-09');
  expect(validateTemplate(legacy)).toContain('Text Region 3 public label is required and must be at most 40 characters.');
  expect(validateEvolvingCatalog(registry).filter((error) => error.includes(legacy.id))).toEqual([]);

  const disabled = structuredClone(legacy); disabled.text3.enabled = false; delete disabled.text3.label;
  expect(validateTemplate(disabled)).toEqual([]);

  const currentEdit = structuredClone(legacy); delete currentEdit.text3.value; currentEdit.text3.enabled = true;
  expect(validateTemplate(currentEdit)).toContain('Text Region 3 public label is required and must be at most 40 characters.');
  currentEdit.text3.label = 'Placement';
  expect(validateTemplate(currentEdit)).toEqual([]);
});
