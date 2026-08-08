import { expect, test } from '@playwright/test';
import { mkdtemp, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudioService } from '../../tools/template-studio-server.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('explicit promotion succeeds only in a temporary repository and preserves existing templates', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'viago-studio-promotion-'));
  await cp(resolve(ROOT, 'public'), resolve(temporary, 'public'), { recursive: true });
  const before = JSON.parse(await readFile(resolve(temporary, 'public/templates.json'), 'utf8'));
  const artwork = await readFile(resolve(ROOT, 'public/art/club-4.jpg'));
  const draft = {
    id: 'studio-fixture', label: 'Studio Fixture', category: 'General', accent: '#8dfa00', art: 'art/studio-fixture.jpg', w: 800, h: 1080,
    photo: { shape: 'circle', x: .2, y: .25, w: .5, h: .5 },
    name: { x: .5, y: .85, maxWidth: .7, size: .05, font: 'Josefin Sans', weight: 700, color: '#ffffff', align: 'center', case: 'upper', tracking: .02, wrap: true, maxLines: 2, lineHeight: 1.15, vAlign: 'top' }
  };
  const service = createStudioService(temporary);
  const plan = await service.plan({ mode: 'new', originalId: null, draft, categoryPosition: 4, artworkDataUrl: `data:image/jpeg;base64,${artwork.toString('base64')}` });
  expect(plan.ok).toBe(true);
  await expect(service.promote({ planToken: plan.planToken, confirmation: 'not confirmed' })).rejects.toThrow('type PROMOTE');
  const result = await service.promote({ planToken: plan.planToken, confirmation: 'PROMOTE' });
  expect(result.ok).toBe(true);
  expect(result.validation.ok).toBe(true);
  const after = JSON.parse(await readFile(resolve(temporary, 'public/templates.json'), 'utf8'));
  expect(after.templates.filter(({ id }) => id !== 'studio-fixture')).toEqual(before.templates);
  expect(after.templates.map(({ id }) => id).slice(0, 5)).toEqual(['club-4', 'mission-30', 'amplified', 'welcome', 'studio-fixture']);
  expect(await readFile(resolve(temporary, 'public/art/studio-fixture.jpg'))).toEqual(artwork);
});
