/* ============================================================
   Recognition Studio
   Three-layer flyer compositor: background art, person cutout,
   foreground art + live text. Everything renders at full export
   resolution on one canvas, so what you see is what downloads.
   ============================================================ */

const $ = (s) => document.querySelector(s);

const els = {
  canvas: $('#flyer'),
  wrap:   $('#canvasWrap'),
  cats:   $('#cats'),
  chips:  $('#templates'),
  fields: $('#fields'),
  file:   $('#file'),
  fileBtnText: $('#fileBtnText'),
  clearPhoto: $('#clearPhoto'),
  photoTools: $('#photoTools'),
  scale:  $('#scale'),
  recut:  $('#recut'),
  nocut:  $('#nocut'),
  cutNote: $('#cutNote'),
  formats: $('#formats'),
  download: $('#download'),
  status: $('#status'),
  statusText: $('#statusText'),
  veil: $('#veil'),
  veilText: $('#veilText'),
  veilSub: $('#veilSub'),
  hint: $('#dragHint'),
};

const ctx = els.canvas.getContext('2d');

const state = {
  templates: [],
  category: null,
  templateId: null,
  format: '4:5',
  values: {},
  photo: null,        // { img, natural, source }
  place: { dx: 0, dy: 0, scale: 1 },
  rendering: false,
};

const imgCache = new Map();

/* ── helpers ─────────────────────────────────────────────── */

function status(text, kind = '') {
  els.statusText.textContent = text;
  els.status.className = 'status' + (kind ? ' ' + kind : '');
}

function busy(on, text, sub = '') {
  els.veil.hidden = !on;
  if (on) {
    els.veilText.textContent = text;
    els.veilSub.textContent = sub;
  }
}

function loadImage(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const p = new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not load ' + src));
    i.src = src;
  });
  imgCache.set(src, p);
  return p;
}

const tpl = () => state.templates.find((t) => t.id === state.templateId);
const fmt = () => tpl()?.formats[state.format];

/* ── text drawing (tracking + auto-fit + gradient) ───────── */

const NATIVE_TRACKING = 'letterSpacing' in ctx;

function applyFont(px, weight, trackPx) {
  ctx.font = `${weight} ${px}px Geist, "Helvetica Neue", sans-serif`;
  if (NATIVE_TRACKING) ctx.letterSpacing = `${trackPx}px`;
}

function measureText(text, px, weight, trackPx) {
  applyFont(px, weight, trackPx);
  if (NATIVE_TRACKING) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + trackPx;
  return w - trackPx;
}

function paintText(text, x, y, px, weight, trackPx, align, fill) {
  applyFont(px, weight, trackPx);
  ctx.fillStyle = fill;
  if (NATIVE_TRACKING) {
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    return;
  }
  // manual tracking fallback for older browsers
  const total = measureText(text, px, weight, trackPx);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + trackPx;
  }
}

function drawField(field, W, H) {
  const s = field.style;
  let text = (state.values[field.key] ?? '').trim();
  if (!text) return;
  if (s.case === 'upper') text = text.toUpperCase();

  const maxW = (s.maxWidth ?? 0.86) * W;
  let px = s.size * W;
  const weight = s.weight ?? 700;
  let track = (s.tracking ?? 0) * px;

  // shrink to fit, never overflow the safe width
  let w = measureText(text, px, weight, track);
  let guard = 0;
  while (w > maxW && px > 10 && guard++ < 40) {
    px *= Math.max(0.86, maxW / w);
    track = (s.tracking ?? 0) * px;
    w = measureText(text, px, weight, track);
  }

  const x = (s.x ?? 0.5) * W;
  const y = (s.y ?? 0.5) * H;

  let fill = s.color || '#ffffff';
  if (s.gradient) {
    const g = ctx.createLinearGradient(0, y - px * 0.82, 0, y + px * 0.12);
    g.addColorStop(0, s.gradient[0]);
    g.addColorStop(1, s.gradient[1]);
    fill = g;
  }

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.72)';
  ctx.shadowBlur = px * 0.30;
  ctx.shadowOffsetY = px * 0.045;
  ctx.textBaseline = 'alphabetic';
  paintText(text, x, y, px, weight, track, s.align ?? 'center', fill);
  ctx.restore();
}

/* ── render ──────────────────────────────────────────────── */

