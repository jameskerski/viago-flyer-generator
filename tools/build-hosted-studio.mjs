import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist', 'studio');

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'runtime'), { recursive: true });
await cp(resolve(root, 'studio'), output, { recursive: true });
await cp(resolve(root, 'public'), resolve(output, 'runtime'), { recursive: true });

