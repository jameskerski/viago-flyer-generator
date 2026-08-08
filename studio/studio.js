const $ = (selector) => document.querySelector(selector);
const round = (value) => Math.round(value * 100000) / 100000;
const unknown = (value) => value.trim() || 'Unknown';

const els = Object.fromEntries([
  'authorCanvas','canvasEmpty','previewTitle','editMode','previewMode','drawPhoto','movePhoto','moveName','runtimeFrame',
  'draftSource','existingWrap','existingTemplate','artworkFile','artworkMeta','templateId','label','category','categoryList','accent','categoryPosition','orderPreview',
  'photoShape','photoX','photoY','photoW','photoH','samplePhoto','sampleName','nameX','nameY','nameMaxWidth','nameSize','nameFont','nameWeight','nameColor','nameAlign','nameCase','nameTracking','nameMaxLines','nameLineHeight','nameVAlign','nameWrap',
  'provDesigner','provCanva','provApproval','provOwner','provReference','provNotes','validate','reviewArtifact','preparePromotion','validationResult','jsonPreview','planPreview','planDetails','promotionConfirmation','promote',
  'retireActions','retireTemplate','retireDialog','retireLabel','retireId','retireCategory','retireArtwork','cancelRetire','confirmRetire'
].map((id) => [id, $(`#${id}`)]));

const ctx = els.authorCanvas.getContext('2d');
const state = {
  registry: null, registryHash: null, mode: 'new', originalId: null, draft: null,
  artworkFile: null, artworkDataUrl: null, artworkUrl: null, artworkChecksum: null,
  sampleFile: null, runtimeReady: false, overlays: true, tool: 'drawPhoto', drag: null,
  validation: null, plan: null, hosted: false, baseRevision: null
};

function defaultDraft() {
  return {
    id: '', label: '', category: 'General', accent: '#8dfa00', art: '', w: 800, h: 1080,
    photo: { shape: 'rect', x: 0.2, y: 0.25, w: 0.5, h: 0.5 },
    name: { x: 0.5, y: 0.85, maxWidth: 0.7, size: 0.05, font: 'Josefin Sans', weight: 700, color: '#ffffff', align: 'center', case: 'upper', tracking: 0.02, wrap: false, maxLines: 3, lineHeight: 1.15 }
  };
}

async function fileDataUrl(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
}

