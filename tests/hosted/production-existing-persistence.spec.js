import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from 'jose';
import { onRequest } from '../../functions/api/studio/[[path]].js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const encoded = (value) => Buffer.from(value).toString('base64');

test('existing template A → B → C persists through production publish, fresh reload, and public consumption', async ({ page }) => {
  const initial = JSON.parse(await readFile(`${ROOT}/public/templates.json`, 'utf8'));
  const targetA = structuredClone(initial.templates.find(({ id }) => id === 'club-4'));
  const artworkA = await readFile(`${ROOT}/public/art/club-4.jpg`);
  const artworkB = await readFile(`${ROOT}/public/art/silver.jpg`);
  const artworkC = await readFile(`${ROOT}/public/art/gold.jpg`);
  const { publicKey: accessPublic, privateKey: accessPrivate } = await generateKeyPair('ES256');
  const accessJwk = await exportJWK(accessPublic); accessJwk.kid = 'access-key';
  const accessToken = await new SignJWT({ email: 'admin@goodlifetrainings.com', name: 'Admin' })
    .setProtectedHeader({ alg: 'ES256', kid: accessJwk.kid }).setIssuer('https://team.cloudflareaccess.com')
    .setAudience('studio-audience').setIssuedAt().setExpirationTime('5m').sign(accessPrivate);
  const { privateKey: appPrivate } = await generateKeyPair('RS256', { extractable: true });
  const commits = new Map([['revision-a', { registry: initial, artwork: artworkA, tree: 'tree-a' }]]);
  const blobs = new Map(); let head = 'revision-a'; let pendingTree = null; let sequence = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url); const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : null;
    if (href.endsWith('/cdn-cgi/access/certs')) return response({ keys: [accessJwk] });
    if (href.endsWith('/app/installations/152276767/access_tokens')) return response({ token: 'installation-token', expires_at: new Date(Date.now() + 3600000).toISOString() });
    if (href.endsWith('/git/ref/heads/main')) return response({ object: { sha: head } });
    const commitMatch = href.match(/\/git\/commits\/([^/?]+)$/);
    if (commitMatch) return response({ tree: { sha: commits.get(commitMatch[1]).tree } });
    if (href.includes('/contents/public/templates.json?ref=')) {
      const revision = new URL(href).searchParams.get('ref'); return response({ content: encoded(JSON.stringify(commits.get(revision).registry)) });
    }
    if (href.includes('/contents/public/art/club-4.jpg?ref=')) {
      const revision = new URL(href).searchParams.get('ref'); return response({ content: encoded(commits.get(revision).artwork) });
    }
    if (href.endsWith('/git/blobs') && method === 'POST') { const sha = `blob-${++sequence}`; blobs.set(sha, Buffer.from(body.content, 'base64')); return response({ sha }); }
    if (href.endsWith('/git/trees') && method === 'POST') { pendingTree = body.tree; return response({ sha: `tree-${sequence}` }); }
    if (href.endsWith('/git/commits') && method === 'POST') {
      const revision = `revision-${++sequence}`; const previous = commits.get(head);
      const catalogEntry = pendingTree.find(({ path }) => path === 'public/templates.json');
      const artworkEntry = pendingTree.find(({ path }) => path === 'public/art/club-4.jpg');
      commits.set(revision, { registry: JSON.parse(blobs.get(catalogEntry.sha)), artwork: artworkEntry ? blobs.get(artworkEntry.sha) : previous.artwork, tree: body.tree });
      return response({ sha: revision });
    }
    if (href.endsWith('/git/refs/heads/main') && method === 'PATCH') { head = body.sha; return response({ object: { sha: head } }); }
    return response({ message: `unexpected request ${method} ${href}` }, 500);
  };
  const env = {
    CF_ACCESS_AUD: 'studio-audience', CF_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
    GITHUB_APP_ID: '4530195', GITHUB_APP_INSTALLATION_ID: '152276767', GITHUB_APP_PRIVATE_KEY: await exportPKCS8(appPrivate),
    GITHUB_OWNER: 'jameskerski', GITHUB_REPOSITORY: 'viago-flyer-generator', GITHUB_BRANCH: 'main'
  };
  const call = (path, options = {}) => onRequest({ request: new Request(`https://studio.example/api/studio/${path}`, { ...options, headers: { 'cf-access-jwt-assertion': accessToken, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } }), env });
  const publish = async (draft, image, baseRevision) => {
    const result = await call('publish', { method: 'POST', body: JSON.stringify({ mode: 'existing', originalId: 'club-4', draft, categoryPosition: 0, artworkDataUrl: `data:image/jpeg;base64,${encoded(image)}`, baseRevision }) });
    expect(result.status).toBe(200); return result.json();
  };
  const freshRead = async () => {
    const catalogResponse = await call('catalog'); const catalog = await catalogResponse.json();
    const artResponse = await call(`artwork?templateId=club-4&revision=${catalog.revision}`);
    return { catalog, artwork: Buffer.from(await artResponse.arrayBuffer()) };
  };

  try {
    const targetB = { ...targetA, label: 'Club 4 B', photo: { shape: 'circle', x: .11, y: .22, w: .33, h: .44 }, name: { ...targetA.name, x: .61 } };
    const publishB = await publish(targetB, artworkB, 'revision-a');
    const reloadB = await freshRead();
    expect(reloadB.catalog.revision).toBe(publishB.commitSha);
    expect(reloadB.catalog.registry.templates.find(({ id }) => id === 'club-4')).toEqual(targetB);
    expect(reloadB.artwork.equals(artworkB)).toBe(true);
    expect(reloadB.artwork.equals(artworkA)).toBe(false);

    const targetC = { ...targetB, label: 'Club 4 C', photo: { shape: 'rect', x: .21, y: .12, w: .43, h: .34 }, name: { ...targetB.name, x: .39 } };
    const publishC = await publish(targetC, artworkC, reloadB.catalog.revision);
    const reloadC = await freshRead();
    expect(reloadC.catalog.revision).toBe(publishC.commitSha);
    expect(reloadC.catalog.registry.templates.find(({ id }) => id === 'club-4')).toEqual(targetC);
    expect(reloadC.artwork.equals(artworkC)).toBe(true);
    expect(reloadC.artwork.equals(artworkB)).toBe(false);

    await page.route('**/templates.json', (route) => route.fulfill({ json: reloadC.catalog.registry }));
    await page.route('**/art/club-4.jpg', (route) => route.fulfill({ contentType: 'image/jpeg', body: reloadC.artwork }));
    await page.goto('/');
    await page.waitForFunction(() => window.__studio?.state?.templates?.some(({ id }) => id === 'club-4'));
    expect(await page.evaluate(() => window.__studio.state.templates.find(({ id }) => id === 'club-4'))).toEqual(targetC);
  } finally { globalThis.fetch = originalFetch; }
});
