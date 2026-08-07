/* ============================================================
   Recognition Studio
   The photo drops into a window cut into the artwork: a rectangle
   on the rank flyers, a circle on the event ones. Artwork first,
   photo clipped to the window on top, live name last. Rendered at
   full export resolution, so the preview IS the downloaded file.
   ============================================================ */

const $ = (s) => document.querySelector(s);

const els = {
  canvas: $('#flyer'),
  cats: $('#cats'),
  chips: $('#templates'),
  file: $('#file'),
  fileBtnText: $('#fileBtnText'),
  clearPhoto: $('#clearPhoto'),
  photoTools: $('#photoTools'),
  zoom: $('#zoom'),
  cutout: $('#cutout'),
  nameInput: $('#nameInput'),
  download: $('#download'),
  status: $('#status'),
  statusText: $('#statusText'),
  veil: $('#veil'),
  veilText: $('#veilText'),
  veilSub: $('#veilSub'),
  hint: $('#dragHint'),
  note: $('#note'),
};

const ctx = els.canvas.getContext('2d');

const state = {
  templates: [],
  category: null,
  templateId: null,
  name: '',
  photo: null,               // { img, url }
  place: { dx: 0, dy: 0, zoom: 1 },
  original: null,            // the compressed upload, kept so cutout can be toggled
  cutoutOn: false,
};

const imgCache = new Map();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const tpl = () => state.templates.find((t) => t.id === state.templateId);

/* ── helpers ─────────────────────────────────────────────── */

function status(text, kind = '') {
  els.statusText.textContent = text;
  els.status.className = 'status' + (kind ? ' ' + kind : '');
}

function busy(on, text, sub = '') {
  els.veil.hidden = !on;
  if (on) { els.veilText.textContent = text; els.veilSub.textContent = sub; }
}

function note(text, warn = false) {
  els.note.textContent = text;
  els.note.className = 'note' + (warn ? ' warn' : '');
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

/* ── text ────────────────────────────────────────────────── */

const NATIVE_TRACKING = 'letterSpacing' in ctx;

function setFont(px, weight, family, trackPx) {
  ctx.font = `${weight} ${px}px "${family}", "Helvetica Neue", sans-serif`;
  if (NATIVE_TRACKING) ctx.letterSpacing = `${trackPx}px`;
}

function measure(text, px, weight, family, trackPx) {
  setFont(px, weight, family, trackPx);
  if (NATIVE_TRACKING) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + trackPx;
  return w - trackPx;
}

function paint(text, x, y, px, weight, family, trackPx, align, fill) {
  setFont(px, weight, family, trackPx);
  ctx.fillStyle = fill;
  if (NATIVE_TRACKING) { ctx.textAlign = align; ctx.fillText(text, x, y); return; }
  const total = measure(text, px, weight, family, trackPx);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + trackPx; }
}

function drawName(t, W, H) {
  const s = t.name;
  if (!s) return;
  let text = state.name.trim();
  if (!text) return;
  if (s.case === 'upper') text = text.toUpperCase();

  const family = s.font || 'Josefin Sans';
  const weight = s.weight || 700;
  const maxW = (s.maxWidth ?? 0.86) * W;
  const maxLines = s.wrap ? (s.maxLines || 3) : 1;
  const words = text.split(/\s+/).filter(Boolean);

  const trackFor = (px) => (s.tracking ?? 0.02) * px;

  // greedily break into lines that fit; a single line when wrap is off
  const linesAt = (px) => {
    if (!s.wrap) return [text];
    const tr = trackFor(px);
    const out = [];
    let cur = '';
    for (const word of words) {
      const cand = cur ? cur + ' ' + word : word;
      if (!cur || measure(cand, px, weight, family, tr) <= maxW) cur = cand;
      else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
    return out;
  };

  // Prefer wrapping over shrinking. Decide the line break-up first, at the
  // template's own size, and only then shrink if a line still will not fit.
  // Re-wrapping after every shrink is unstable: a smaller size lets the words
  // collapse back onto one tiny line instead of staying wrapped.
  let px = s.size * W;
  let lines = linesAt(px);
  for (let guard = 0; guard < 60 && lines.length > maxLines && px > 9; guard++) {
    px *= 0.94;
    lines = linesAt(px);
  }
  // now hold those lines and only scale down to fit the width
  for (let guard = 0; guard < 60; guard++) {
    const widest = Math.max(...lines.map((l) => measure(l, px, weight, family, trackFor(px))));
    if (widest <= maxW || px < 9) break;
    px *= 0.94;
  }

  // real glyph metrics, so centring is optical rather than guessed
  setFont(px, weight, family, trackFor(px));
  const m = ctx.measureText(lines[0]);
  const ascent = m.actualBoundingBoxAscent || px * 0.72;
  const descent = m.actualBoundingBoxDescent || px * 0.05;
  const lineH = (s.lineHeight ?? 1.15) * px;

  const x = (s.x ?? 0.5) * W;
  const y = (s.y ?? 0.5) * H;
  let firstBaseline;
  if (s.vAlign === 'middle') {
    const blockH = (lines.length - 1) * lineH + ascent + descent;
    firstBaseline = y - blockH / 2 + ascent;
  } else if (s.vAlign === 'top') {
    // y is the FIRST line's baseline; extra lines stack downward. Used where
    // there is room below but not above, as on the rank flyers.
    firstBaseline = y;
  } else {
    // y is the baseline of the LAST line; extra lines stack upward
    firstBaseline = y - (lines.length - 1) * lineH;
  }

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = px * 0.22;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => {
    paint(line, x, firstBaseline + i * lineH, px, weight, family,
          trackFor(px), s.align || 'center', s.color || '#ffffff');
  });
  ctx.restore();
}

