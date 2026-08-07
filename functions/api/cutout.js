/**
 * POST /api/cutout
 *
 * FormData field `file` in, transparent PNG out.
 *
 * Provider is chosen by whichever secret is set on the Pages project:
 *   FAL_KEY               -> fal.ai BiRefNet v2   (~$0.001 per photo, fastest)
 *   REPLICATE_API_TOKEN   -> Replicate            (fallback)
 *
 * With neither set this returns 501 and the browser falls back to
 * doing the cutout on the device. Add a key and the fast path turns
 * on with no code change.
 */

const FAL_MODEL_DEFAULT = 'fal-ai/birefnet/v2';
const REPLICATE_VERSION_DEFAULT =
  '4067ee2a58f6c161d434a9c077cfa012820b8e076efa2772aa171e26557da919'; // lucataco/remove-bg

const MAX_BYTES = 12 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  let file;
  try {
    const form = await request.formData();
    file = form.get('file');
  } catch {
    return text(400, 'Could not read the uploaded photo.');
  }
  if (!file || typeof file === 'string') return text(400, 'No photo was uploaded.');
  if (file.size > MAX_BYTES) return text(413, 'That photo is too big. Try one under 12MB.');

  const buf = await file.arrayBuffer();
  const dataUri = `data:${file.type || 'image/jpeg'};base64,${b64(buf)}`;

  try {
    if (env.FAL_KEY) return await png(await viaFal(env, dataUri));
    if (env.REPLICATE_API_TOKEN) return await png(await viaReplicate(env, dataUri));
    return text(501, 'No cutout service is configured on the server.');
  } catch (e) {
    return text(502, `Cutout service error: ${e.message}`);
  }
}

/* ── providers ───────────────────────────────────────────── */

async function viaFal(env, dataUri) {
  const model = env.FAL_MODEL || FAL_MODEL_DEFAULT;
  const r = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image_url: dataUri }),
  });
  if (!r.ok) throw new Error(`fal ${r.status} ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const url = j?.image?.url || j?.images?.[0]?.url || j?.output?.url;
  if (!url) throw new Error('fal returned no image');
  return url;
}

async function viaReplicate(env, dataUri) {
  const version = env.REPLICATE_VERSION || REPLICATE_VERSION_DEFAULT;
  const r = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60',
    },
    body: JSON.stringify({ version, input: { image: dataUri } }),
  });
  if (!r.ok) throw new Error(`replicate ${r.status} ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const out = Array.isArray(j.output) ? j.output[0] : j.output;
  if (!out) throw new Error(`replicate returned no image (status ${j.status})`);
  return out;
}

/* ── plumbing ────────────────────────────────────────────── */

async function png(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not fetch result (${r.status})`);
  return new Response(r.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}

function text(status, body) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
