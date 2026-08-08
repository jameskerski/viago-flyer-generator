import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const CATALOG = 'public/templates.json';
const artPath = (id) => `public/art/${id}.jpg`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safeId = (id) => typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);

function jpeg(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('approved JPEG artwork is required');
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('artwork is not a JPEG');
  return bytes;
}

function runValidator(root, validator) {
  return new Promise((done) => {
    const child = spawn('python3', [validator, '--root', root, '--skip-baseline-inventory']); let output = '';
    child.stdout.on('data', (v) => { output += v; }); child.stderr.on('data', (v) => { output += v; });
    child.on('close', (code) => done({ ok: code === 0, messages: output.trim().split('\n').filter(Boolean) }));
  });
}

function insert(registry, input) {
  const templates = structuredClone(registry.templates);
  if (!safeId(input.draft?.id)) throw new Error('unsafe template id');
  if (input.mode === 'existing') {
    const index = templates.findIndex(({ id }) => id === input.originalId);
    if (index < 0) throw new Error('existing template was not found');
    templates.splice(index, 1);
  } else if (templates.some(({ id }) => id === input.draft.id)) throw new Error('template id already exists');
  if (templates.some(({ id }) => id === input.draft.id)) throw new Error('template id already exists');
  const matches = templates.map((item, index) => item.category === input.draft.category ? index : -1).filter((i) => i >= 0);
  const position = Number(input.categoryPosition);
  if (!Number.isInteger(position) || position < 0 || position > matches.length) throw new Error('invalid category order');
  const at = !matches.length ? templates.length : position === matches.length ? matches.at(-1) + 1 : matches[position];
  templates.splice(at, 0, structuredClone(input.draft));
  return { ...registry, templates };
}

export function createPublishingService({ repository, validatorRoot }) {
  const validator = resolve(validatorRoot, 'tools/validate_baseline.py');
  async function validateResult(catalog, artworkWrites = {}, deletions = []) {
    const temporary = await mkdtemp(resolve(validatorRoot, '.viago-hosted-validation-'));
    try {
      await cp(resolve(validatorRoot, 'public'), resolve(temporary, 'public'), { recursive: true });
      await mkdir(resolve(temporary, 'docs'), { recursive: true });
      await writeFile(resolve(temporary, CATALOG), JSON.stringify(catalog, null, 2) + '\n');
      for (const [path, bytes] of Object.entries(artworkWrites)) await writeFile(resolve(temporary, path), bytes);
      for (const path of deletions) await rm(resolve(temporary, path), { force: true });
      return await runValidator(temporary, validator);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  return {
    async catalog() { const snap = await repository.snapshot(); return { registry: JSON.parse(snap.catalog), revision: snap.revision, catalogHash: hash(snap.catalog) }; },
    async publish(input, actor) {
      if (!actor?.id) throw new Error('authenticated TEMPLATE_ADMIN is required');
      const snap = await repository.snapshot();
      if (input.baseRevision !== snap.revision) { const error = new Error('production changed; reload and review before publishing'); error.code = 'STALE_REVISION'; throw error; }
      const before = JSON.parse(snap.catalog); const after = insert(before, input); const artwork = jpeg(input.artworkDataUrl);
      const path = artPath(input.draft.id); if (input.draft.art !== `art/${input.draft.id}.jpg`) throw new Error('artwork path must match template id');
      const validation = await validateResult(after, { [path]: artwork });
      if (!validation.ok) { const error = new Error(`candidate validation failed: ${validation.messages.join(' | ')}`); error.validation = validation; throw error; }
      const message = `${input.mode === 'new' ? 'Add' : 'Update'} ${input.draft.label} template`;
      const result = await repository.commit({ baseRevision: snap.revision, baseTree: snap.treeSha, message, actor, writes: { [CATALOG]: JSON.stringify(after, null, 2) + '\n', [path]: artwork } });
      return { ok: true, commitSha: result.sha, deployment: 'Published to GitHub; deployment in progress', affectedFiles: [CATALOG, path] };
    },
    async retire(input, actor) {
      if (!actor?.id) throw new Error('authenticated TEMPLATE_ADMIN is required');
      if (input.confirmed !== true) throw new Error('retirement confirmation is required');
      if (!safeId(input.templateId)) throw new Error('unsafe template id');
      const snap = await repository.snapshot();
      if (input.baseRevision !== snap.revision) { const error = new Error('production changed; reload and review before retiring'); error.code = 'STALE_REVISION'; throw error; }
      const before = JSON.parse(snap.catalog); const target = before.templates.find(({ id }) => id === input.templateId);
      if (!target) throw new Error('template was not found');
      const after = { ...before, templates: before.templates.filter(({ id }) => id !== input.templateId) };
      const path = artPath(target.id); const referenced = after.templates.some(({ art }) => art === target.art); const deletes = referenced ? [] : [path];
      const validation = await validateResult(after, {}, deletes);
      if (!validation.ok) { const error = new Error(`resulting catalog validation failed: ${validation.messages.join(' | ')}`); error.validation = validation; throw error; }
      const result = await repository.commit({ baseRevision: snap.revision, baseTree: snap.treeSha, message: `Retire ${target.label} template`, actor, writes: { [CATALOG]: JSON.stringify(after, null, 2) + '\n' }, deletes });
      return { ok: true, commitSha: result.sha, deployment: 'Published to GitHub; deployment in progress', affectedFiles: [CATALOG, ...deletes] };
    }
  };
}