/* ── render ──────────────────────────────────────────────── */

async function render() {
  const t = tpl();
  if (!t) return;
  if (els.canvas.width !== t.w || els.canvas.height !== t.h) {
    els.canvas.width = t.w; els.canvas.height = t.h;
  }
  const W = t.w, H = t.h;

  const art = await loadImage(t.art);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(art, 0, 0, W, H);

  if (state.photo) {
    const p = t.photo;
    const wx = p.x * W, wy = p.y * H, ww = p.w * W, wh = p.h * H;
    const img = state.photo.img;

    ctx.save();
    ctx.beginPath();
    if (p.shape === 'circle') ctx.ellipse(wx + ww / 2, wy + wh / 2, ww / 2, wh / 2, 0, 0, Math.PI * 2);
    else ctx.rect(wx, wy, ww, wh);
    ctx.clip();

    // fill the window, then apply the leader's nudge and zoom
    const cover = Math.max(ww / img.naturalWidth, wh / img.naturalHeight);
    const scale = cover * state.place.zoom;
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    const cx = wx + ww / 2 + state.place.dx * ww;
    const cy = wy + wh / 2 + state.place.dy * wh;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
  }

  drawName(t, W, H);
}

let queued = false;
function scheduleRender() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(async () => {
    queued = false;
    try { await render(); } catch (e) { console.error(e); }
  });
}

/* ── template UI ─────────────────────────────────────────── */

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
      select(state.templates.find((t) => t.category === c).id);
      buildCategories(); buildChips();
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
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    thumb.style.backgroundImage = `url("${t.art}")`;
    const label = document.createElement('b');
    label.textContent = t.label;
    b.append(thumb, label);
    b.onclick = () => { select(t.id); buildChips(); };
    els.chips.appendChild(b);
  }
  const on = els.chips.querySelector('.is-on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

function select(id) {
  state.templateId = id;
  state.place = { dx: 0, dy: 0, zoom: 1 };
  els.zoom.value = 100;
  scheduleRender();
}

/* ── photo ───────────────────────────────────────────────── */

function compress(file, maxSide = 1800) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      if (scale === 1 && file.size < 2_000_000) return resolve(file);
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

async function useBlob(blob) {
  const url = URL.createObjectURL(blob);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not open that photo.'));
    i.src = url;
  });
  if (state.photo?.url) URL.revokeObjectURL(state.photo.url);
  state.photo = { img, url };
  els.photoTools.hidden = false;
  els.clearPhoto.hidden = false;
  els.fileBtnText.textContent = 'Change photo';
  showHint();
  scheduleRender();
}