async function checksum(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function imageDimensions(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}

function setTool(tool) {
  state.tool = tool;
  for (const key of ['drawPhoto', 'movePhoto', 'moveName']) els[key].classList.toggle('active', key === tool);
}

function invalidate() {
  state.validation = null; state.plan = null; els.promote.disabled = true;
  els.validationResult.className = 'result neutral'; els.validationResult.textContent = 'Draft changed; validate again.';
  els.planPreview.textContent = 'Prepare promotion to see the before/after order and target files.';
}

function updateRetireAvailability() {
  els.retireActions.hidden = !(state.hosted && state.mode === 'existing' && state.originalId);
}

function readDraft() {
  const number = (id) => Number(els[id].value);
  const draft = {
    id: els.templateId.value.trim(), label: els.label.value.trim(), category: els.category.value.trim(), accent: els.accent.value,
    art: `art/${els.templateId.value.trim()}.jpg`, w: state.draft.w, h: state.draft.h,
    photo: { shape: els.photoShape.value, x: number('photoX'), y: number('photoY'), w: number('photoW'), h: number('photoH') },
    name: {
      x: number('nameX'), y: number('nameY'), maxWidth: number('nameMaxWidth'), size: number('nameSize'), font: els.nameFont.value.trim(),
      weight: number('nameWeight'), color: els.nameColor.value, align: els.nameAlign.value, case: els.nameCase.value,
      tracking: number('nameTracking'), wrap: els.nameWrap.checked, maxLines: number('nameMaxLines'), lineHeight: number('nameLineHeight')
    }
  };
  if (els.nameVAlign.value !== 'baseline') draft.name.vAlign = els.nameVAlign.value;
  state.draft = draft;
  els.jsonPreview.textContent = JSON.stringify(draft, null, 2);
  return draft;
}

function writeDraft(draft) {
  state.draft = structuredClone(draft);
  const values = {
    templateId: draft.id, label: draft.label, category: draft.category, accent: draft.accent,
    photoShape: draft.photo.shape, photoX: draft.photo.x, photoY: draft.photo.y, photoW: draft.photo.w, photoH: draft.photo.h,
    nameX: draft.name.x, nameY: draft.name.y, nameMaxWidth: draft.name.maxWidth, nameSize: draft.name.size,
    nameFont: draft.name.font, nameWeight: draft.name.weight, nameColor: draft.name.color, nameAlign: draft.name.align, nameCase: draft.name.case,
    nameTracking: draft.name.tracking ?? 0.02, nameMaxLines: draft.name.maxLines ?? 3, nameLineHeight: draft.name.lineHeight ?? 1.15,
    nameVAlign: draft.name.vAlign ?? 'baseline'
  };
  for (const [id, value] of Object.entries(values)) els[id].value = value;
  els.nameWrap.checked = Boolean(draft.name.wrap);
  els.jsonPreview.textContent = JSON.stringify(draft, null, 2);
  els.previewTitle.textContent = draft.label || draft.id || 'Untitled draft';
  updatePositionOptions();
}

function categoryTemplates() {
  if (!state.registry) return [];
  return state.registry.templates.filter((template) => template.category === els.category.value.trim() && !(state.mode === 'existing' && template.id === state.originalId));
}

function updatePositionOptions() {
  const templates = categoryTemplates();
  const previous = Number(els.categoryPosition.value);
  els.categoryPosition.innerHTML = '';
  for (let index = 0; index <= templates.length; index += 1) {
    const option = document.createElement('option'); option.value = index;
    option.textContent = index === 0 ? 'First in category' : index === templates.length ? 'Last in category' : `After ${templates[index - 1].label}`;
    els.categoryPosition.append(option);
  }
  els.categoryPosition.value = Math.min(Number.isFinite(previous) ? previous : templates.length, templates.length);
  updateOrderPreview();
}

function proposedOrder() {
  if (!state.registry) return [];
  const draft = readDraft();
  const templates = state.registry.templates.filter((template) => !(state.mode === 'existing' && template.id === state.originalId));
  const matching = templates.map((template, index) => template.category === draft.category ? index : -1).filter((index) => index >= 0);
  const position = Number(els.categoryPosition.value);
  const insertion = !matching.length ? templates.length : position === matching.length ? matching.at(-1) + 1 : matching[position];
  templates.splice(insertion, 0, { ...draft, __proposed: true });
  return templates;
}

function updateOrderPreview() {
  if (!state.registry || !state.draft) return;
  const order = proposedOrder();
  els.orderPreview.innerHTML = '';
  order.forEach((template, index) => {
    const item = document.createElement('li'); item.textContent = `${template.category}: ${template.label || template.id || 'Untitled draft'}`;
    if (template.__proposed) item.className = 'proposed';
    els.orderPreview.append(item);
  });
}

async function setArtwork(file, { preserveDimensions = false } = {}) {
  if (!file || !['image/jpeg'].includes(file.type)) throw new Error('Choose a valid JPEG artwork file.');
  const dimensions = await imageDimensions(file);
  if (state.artworkUrl) URL.revokeObjectURL(state.artworkUrl);
  state.artworkFile = file; state.artworkDataUrl = await fileDataUrl(file); state.artworkUrl = URL.createObjectURL(file); state.artworkChecksum = await checksum(file);
  if (!preserveDimensions || !state.draft.w || !state.draft.h) { state.draft.w = dimensions.width; state.draft.h = dimensions.height; }
  els.authorCanvas.width = state.draft.w; els.authorCanvas.height = state.draft.h;
  els.canvasEmpty.hidden = true;
  els.artworkMeta.textContent = `${file.name} · ${dimensions.width} × ${dimensions.height}px · SHA-256 ${state.artworkChecksum.slice(0, 16)}…`;
  await render();
}

async function loadExisting(id) {
  const template = state.registry.templates.find((item) => item.id === id);
  if (!template) return;
  state.mode = 'existing'; state.originalId = id; writeDraft(template);
  const response = await fetch(`/runtime/${template.art}`); const blob = await response.blob();
  await setArtwork(new File([blob], template.art.split('/').at(-1), { type: 'image/jpeg' }), { preserveDimensions: true });
  const categoryItems = state.registry.templates.filter((item) => item.category === template.category);
  els.categoryPosition.value = categoryItems.findIndex((item) => item.id === id);
  updateOrderPreview(); invalidate();
}

function productionTemplate() {
  const draft = readDraft();
  return { ...structuredClone(draft), id: draft.id || 'studio-draft', art: state.artworkUrl };
}

async function render() {
  if (!state.runtimeReady || !state.artworkUrl || !state.draft) return;
  const frame = els.runtimeFrame.contentWindow; const template = productionTemplate();
  frame.__studio.state.templates = [template]; frame.__studio.state.category = template.category; frame.__studio.state.templateId = template.id;
  frame.__studio.state.name = els.sampleName.value;
  if (state.sampleFile && state.sampleFile !== state.lastSampleFile) { await frame.__studio.useBlob(state.sampleFile); state.lastSampleFile = state.sampleFile; }
  await frame.__studio.render();
  if (els.authorCanvas.width !== template.w || els.authorCanvas.height !== template.h) {
    els.authorCanvas.width = template.w; els.authorCanvas.height = template.h;
  }
  ctx.clearRect(0, 0, template.w, template.h); ctx.drawImage(frame.document.querySelector('#flyer'), 0, 0);
  if (state.overlays) drawGuides(template);
}

function drawGuides(template) {
  const { w: W, h: H } = template; const p = template.photo; const n = template.name;
  const x = p.x * W, y = p.y * H, w = p.w * W, h = p.h * H;
  ctx.save(); ctx.lineWidth = Math.max(2, W / 400); ctx.strokeStyle = '#8dfa00'; ctx.setLineDash([W / 80, W / 130]);
  ctx.beginPath(); if (p.shape === 'circle') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else ctx.rect(x, y, w, h); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle = '#8dfa00'; ctx.fillRect(x + w - W / 100, y + h - W / 100, W / 50, W / 50);
  const nx = n.x * W, ny = n.y * H, half = n.maxWidth * W / 2;
  ctx.strokeStyle = '#34d3ff'; ctx.beginPath(); ctx.moveTo(nx - half, ny); ctx.lineTo(nx + half, ny); ctx.stroke();
  ctx.fillStyle = '#34d3ff'; ctx.beginPath(); ctx.arc(nx, ny, W / 100, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(nx + half - W / 120, ny - W / 120, W / 60, W / 60);
  ctx.restore();
}

function point(event) {
  const rect = els.authorCanvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
}

els.authorCanvas.addEventListener('pointerdown', (event) => {
  if (!state.draft || !state.artworkFile || !state.overlays) return;
  els.authorCanvas.setPointerCapture(event.pointerId); const at = point(event); const p = state.draft.photo; const n = state.draft.name;
  let action = state.tool;
  if (state.tool === 'movePhoto') action = Math.hypot(at.x - (p.x + p.w), at.y - (p.y + p.h)) < .04 ? 'resizePhoto' : 'movePhoto';
  if (state.tool === 'moveName') action = Math.abs(at.x - (n.x + n.maxWidth / 2)) < .04 ? 'resizeName' : 'moveName';
  state.drag = { action, start: at, photo: { ...p }, name: { ...n } };
});

window.addEventListener('pointermove', (event) => {
  if (!state.drag) return; const at = point(event); const dx = at.x - state.drag.start.x, dy = at.y - state.drag.start.y;
  if (state.drag.action === 'drawPhoto') state.draft.photo = { ...state.draft.photo, x: round(Math.min(state.drag.start.x, at.x)), y: round(Math.min(state.drag.start.y, at.y)), w: round(Math.max(.00001, Math.abs(dx))), h: round(Math.max(.00001, Math.abs(dy))) };
  else if (state.drag.action === 'movePhoto') { state.draft.photo.x = round(Math.max(0, Math.min(1, state.drag.photo.x + dx))); state.draft.photo.y = round(Math.max(0, Math.min(1, state.drag.photo.y + dy))); }
  else if (state.drag.action === 'resizePhoto') { state.draft.photo.w = round(Math.max(.00001, Math.min(1, state.drag.photo.w + dx))); state.draft.photo.h = round(Math.max(.00001, Math.min(1, state.drag.photo.h + dy))); }
  else if (state.drag.action === 'moveName') { state.draft.name.x = round(Math.max(0, Math.min(1, state.drag.name.x + dx))); state.draft.name.y = round(Math.max(0, Math.min(1, state.drag.name.y + dy))); }
  else if (state.drag.action === 'resizeName') state.draft.name.maxWidth = round(Math.max(.00001, Math.min(1, state.drag.name.maxWidth + dx * 2)));
  writeDraft(state.draft); invalidate(); render();
});

window.addEventListener('pointerup', () => { state.drag = null; });
window.addEventListener('pointercancel', () => { state.drag = null; });

function requestPayload() {
  return { mode: state.mode, originalId: state.originalId, draft: readDraft(), categoryPosition: Number(els.categoryPosition.value), artworkDataUrl: state.artworkDataUrl };
}

async function api(path, payload) {
  const response = await fetch(path, { method: payload ? 'POST' : 'GET', headers: payload ? { 'Content-Type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || `Request failed ${response.status}`); return result;
}

function showValidation(result) {
  state.validation = result; const validation = result.validation || result;
  els.validationResult.className = `result ${validation.ok ? 'ok' : 'bad'}`;
  els.validationResult.textContent = validation.messages?.join('\n') || (validation.ok ? 'Template is valid.' : 'Validation failed.');
}

async function validate() {
  if (!state.artworkDataUrl) throw new Error('Load a JPEG artwork before validation.');
  const result = await api('/api/studio/validate', requestPayload()); showValidation(result); return result;
}

function provenance() {
  return { designerOrSource: unknown(els.provDesigner.value), canvaDesign: unknown(els.provCanva.value), approvalReference: unknown(els.provApproval.value), sourceOwnerOrContact: unknown(els.provOwner.value), referenceExportChecksum: unknown(els.provReference.value), cleanExportChecksum: state.artworkChecksum || 'Unknown', productionArtChecksum: state.artworkChecksum || 'Unknown', notes: unknown(els.provNotes.value) };
}

async function artifact() {
  const validation = await validate();
  const record = { artifactVersion: 1, createdAt: new Date().toISOString(), status: 'REVIEW_ONLY_NOT_PROMOTED', template: readDraft(), artwork: { sourceFilename: state.artworkFile.name, width: state.draft.w, height: state.draft.h, sha256: state.artworkChecksum }, categoryPosition: Number(els.categoryPosition.value), resultingOrder: proposedOrder().map(({ id, category }) => ({ id, category })), validation: validation.validation, provenance: provenance(), unresolvedProvenance: Object.entries(provenance()).filter(([, value]) => value === 'Unknown').map(([key]) => key) };
  const blob = new Blob([JSON.stringify(record, null, 2) + '\n'], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${state.draft.id || 'template'}-review.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return record;
}

async function preparePlan() {
  if (!state.artworkDataUrl) throw new Error('Load a JPEG artwork before planning promotion.');
  const result = await api(state.hosted ? '/api/studio/validate' : '/api/studio/plan', requestPayload()); showValidation(result);
  if (state.hosted && result.ok) result.planToken = 'hosted-publication';
  state.plan = result.ok ? result : null; els.planPreview.textContent = JSON.stringify(result, null, 2); els.planDetails.open = true;
  els.promote.disabled = !(state.plan && els.promotionConfirmation.value === 'PROMOTE');
  return result;
}

async function promote() {
  if (!state.plan) throw new Error('Prepare and review a valid promotion plan first.');
  const result = state.hosted
    ? await api('/api/studio/publish', { ...requestPayload(), baseRevision: state.baseRevision })
    : await api('/api/studio/promote', { planToken: state.plan.planToken, confirmation: els.promotionConfirmation.value });
  els.validationResult.className = 'result ok'; els.validationResult.textContent = state.hosted
    ? `Published to GitHub. Commit ${result.commitSha}. Deployment is in progress.`
    : `Promoted explicitly. ${result.validation.stdout}`;
  const loaded = await api('/api/studio/catalog'); state.registry = loaded.registry; state.registryHash = loaded.registryHash; state.plan = null; els.promote.disabled = true;
  state.baseRevision = loaded.revision || state.baseRevision;
  return result;
}

function openRetirement() {
  if (!(state.hosted && state.mode === 'existing' && state.originalId)) return;
  const target = state.registry.templates.find(({ id }) => id === state.originalId);
  if (!target) throw new Error('The selected template is no longer available. Reload the Studio.');
  els.retireLabel.textContent = target.label;
  els.retireId.textContent = target.id;
  els.retireCategory.textContent = target.category;
  els.retireArtwork.textContent = target.art;
  els.retireDialog.showModal();
}

async function retire() {
  if (!(state.hosted && state.mode === 'existing' && state.originalId)) throw new Error('Choose an existing template before retiring.');
  const templateId = state.originalId;
  els.confirmRetire.disabled = true;
  try {
    const result = await api('/api/studio/retire', { templateId, baseRevision: state.baseRevision, confirmed: true });
    els.retireDialog.close();
    els.validationResult.className = 'result ok';
    els.validationResult.textContent = `Retired from GitHub. Commit ${result.commitSha}. Deployment is in progress.`;
    const loaded = await api('/api/studio/catalog');
    state.registry = loaded.registry; state.registryHash = loaded.registryHash; state.baseRevision = loaded.revision;
    els.existingTemplate.innerHTML = state.registry.templates.map((template) => `<option value="${template.id}">${template.category} — ${template.label}</option>`).join('');
    state.mode = 'new'; state.originalId = null; els.draftSource.value = 'new'; els.existingWrap.hidden = true;
    writeDraft(defaultDraft()); updateRetireAvailability();
    return result;
  } finally { els.confirmRetire.disabled = false; }
}

function guarded(action) { return async () => { try { await action(); } catch (error) { els.validationResult.className = 'result bad'; els.validationResult.textContent = error.message; } }; }

els.draftSource.addEventListener('change', async () => {
  state.mode = els.draftSource.value; els.existingWrap.hidden = state.mode !== 'existing';
  if (state.mode === 'existing') await loadExisting(els.existingTemplate.value);
  else { state.originalId = null; state.artworkFile = null; state.artworkDataUrl = null; if (state.artworkUrl) URL.revokeObjectURL(state.artworkUrl); state.artworkUrl = null; writeDraft(defaultDraft()); els.artworkMeta.textContent = 'No artwork selected.'; els.canvasEmpty.hidden = false; ctx.clearRect(0,0,els.authorCanvas.width,els.authorCanvas.height); invalidate(); }
  updateRetireAvailability();
});
els.existingTemplate.addEventListener('change', () => loadExisting(els.existingTemplate.value));
els.artworkFile.addEventListener('change', guarded(async () => {
  const file = els.artworkFile.files[0]; await setArtwork(file);
  if (state.mode === 'new' && !els.templateId.value) { const id = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); els.templateId.value = id; els.label.value = id.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' '); }
  readDraft(); updatePositionOptions(); invalidate(); await render();
}));
els.samplePhoto.addEventListener('change', guarded(async () => { state.sampleFile = els.samplePhoto.files[0]; state.lastSampleFile = null; await render(); }));
for (const button of document.querySelectorAll('[data-name]')) button.addEventListener('click', () => { els.sampleName.value = button.dataset.name; render(); });
for (const id of ['templateId','label','category','accent','photoShape','photoX','photoY','photoW','photoH','sampleName','nameX','nameY','nameMaxWidth','nameSize','nameFont','nameWeight','nameColor','nameAlign','nameCase','nameTracking','nameMaxLines','nameLineHeight','nameVAlign','nameWrap']) {
  els[id].addEventListener('input', () => { readDraft(); if (id === 'category') updatePositionOptions(); else updateOrderPreview(); invalidate(); render(); });
}
els.categoryPosition.addEventListener('change', () => { updateOrderPreview(); invalidate(); });
els.drawPhoto.addEventListener('click', () => setTool('drawPhoto')); els.movePhoto.addEventListener('click', () => setTool('movePhoto')); els.moveName.addEventListener('click', () => setTool('moveName'));
els.editMode.addEventListener('click', () => { state.overlays = true; els.editMode.classList.add('active'); els.previewMode.classList.remove('active'); render(); });
els.previewMode.addEventListener('click', () => { state.overlays = false; els.previewMode.classList.add('active'); els.editMode.classList.remove('active'); render(); });
els.validate.addEventListener('click', guarded(validate)); els.reviewArtifact.addEventListener('click', guarded(artifact)); els.preparePromotion.addEventListener('click', guarded(preparePlan)); els.promote.addEventListener('click', guarded(promote));
els.promotionConfirmation.addEventListener('input', () => { els.promote.disabled = !(state.plan && els.promotionConfirmation.value === 'PROMOTE'); });
els.retireTemplate.addEventListener('click', guarded(openRetirement));
els.confirmRetire.addEventListener('click', guarded(retire));

async function boot() {
  const loaded = await api('/api/studio/catalog'); state.registry = loaded.registry; state.registryHash = loaded.registryHash;
  state.hosted = Boolean(loaded.revision); state.baseRevision = loaded.revision || null;
  if (state.hosted) {
    document.querySelector('.eyebrow').textContent = 'PRIVATE HOSTED AUTHORING TOOL';
    document.querySelector('.authority').innerHTML = '<a class="admin-guide-link" href="admin-guide.html" target="_blank" rel="noopener">Admin Instructions</a><br>Draft → validate → review → publish<br><strong>Published state is committed atomically to GitHub</strong>';
    els.promote.textContent = 'Publish template';
  }
  updateRetireAvailability();
  const categories = [...new Set(state.registry.templates.map((template) => template.category))];
  els.categoryList.innerHTML = categories.map((category) => `<option value="${category}"></option>`).join('');
  els.existingTemplate.innerHTML = state.registry.templates.map((template) => `<option value="${template.id}">${template.category} — ${template.label}</option>`).join('');
  writeDraft(defaultDraft()); els.categoryPosition.value = categoryTemplates().length; updateOrderPreview();
  await new Promise((resolve) => { if (els.runtimeFrame.contentWindow?.__studio) resolve(); else els.runtimeFrame.addEventListener('load', resolve, { once: true }); });
  await new Promise((resolve) => { const check = () => els.runtimeFrame.contentWindow.__studio ? resolve() : setTimeout(check, 20); check(); });
  state.runtimeReady = true;
  window.__templateStudio = { state, readDraft, writeDraft, render, validate, preparePlan, artifact, promote, retire, loadExisting, setArtwork, proposedOrder };
}

boot().catch((error) => { els.validationResult.className = 'result bad'; els.validationResult.textContent = `Studio failed to start: ${error.message}`; });
