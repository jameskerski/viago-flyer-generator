import { createRemoteJWKSet, jwtVerify } from 'jose';

const ALLOWED_DOMAIN = 'goodlifetrainings.com';
const CATALOG = 'public/templates.json';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const decode64 = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const decodeJson = (value) => JSON.parse(new TextDecoder().decode(decode64(value)));
const encode64 = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const safeId = (id) => typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);

async function actor(request, env) {
  const cookieToken = request.headers.get('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  const token = request.headers.get('cf-access-jwt-assertion') || cookieToken;
  if (!token) throw new Error('missing_access_assertion');
  if (!env.CF_ACCESS_AUD || !env.CF_TEAM_DOMAIN) throw new Error('missing_access_configuration');
  const jwks = createRemoteJWKSet(new URL(`${env.CF_TEAM_DOMAIN.replace(/\/$/, '')}/cdn-cgi/access/certs`));
  const { payload: claims } = await jwtVerify(token, jwks, {
    audience: env.CF_ACCESS_AUD,
    issuer: env.CF_TEAM_DOMAIN.replace(/\/$/, '')
  });
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const pieces = email.split('@');
  return pieces.length === 2 && pieces[0] && pieces[1] === ALLOWED_DOMAIN ? { id: email, displayName: claims.name || email } : null;
}

function github(env) {
  if (!env.GITHUB_TOKEN) throw new Error('server-side GitHub credential is not configured');
  const base = `https://api.github.com/repos/${env.GITHUB_OWNER || 'jameskerski'}/${env.GITHUB_REPOSITORY || 'viago-flyer-generator'}`;
  const request = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'VIAGO-Template-Studio', 'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { message: text.trim() || 'request failed' };
    }
    if (!response.ok) throw new Error(`GitHub ${response.status}: ${result.message || 'request failed'}`);
    return result;
  };
  const branch = env.GITHUB_BRANCH || 'main';
  return {
    async snapshot() {
      const ref = await request(`/git/ref/heads/${branch}`);
      const commit = await request(`/git/commits/${ref.object.sha}`);
      const catalog = await request(`/contents/${CATALOG}?ref=${ref.object.sha}`);
      return { revision: ref.object.sha, treeSha: commit.tree.sha, catalog: atob(catalog.content.replace(/\n/g, '')) };
    },
    async commit({ revision, treeSha, message, actor: who, writes, deletes = [] }) {
      const tree = [];
      for (const [path, value] of Object.entries(writes)) {
        const content = encode64(value instanceof Uint8Array ? value : new TextEncoder().encode(value));
        const blob = await request('/git/blobs', { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
        tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      for (const path of deletes) tree.push({ path, mode: '100644', type: 'blob', sha: null });
      const nextTree = await request('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: treeSha, tree }) });
      const commit = await request('/git/commits', { method: 'POST', body: JSON.stringify({ message: `${message}\n\nPublished-by: ${who.id} (${who.displayName})`, tree: nextTree.sha, parents: [revision] }) });
      await request(`/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
      return commit.sha;
    }
  };
}

function apply(registry, input) {
  if (!safeId(input.draft?.id)) throw new Error('unsafe template id');
  if (input.draft.art !== `art/${input.draft.id}.jpg`) throw new Error('artwork path must match template id');
  const templates = structuredClone(registry.templates);
  if (input.mode === 'existing') {
    const index = templates.findIndex(({ id }) => id === input.originalId);
    if (index < 0) throw new Error('existing template was not found');
    templates.splice(index, 1);
  } else if (templates.some(({ id }) => id === input.draft.id)) throw new Error('template id already exists');
  if (templates.some(({ id }) => id === input.draft.id)) throw new Error('template id already exists');
  const matching = templates.map((item, index) => item.category === input.draft.category ? index : -1).filter((index) => index >= 0);
  const position = Number(input.categoryPosition);
  if (!Number.isInteger(position) || position < 0 || position > matching.length) throw new Error('invalid category order');
  const at = !matching.length ? templates.length : position === matching.length ? matching.at(-1) + 1 : matching[position];
  templates.splice(at, 0, structuredClone(input.draft));
  return { ...registry, templates };
}

function validateTemplate(template) {
  const errors = [];
  if (!safeId(template.id)) errors.push('Template ID must use lowercase words and hyphens.');
  if (!template.label || !template.category) errors.push('Label and category are required.');
  if (!Number.isInteger(template.w) || !Number.isInteger(template.h) || template.w < 100 || template.h < 100) errors.push('Artwork dimensions are invalid.');
  for (const [name, value] of Object.entries({ ...template.photo, x: template.name?.x, y: template.name?.y, maxWidth: template.name?.maxWidth, size: template.name?.size })) {
    if (name === 'shape') continue;
    if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`${name} must be between 0 and 1.`);
  }
  return errors;
}

function artwork(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('approved JPEG artwork is required');
  const bytes = decode64(dataUrl.split(',')[1]);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('artwork is not a JPEG');
  return bytes;
}

export async function onRequest(context) {
  let who;
  try {
    who = await actor(context.request, context.env);
  } catch (error) {
    return json({ error: `authentication validation failed: ${error.code || error.message}` }, 401);
  }
  if (!who) return json({ error: 'sign in with an authorized Good Life Trainings account' }, 401);
  const path = new URL(context.request.url).pathname;
  try {
    if (context.request.method === 'GET' && path.endsWith('/session')) return json({ actor: who });
    const repo = github(context.env);
    const snap = await repo.snapshot();
    if (context.request.method === 'GET' && path.endsWith('/catalog')) return json({ registry: JSON.parse(snap.catalog), revision: snap.revision });
    const input = await context.request.json();
    if (path.endsWith('/validate')) {
      const errors = validateTemplate(input.draft || {});
      if (errors.length) return json({ ok: false, validation: { ok: false, messages: errors } });
      apply(JSON.parse(snap.catalog), input); artwork(input.artworkDataUrl);
      return json({ ok: true, validation: { ok: true, messages: ['Template is valid for hosted publication.'] }, baseRevision: snap.revision });
    }
    if (path.endsWith('/publish')) {
      if (input.baseRevision !== snap.revision) return json({ error: 'production changed; reload and review before publishing', code: 'STALE_REVISION' }, 409);
      const errors = validateTemplate(input.draft || {});
      if (errors.length) throw new Error(errors.join(' '));
      const registry = apply(JSON.parse(snap.catalog), input);
      const image = artwork(input.artworkDataUrl);
      const art = `public/art/${input.draft.id}.jpg`;
      const sha = await repo.commit({ revision: snap.revision, treeSha: snap.treeSha, message: `${input.mode === 'new' ? 'Add' : 'Update'} ${input.draft.label} template`, actor: who, writes: { [CATALOG]: `${JSON.stringify(registry, null, 2)}\n`, [art]: image } });
      return json({ ok: true, commitSha: sha, deployment: 'Published to GitHub; deployment in progress', affectedFiles: [CATALOG, art] });
    }
    return json({ error: 'not found' }, 404);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
}