async function serverCutout(blob) {
  const fd = new FormData();
  fd.append('file', blob, 'photo.jpg');
  const r = await fetch('/api/cutout', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(await r.text().catch(() => 'cutout failed'));
  return await r.blob();
}

let imgly = null;
async function browserCutout(blob, onProgress) {
  if (!imgly) imgly = import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.6.0/+esm');
  const mod = await imgly;
  const removeBackground = mod.removeBackground || mod.default;
  return await removeBackground(blob, {
    output: { format: 'image/png' },
    progress: (key, cur, total) => { if (onProgress && total) onProgress(key, Math.round(cur / total * 100)); },
  });
}

async function applyCutout() {
  if (!state.original) return;
  try {
    busy(true, 'Removing the background', 'Using the fast server');
    status('Working', 'busy');
    await useBlob(await serverCutout(state.original));
    busy(false); status('Ready', 'ok');
    note('Background removed.');
  } catch (e) {
    try {
      busy(true, 'Removing the background', 'First time takes about a minute');
      await useBlob(await browserCutout(state.original, (k, pct) => {
        els.veilSub.textContent = k.startsWith('fetch') ? `Downloading the tool, ${pct}%` : `Working, ${pct}%`;
      }));
      busy(false); status('Ready', 'ok');
      note('Background removed on this device.');
    } catch (e2) {
      console.error(e2);
      await useBlob(state.original);
      els.cutout.checked = false;
      state.cutoutOn = false;
      busy(false); status('Photo added', 'ok');
      note('Could not remove the background, so the photo went in as it was.', true);
    }
  }
}

async function handleFile(file) {
  if (!file) return;
  try {
    busy(true, 'Getting the photo ready');
    status('Working', 'busy');
    state.original = await compress(file);
    state.place = { dx: 0, dy: 0, zoom: 1 };
    els.zoom.value = 100;
    if (state.cutoutOn) { await applyCutout(); return; }
    await useBlob(state.original);
    busy(false); status('Ready', 'ok');
    note('Drag the photo to move it, or use the Zoom slider.');
  } catch (e) {
    console.error(e);
    busy(false); status('Problem', 'bad');
    note(e.message, true);
  }
}

/* ── drag and zoom inside the window ─────────────────────── */

let hintTimer;
function showHint() {
  els.hint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => els.hint.classList.remove('show'), 2800);
}

const pointers = new Map();
let dragStart = null, pinchStart = null;

els.canvas.addEventListener('pointerdown', (e) => {
  if (!state.photo) return;
  els.canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    dragStart = { x: e.clientX, y: e.clientY, dx: state.place.dx, dy: state.place.dy };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.place.zoom };
    dragStart = null;
  }
});

els.canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const t = tpl();
  if (!t) return;
  const rect = els.canvas.getBoundingClientRect();

  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    state.place.zoom = clamp(pinchStart.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.d), 1, 3);
    els.zoom.value = Math.round(state.place.zoom * 100);
    scheduleRender();
    return;
  }
  if (dragStart) {
    // movement is expressed relative to the window, not the whole flyer
    const winW = t.photo.w * rect.width, winH = t.photo.h * rect.height;
    state.place.dx = clamp(dragStart.dx + (e.clientX - dragStart.x) / winW, -1, 1);
    state.place.dy = clamp(dragStart.dy + (e.clientY - dragStart.y) / winH, -1, 1);
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

/* ── wiring ──────────────────────────────────────────────── */

els.file.addEventListener('change', (e) => handleFile(e.target.files[0]));

els.zoom.addEventListener('input', () => {
  state.place.zoom = Number(els.zoom.value) / 100;
  scheduleRender();
});

els.nameInput.addEventListener('input', () => {
  state.name = els.nameInput.value;
  scheduleRender();
});

els.cutout.addEventListener('change', async () => {
  state.cutoutOn = els.cutout.checked;
  if (!state.original) return;
  if (state.cutoutOn) await applyCutout();
  else { await useBlob(state.original); note('Using the photo as it was taken.'); }
});

els.clearPhoto.addEventListener('click', () => {
  if (state.photo?.url) URL.revokeObjectURL(state.photo.url);
  state.photo = null; state.original = null;
  els.file.value = '';
  els.photoTools.hidden = true;
  els.clearPhoto.hidden = true;
  els.fileBtnText.textContent = 'Choose photo';
  note('');
  status('Ready');
  scheduleRender();
});

els.download.addEventListener('click', async () => {
  await render();
  const who = (state.name || 'flyer').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flyer';
  els.canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${who}-${state.templateId}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    status('Downloaded', 'ok');
  }, 'image/png');
});

window.__studio = { state, render, scheduleRender, useBlob };

/* ── boot ────────────────────────────────────────────────── */

(async function boot() {
  try {
    status('Loading', 'busy');
    const data = await (await fetch('templates.json')).json();
    state.templates = data.templates;
    buildCategories();
    state.templateId = state.templates.find((t) => t.category === state.category).id;
    buildChips();
    try {
      await document.fonts.load('700 100px "Josefin Sans"');
      await document.fonts.ready;
    } catch {}
    await render();
    status('Ready', 'ok');
  } catch (e) {
    console.error(e);
    status('Load failed', 'bad');
  }
})();
