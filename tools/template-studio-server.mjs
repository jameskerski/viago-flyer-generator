#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_ROOT = resolve(import.meta.dirname, '..');
const MAX_BODY = 20 * 1024 * 1024;
const MIME = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml'
};

const hash = (value) => createHash('sha256').update(value).digest('hex');
function decodeArtwork(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;base64,')) {
    throw new Error('candidate artwork must be a base64 JPEG data URL');
  }
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('candidate artwork is not a readable JPEG');
  return bytes;
}

function applyDraft(registry, request) {
  const draft = structuredClone(request.draft);
  const templates = registry.templates.map((template) => structuredClone(template));
  if (!draft || typeof draft !== 'object') throw new Error('draft template is required');
  if (request.mode === 'existing') {
    const index = templates.findIndex((template) => template.id === request.originalId);
    if (index < 0) throw new Error(`existing template '${request.originalId}' was not found`);
    templates.splice(index, 1);
  } else if (templates.some((template) => template.id === draft.id)) {
    throw new Error(`duplicate template id '${draft.id}'`);
  }
  if (templates.some((template) => template.id === draft.id)) throw new Error(`duplicate template id '${draft.id}'`);
  const categoryIndexes = templates.map((template, index) => template.category === draft.category ? index : -1).filter((index) => index >= 0);
  const requested = Number(request.categoryPosition);
  if (!Number.isInteger(requested) || requested < 0 || requested > categoryIndexes.length) {
    throw new Error(`category position must be between 0 and ${categoryIndexes.length}`);
  }
  let insertion;
  if (!categoryIndexes.length) insertion = templates.length;
  else if (requested === categoryIndexes.length) insertion = categoryIndexes.at(-1) + 1;
  else insertion = categoryIndexes[requested];
  templates.splice(insertion, 0, draft);
  return { ...registry, templates };
}

function runValidator(root, validatorPath) {
  return new Promise((resolvePromise) => {
    const child = spawn('python3', [validatorPath, '--root', root, '--skip-baseline-inventory'], { cwd: root });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolvePromise({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim(), messages: [...stderr.split('\n'), ...stdout.split('\n')].filter(Boolean) }));
  });
}