async function render() {
  const t = tpl();
  const f = fmt();
  if (!t || !f) return;

  if (els.canvas.width !== f.w || els.canvas.height !== f.h) {
    els.canvas.width = f.w;
    els.canvas.height = f.h;
  }
  const W = f.w, H = f.h;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#080c12';
  ctx.fillRect(0, 0, W, H);

  const [bg, fg] = await Promise.all([loadImage(f.bg), loadImage(f.fg)]);
  ctx.drawImage(bg, 0, 0, W, H);

  if (state.photo) {
    const img = state.photo.img;
    const drawH = f.personHeight * H * state.place.scale;
    const drawW = drawH * (img.naturalWidth / img.naturalHeight);
    const cx = W / 2 + state.place.dx * W;
    const top = f.personTop * H + state.place.dy * H;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = W * 0.05;
    ctx.shadowOffsetY = W * 0.012;
    ctx.drawImage(img, cx - drawW / 2, top, drawW, drawH);
    ctx.restore();
  }

  ctx.drawImage(fg, 0, 0, W, H);
  for (const field of t.fields) drawField(field, W, H);
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(async () => {
    renderQueued = false;
    try { await render(); } catch (e) { console.error(e); }
  });
}

/* ── template + field UI ─────────────────────────────────── */

function buildCategories() {
  const cats = [...new Set(state.templates.map((t) => t.category))];
  state.category = state.category || cats[0];
  els.cats.innerHTML = '';
  for (const c of cats) {
    const b = document.createElement('button');
    b.className = 'cat' + (c === state.category ? ' is-on' : '');
    b.textContent = c;
    b.onclick = () => {
      state.category = c;
      const first = state.templates.find((t) => t.category === c);
      selectTemplate(first.id);
      buildCategories();
      buildChips();
    };
    els.cats.appendChild(b);
  }
}

function buildChips() {
  els.chips.innerHTML = '';
  for (const t of state.templates.filter((x) => x.category === state.category)) {
    const b = document.createElement('button');
    b.className = 'chip' + (t.id === state.templateId ? ' is-on' : '');
    b.style.setProperty('--acc', t.accent);
    b.innerHTML = `<span class="swatch"></span><b></b>`;
    b.querySelector('b').textContent = t.label;
    b.onclick = () => { selectTemplate(t.id); buildChips(); };
    els.chips.appendChild(b);
  }
  const on = els.chips.querySelector('.is-on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

function buildFields() {
  const t = tpl();
  els.fields.innerHTML = '';
  for (const f of t.fields) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const id = 'f_' + f.key;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = f.label;
    const input = document.createElement('input');
    input.id = id;
    input.type = 'text';
    input.value = state.values[f.key] ?? '';
    input.placeholder = f.key === 'name' ? 'Their name' : (f.default || '');
    input.autocomplete = 'off';
    input.oninput = () => { state.values[f.key] = input.value; scheduleRender(); };
    wrap.append(label, input);
    els.fields.appendChild(wrap);
  }
}

function selectTemplate(id) {
  const prev = tpl();
  state.templateId = id;
  const t = tpl();
  // carry typed text across templates, refresh the template-owned defaults
  for (const f of t.fields) {
    const wasDefault = prev && (state.values[f.key] ?? '') ===
      (prev.fields.find((p) => p.key === f.key)?.default ?? '');
    if (state.values[f.key] === undefined || wasDefault) state.values[f.key] = f.default;
  }
  buildFields();
  scheduleRender();
}

/* ── photo pipeline ──────────────────────────────────────── */

function compress(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      if (scale === 1 && file.size < 1_500_000) return resolve(file);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image we can read.')); };
    img.src = url;
  });
}

async function serverCutout(blob) {
  const fd = new FormData();
  fd.append('file', blob, 'photo.jpg');
  const r = await fetch('/api/cutout', { method: 'POST', body: fd });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    const err = new Error(detail || ('cutout failed: ' + r.status));
    err.status = r.status;
    throw err;
  }
  return await r.blob();
}

let imglyPromise = null;
async function browserCutout(blob, onProgress) {
  if (!imglyPromise) {
    imglyPromise = import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.6.0/+esm');
  }
  const mod = await imglyPromise;
  const removeBackground = mod.removeBackground || mod.default;
  return await removeBackground(blob, {
    output: { format: 'image/png' },
    progress: (key, cur, total) => {
      if (onProgress && total) onProgress(key, Math.round((cur / total) * 100));
    },
  });
}

async function setPhotoFromBlob(blob, source) {
  const url = URL.createObjectURL(blob);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not open that photo.'));
    i.src = url;
  });
  if (state.photo?.url) URL.revokeObjectURL(state.photo.url);
  state.photo = { img, url, source };
  els.photoTools.hidden = false;
  els.clearPhoto.hidden = false;
  els.fileBtnText.textContent = 'Change photo';
  showHint();
  scheduleRender();
}

let lastOriginal = null;

async function handleFile(file) {
  if (!file) return;
  try {
    busy(true, 'Getting the photo ready');
    status('Working', 'busy');
    lastOriginal = await compress(file);
    state.place = { dx: 0, dy: 0, scale: 1 };
    els.scale.value = 100;
    await runCutout(lastOriginal);
  } catch (e) {
    console.error(e);
    busy(false);
    status('Problem', 'bad');
    els.cutNote.className = 'note warn';
    els.cutNote.textContent = e.message;
  }
}

