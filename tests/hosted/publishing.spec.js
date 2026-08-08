import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHostedApi } from '../../hosted/api.mjs';
import { authorizeGoogleIdentity } from '../../hosted/cloudflare-access-auth.mjs';
import { createPublishingService } from '../../hosted/publishing-service.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const actor = { id: 'admin@example.com', displayName: 'VIAGO Admin', role: 'TEMPLATE_ADMIN' };

async function fixture() {
  let catalog = await readFile(resolve(ROOT, 'public/templates.json'));
  const commits = [];
  const repository = {
    async snapshot() { return { revision: 'base-sha', treeSha: 'tree-sha', catalog }; },
    async commit(value) { commits.push(value); catalog = Buffer.from(value.writes['public/templates.json']); return { sha: 'commit-sha' }; }
  };
  const service = createPublishingService({ repository, validatorRoot: ROOT });
  const artwork = await readFile(resolve(ROOT, 'public/art/club-4.jpg'));
  const original = JSON.parse(catalog).templates.find(({ id }) => id === 'club-4');
  const candidate = { mode: 'new', originalId: null, baseRevision: 'base-sha', categoryPosition: 4, draft: { ...structuredClone(original), id: 'hosted-fixture', label: 'Hosted Fixture', art: 'art/hosted-fixture.jpg' }, artworkDataUrl: `data:image/jpeg;base64,${artwork.toString('base64')}` };
  return { service, repository, commits, candidate };
}

test('hosted API denies anonymous and non-admin access while allowing an admin', async () => {
  const { service } = await fixture();
  const anonymous = createHostedApi({ service, authenticate: async () => null });
  expect((await anonymous({ method: 'GET', path: '/api/studio/catalog' })).status).toBe(401);
  const viewer = createHostedApi({ service, authenticate: async () => ({ ...actor, role: 'VIEWER' }) });
  expect((await viewer({ method: 'POST', path: '/api/studio/publish', body: {} })).status).toBe(403);
  const admin = createHostedApi({ service, authenticate: async () => actor });
  expect((await admin({ method: 'GET', path: '/api/studio/session' })).body.actor.id).toBe(actor.id);
});

test('Google authorization allows only the exact case-normalized goodlifetrainings.com domain', async () => {
  expect(authorizeGoogleIdentity({ email: 'Admin@GoodLifeTrainings.com', name: 'Admin' })).toMatchObject({ id: 'admin@goodlifetrainings.com', role: 'TEMPLATE_ADMIN' });
  for (const email of ['person@gmail.com', 'person@other.com', 'person@goodlifetrainings.com.attacker.com', 'person@fakegoodlifetrainings.com', '@goodlifetrainings.com', 'goodlifetrainings.com']) {
    expect(authorizeGoogleIdentity({ email })).toBeNull();
  }
  expect(authorizeGoogleIdentity(null)).toBeNull();
});

test('authorized Google domain can publish while gmail and other domains cannot', async () => {
  const { service, candidate } = await fixture();
  const apiFor = (email) => createHostedApi({ service, authenticate: async () => authorizeGoogleIdentity({ email }) });
  expect((await apiFor('person@gmail.com')({ method: 'POST', path: '/api/studio/publish', body: candidate })).status).toBe(401);
  expect((await apiFor('person@other.com')({ method: 'POST', path: '/api/studio/publish', body: candidate })).status).toBe(401);
  const allowed = await apiFor('person@GOODLIFETRAININGS.COM')({ method: 'POST', path: '/api/studio/publish', body: candidate });
  expect(allowed.status).toBe(200); expect(allowed.body.commitSha).toBe('commit-sha');
});

test('GitHub publishing credentials and server modules are absent from browser assets', async () => {
  const browserFiles = ['public/index.html', 'public/app.js', 'public/styles.css', 'studio/index.html', 'studio/studio.js', 'studio/studio.css'];
  const contents = await Promise.all(browserFiles.map((path) => readFile(resolve(ROOT, path), 'utf8')));
  expect(contents.join('\n')).not.toMatch(/GITHUB_TOKEN|github_pat_|BEGIN (?:RSA |EC )?PRIVATE KEY|hosted\/github-repository/);
});

test('new publication validates and makes one atomic attributed catalog plus artwork commit', async () => {
  const { service, commits, candidate } = await fixture();
  const result = await service.publish(candidate, actor);
  expect(result.commitSha).toBe('commit-sha'); expect(commits).toHaveLength(1);
  expect(Object.keys(commits[0].writes).sort()).toEqual(['public/art/hosted-fixture.jpg', 'public/templates.json']);
  expect(commits[0].actor).toEqual(actor); expect(commits[0].baseRevision).toBe('base-sha');
});

test('existing publication updates the selected record in one commit', async () => {
  const { service, commits, candidate } = await fixture();
  candidate.mode = 'existing'; candidate.originalId = 'club-4'; candidate.draft.id = 'club-4'; candidate.draft.art = 'art/club-4.jpg'; candidate.draft.label = 'Club Four'; candidate.categoryPosition = 0;
  await service.publish(candidate, actor);
  const after = JSON.parse(commits[0].writes['public/templates.json']);
  expect(after.templates.find(({ id }) => id === 'club-4').label).toBe('Club Four');
});

test('validation, stale revision, and unsafe paths block publication before commit', async () => {
  const { service, commits, candidate } = await fixture();
  candidate.draft.w = 1;
  await expect(service.publish(candidate, actor)).rejects.toThrow('candidate validation failed');
  candidate.draft.w = 800; candidate.baseRevision = 'stale';
  await expect(service.publish(candidate, actor)).rejects.toThrow('production changed');
  candidate.baseRevision = 'base-sha'; candidate.draft.id = '../escape'; candidate.draft.art = 'art/../escape.jpg';
  await expect(service.publish(candidate, actor)).rejects.toThrow('unsafe template id');
  expect(commits).toHaveLength(0);
});

test('retirement requires confirmation and atomically removes catalog entry and unreferenced art', async () => {
  const { service, commits } = await fixture();
  await expect(service.retire({ templateId: 'cyprus-im', baseRevision: 'base-sha', confirmed: false }, actor)).rejects.toThrow('confirmation');
  const result = await service.retire({ templateId: 'cyprus-im', baseRevision: 'base-sha', confirmed: true }, actor);
  expect(result.affectedFiles).toEqual(['public/templates.json', 'public/art/cyprus-im.jpg']);
  expect(commits).toHaveLength(1); expect(commits[0].deletes).toEqual(['public/art/cyprus-im.jpg']);
  expect(JSON.parse(commits[0].writes['public/templates.json']).templates.some(({ id }) => id === 'cyprus-im')).toBe(false);
});
