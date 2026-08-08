import { expect, test } from '@playwright/test';
import { onRequestPost } from '../../functions/api/cutout.js';

test('cutout rejects a request with no file', async () => {
  const form = new FormData();
  const response = await onRequestPost({ request: new Request('https://test.invalid/api/cutout', { method: 'POST', body: form }), env: {} });
  expect(response.status).toBe(400);
  expect(await response.text()).toBe('No photo was uploaded.');
});

test('cutout reports no configured provider without making a network call', async () => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([1, 2, 3])], 'fixture.jpg', { type: 'image/jpeg' }));
  const response = await onRequestPost({ request: new Request('https://test.invalid/api/cutout', { method: 'POST', body: form }), env: {} });
  expect(response.status).toBe(501);
  expect(await response.text()).toBe('No cutout service is configured on the server.');
});

test('cutout rejects uploads over 12 MiB before provider selection', async () => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(12 * 1024 * 1024 + 1)], 'oversize.jpg', { type: 'image/jpeg' }));
  const response = await onRequestPost({ request: new Request('https://test.invalid/api/cutout', { method: 'POST', body: form }), env: {} });
  expect(response.status).toBe(413);
  expect(await response.text()).toBe('That photo is too big. Try one under 12MB.');
});