async function runCutout(blob) {
  els.cutNote.className = 'note';
  els.cutNote.textContent = '';
  try {
    busy(true, 'Cutting out the background', 'Using the fast server');
    status('Cutting out', 'busy');
    const out = await serverCutout(blob);
    await setPhotoFromBlob(out, 'server');
    busy(false);
    status('Ready', 'ok');
    els.cutNote.textContent = 'Background removed.';
  } catch (e) {
    console.warn('server cutout unavailable:', e.message);
    try {
      busy(true, 'Cutting out the background', 'First time takes about a minute');
      status('Cutting out', 'busy');
      const out = await browserCutout(blob, (key, pct) => {
        els.veilSub.textContent = key.startsWith('fetch')
          ? `Downloading the cutout tool, ${pct}%`
          : `Working, ${pct}%`;
      });
      await setPhotoFromBlob(out, 'browser');
      busy(false);
      status('Ready', 'ok');
      els.cutNote.textContent = 'Background removed on this device.';
    } catch (e2) {
      console.error(e2);
      await setPhotoFromBlob(blob, 'raw');
      busy(false);
      status('Photo added', 'ok');
      els.cutNote.className = 'note warn';
      els.cutNote.textContent = 'Could not remove the background, so the photo went in as-is. Tap "Redo cutout" to try again.';
    }
  }
}

/* ── drag, pinch, scale ──────────────────────────────────── */

let hintTimer;
function showHint() {
  els.hint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => els.hint.classList.remove('show'), 2600);
}

const pointers = new Map();
let dragStart = null;
let pinchStart = null;

els.canvas.addEventListener('pointerdown', (e) => {
  if (!state.photo) return;
  els.canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    dragStart = { x: e.clientX, y: e.clientY, dx: state.place.dx, dy: state.place.dy };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: state.place.scale };
    dragStart = null;
  }
});

els.canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const rect = els.canvas.getBoundingClientRect();

  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    state.place.scale = clamp(pinchStart.scale * (d / pinchStart.d), 0.3, 1.3);
    els.scale.value = Math.round(state.place.scale * 100);
    scheduleRender();
    return;
  }
  if (dragStart) {
    state.place.dx = clamp(dragStart.dx + (e.clientX - dragStart.x) / rect.width, -0.5, 0.5);
    state.place.dy = clamp(dragStart.dy + (e.clientY - dragStart.y) / rect.height, -0.55, 0.65);
    scheduleRender();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) dragStart = null;
}
els.canvas.addEventListener('pointerup', endPointer);
els.canvas.addEventListener('pointercancel', endPointer);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

els.scale.addEventListener('input', () => {
  state.place.scale = Number(els.scale.value) / 100;
  scheduleRender();
});

/* ── wiring ──────────────────────────────────────────────── */

els.file.addEventListener('change', (e) => handleFile(e.target.files[0]));

els.clearPhoto.addEventListener('click', () => {
  if (state.photo?.url) URL.revokeObjectURL(state.photo.url);
  state.photo = null;
  lastOriginal = null;
  els.file.value = '';
  els.photoTools.hidden = true;
  els.clearPhoto.hidden = true;
  els.fileBtnText.textContent = 'Choose photo';
  els.cutNote.textContent = '';
  els.cutNote.className = 'note';
  status('Ready');
  scheduleRender();
});

els.recut.addEventListener('click', () => { if (lastOriginal) runCutout(lastOriginal); });
els.nocut.addEventListener('click', async () => {
  if (!lastOriginal) return;
  await setPhotoFromBlob(lastOriginal, 'raw');
  els.cutNote.className = 'note';
  els.cutNote.textContent = 'Using the photo as-is, background included.';
});

els.formats.addEventListener('click', (e) => {
  const b = e.target.closest('.fmt');
  if (!b) return;
  state.format = b.dataset.fmt;
  els.formats.querySelectorAll('.fmt').forEach((x) => x.classList.toggle('is-on', x === b));
  scheduleRender();
});

els.download.addEventListener('click', async () => {
  await render();
  const name = (state.values.name || 'flyer').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flyer';
  const label = (tpl()?.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const size = state.format === '4:5' ? 'post' : 'story';
  els.canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-${label}-${size}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    status('Downloaded', 'ok');
  }, 'image/png');
});

/* exposed so automated checks can drive the renderer directly */
window.__studio = { state, render, scheduleRender, setPhotoFromBlob, runCutout };

/* ── boot ────────────────────────────────────────────────── */

(async function boot() {
  try {
    status('Loading', 'busy');
    const data = await (await fetch('templates.json')).json();
    state.templates = data.templates;
    buildCategories();
    state.templateId = state.templates.find((t) => t.category === state.category).id;
    buildChips();
    selectTemplate(state.templateId);
    try { await document.fonts.load('800 100px Geist'); await document.fonts.ready; } catch {}
    await render();
    status('Ready', 'ok');
  } catch (e) {
    console.error(e);
    status('Load failed', 'bad');
  }
})();