export function createStudioService(root = DEFAULT_ROOT) {
  root = resolve(root);
  const plans = new Map();
  const registryPath = resolve(root, 'public/templates.json');
  const validatorPath = resolve(DEFAULT_ROOT, 'tools/validate_baseline.py');

  async function catalog() {
    const bytes = await readFile(registryPath);
    return { registry: JSON.parse(bytes), registryHash: hash(bytes) };
  }

  async function evaluate(request, { createPlan = false } = {}) {
    const artwork = decodeArtwork(request.artworkDataUrl);
    const beforeBytes = await readFile(registryPath);
    const before = JSON.parse(beforeBytes);
    let after;
    try {
      after = applyDraft(before, request);
    } catch (error) {
      return { ok: false, validation: { ok: false, messages: [`ERROR: ${error.message}`] } };
    }
    const temporary = await mkdtemp(resolve(tmpdir(), 'viago-studio-'));
    try {
      await cp(resolve(root, 'public'), resolve(temporary, 'public'), { recursive: true });
      await mkdir(resolve(temporary, 'docs'), { recursive: true });
      await writeFile(resolve(temporary, 'public/templates.json'), JSON.stringify(after, null, 2) + '\n');
      await writeFile(resolve(temporary, 'public/art', `${request.draft.id}.jpg`), artwork);
      const validation = await runValidator(temporary, validatorPath);
      const result = {
        ok: validation.ok,
        validation,
        beforeHash: hash(beforeBytes),
        artworkHash: hash(artwork),
        artworkBytes: artwork.length,
        beforeOrder: before.templates.map(({ id, category }) => ({ id, category })),
        afterOrder: after.templates.map(({ id, category }) => ({ id, category })),
        targetArtwork: `public/art/${request.draft.id}.jpg`,
        targetCatalog: 'public/templates.json',
        retainedArtwork: request.mode === 'existing' && request.originalId !== request.draft.id ? `public/art/${request.originalId}.jpg is retained; deletion is never automatic` : null
      };
      if (validation.ok && createPlan) {
        const token = hash(Buffer.concat([Buffer.from(result.beforeHash + result.artworkHash + JSON.stringify(request)), artwork]));
        plans.set(token, { request: structuredClone(request), artwork, beforeBytes, after, result });
        result.planToken = token;
      }
      return result;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async function promote({ planToken, confirmation }) {
    if (confirmation !== 'PROMOTE') throw new Error('type PROMOTE to authorize repository mutation');
    const plan = plans.get(planToken);
    if (!plan) throw new Error('promotion plan is missing or expired; prepare it again');
    const currentBytes = await readFile(registryPath);
    if (hash(currentBytes) !== plan.result.beforeHash) throw new Error('catalog changed after planning; prepare a new plan');
    const artPath = resolve(root, 'public/art', `${plan.request.draft.id}.jpg`);
    const previousArt = await readFile(artPath).catch(() => null);
    const tempCatalog = resolve(root, 'public', `.templates.studio-${process.pid}.json`);
    const tempArt = resolve(root, 'public/art', `.${plan.request.draft.id}.studio-${process.pid}.jpg`);
    try {
      await writeFile(tempCatalog, JSON.stringify(plan.after, null, 2) + '\n');
      await writeFile(tempArt, plan.artwork);
      await rename(tempArt, artPath);
      await rename(tempCatalog, registryPath);
      const validation = await runValidator(root, validatorPath);
      if (!validation.ok) throw new Error(`post-promotion validation failed: ${validation.messages.join(' | ')}`);
      plans.delete(planToken);
      return { ok: true, validation, catalogHash: hash(await readFile(registryPath)), artworkHash: hash(await readFile(artPath)) };
    } catch (error) {
      await writeFile(registryPath, currentBytes);
      if (previousArt) await writeFile(artPath, previousArt);
      else await rm(artPath, { force: true });
      await rm(tempCatalog, { force: true });
      await rm(tempArt, { force: true });
      throw error;
    }
  }

  return { root, catalog, validate: (request) => evaluate(request), plan: (request) => evaluate(request, { createPlan: true }), promote };
}

async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('request exceeds 20 MiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function staticFile(response, base, relative) {
  const file = resolve(base, relative || 'index.html');
  if (file !== base && !file.startsWith(base + sep)) return json(response, 403, { error: 'forbidden' });
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    response.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(response);
  } catch { json(response, 404, { error: 'not found' }); }
}

export function createStudioServer({ root = DEFAULT_ROOT, port = 4173 } = {}) {
  root = resolve(root);
  const service = createStudioService(root);
  const studioRoot = resolve(DEFAULT_ROOT, 'studio');
  const publicRoot = resolve(root, 'public');
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
      if (url.pathname === '/studio') { response.writeHead(302, { Location: '/studio/' }).end(); return; }
      if (url.pathname === '/api/studio/catalog' && request.method === 'GET') return json(response, 200, await service.catalog());
      if (url.pathname === '/api/studio/validate' && request.method === 'POST') return json(response, 200, await service.validate(await body(request)));
      if (url.pathname === '/api/studio/plan' && request.method === 'POST') return json(response, 200, await service.plan(await body(request)));
      if (url.pathname === '/api/studio/promote' && request.method === 'POST') return json(response, 200, await service.promote(await body(request)));
      if (url.pathname.startsWith('/api/')) return json(response, 501, { error: 'No production API is configured in the local Studio server.' });
      if (url.pathname.startsWith('/studio/')) return staticFile(response, studioRoot, url.pathname.slice('/studio/'.length));
      if (url.pathname.startsWith('/runtime/')) return staticFile(response, publicRoot, url.pathname.slice('/runtime/'.length));
      return staticFile(response, publicRoot, url.pathname.slice(1));
    } catch (error) { json(response, 400, { error: error.message }); }
  });
  return { server, service, listen: () => new Promise((done) => server.listen(port, '127.0.0.1', () => done(server.address()))), close: () => new Promise((done) => server.close(done)) };
}

function cliArgs(argv) {
  const result = { root: DEFAULT_ROOT, port: 4173 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') result.root = resolve(argv[++index]);
    else if (argv[index] === '--port') result.port = Number(argv[++index]);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const app = createStudioServer(cliArgs(process.argv.slice(2)));
  app.listen().then((address) => console.log(`VIAGO Template Studio: http://127.0.0.1:${address.port}/studio/`));
}
