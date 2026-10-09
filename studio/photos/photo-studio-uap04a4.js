const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { actor: null, events: [], overview: null, creationQualification: null, creationOperations: [] };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

async function api(path, options = {}) {
  const response = await fetch(`/api/photos/${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Request failed'), { status: response.status, body });
  return body;
}

function metric(value, label) { return `<article class="metric"><strong>${Number(value || 0).toLocaleString()}</strong><span>${label}</span></article>`; }
function eventRow(event) { return `<article class="event-row"><span><b>${escapeHtml(event.public_name)}</b><small>${escapeHtml(event.region)} · ${escapeHtml(event.event_year)}</small></span><span>${escapeHtml(event.gallery_count)} galleries · ${Number(event.photo_count).toLocaleString()} photos</span></article>`; }
function eventCard(event) {
  const letters = escapeHtml((event.series || event.public_name || 'GL').slice(0, 2).toUpperCase());
  const art = event.artwork_url ? `<img src="${escapeHtml(event.artwork_url)}" alt="" loading="lazy">` : `<b>${letters}</b>`;
  const stale = event.sync_status !== 'CONFIRMED' || !event.last_reconciled_at || Date.now() - new Date(event.last_reconciled_at).getTime() > 26 * 60 * 60 * 1000;
  return `<button class="event-card" data-event="${escapeHtml(event.id)}" aria-label="Open ${escapeHtml(event.public_name)}"><span class="event-art">${art}<i class="sync-state ${stale ? 'stale' : ''}">${stale ? 'STALE' : 'CURRENT'}</i></span><span class="event-body"><h3>${escapeHtml(event.public_name)}</h3><p>${escapeHtml(event.region)} · ${escapeHtml(event.event_year)}</p><span class="event-stats"><span>${escapeHtml(event.gallery_count)} galleries</span><span>${Number(event.photo_count).toLocaleString()} photos</span></span></span></button>`;
}

const creationLabels = {
  REQUESTED: 'Requested', VALIDATED: 'Validated', DRIVE_ROOT_CREATED: 'Drive root created',
  WIX_EVENT_REGISTERED: 'Wix event registered', VERIFIED: 'Verified',
  READY_FOR_PUBLICATION: 'Ready for publication', FAILED_NEEDS_ATTENTION: 'Needs attention'
};
function operationCard(operation) {
  const retry = ['VALIDATED', 'FAILED_NEEDS_ATTENTION', 'DRIVE_ROOT_CREATED', 'WIX_EVENT_REGISTERED'].includes(operation.operation_state);
  return `<article class="operation-card"><span><b>${escapeHtml(operation.event_name)}</b><small>${escapeHtml(operation.event_type.replaceAll('_', ' '))} · ${escapeHtml(operation.event_year)}</small></span><span class="operation-state state-${escapeHtml(operation.operation_state.toLowerCase())}">${escapeHtml(creationLabels[operation.operation_state] || operation.operation_state)}</span>${operation.safe_error_message ? `<p>${escapeHtml(operation.safe_error_message)}</p>` : ''}${retry ? `<button data-retry-operation="${escapeHtml(operation.id)}">Retry safely</button>` : ''}</article>`;
}
function renderCreationOperations() {
  const container = $('#creationSummary');
  if (!state.actor?.canCreateEvent) { container.hidden = true; return; }
  const groups = [
    ['Draft events', ['VALIDATED']], ['Creation in progress', ['REQUESTED', 'DRIVE_ROOT_CREATED', 'WIX_EVENT_REGISTERED', 'VERIFIED']],
    ['Ready for publication', ['READY_FOR_PUBLICATION']], ['Failed / needs attention', ['FAILED_NEEDS_ATTENTION']]
  ];
  container.innerHTML = groups.map(([label, states]) => {
    const rows = state.creationOperations.filter((item) => states.includes(item.operation_state));
    return `<section class="operation-group"><h3>${label}</h3>${rows.length ? rows.map(operationCard).join('') : '<p class="operation-empty">None</p>'}</section>`;
  }).join('');
  container.hidden = false;
}
async function loadCreationOperations() {
  if (!state.actor?.canCreateEvent) return;
  const result = await api('setup');
  state.creationOperations = result.operations || [];
  state.creationQualification = result.qualification;
  renderCreationOperations();
}
function renderQualification() {
  const qualification = state.creationQualification;
  const output = $('#creationQualification');
  if (!qualification) { output.innerHTML = '<strong>Checking production qualification…</strong>'; return; }
  output.innerHTML = qualification.enabled
    ? '<strong>Production provisioning qualified</strong><p>Creation will provision the authorized Drive root, register an inactive Wix event, and verify both identities.</p>'
    : `<strong>Draft validation available; external provisioning is paused</strong><p>${qualification.blockers.map(escapeHtml).join(' ')}</p><p>No Drive folder or Wix record will be created until these server-side boundaries are qualified.</p>`;
  $('#submitEventCreation').textContent = qualification.enabled ? 'Create inactive event' : 'Validate event draft';
}

function showView(name) {
  $$('[data-view-panel]').forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== name; });
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  if (name === 'photographers') loadPhotographers();
  if (name === 'activity') loadActivity();
  if (name === 'media-assets') loadMediaAssets();
  history.replaceState(null, '', name === 'overview' ? '/photos/' : `/photos/?view=${name}`);
}

async function galleryAction(eventId, action, values = {}) {
  const result = await api(`events/${encodeURIComponent(eventId)}/galleries/operations`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ action, ...values }) });
  if (result.operation?.operation_state === 'FAILED_NEEDS_ATTENTION') throw new Error(result.operation.safe_error_message || 'Gallery operation needs attention');
  await openEvent(eventId);
}
function openGalleryDialog({ eventId, action, galleryFolderId = '', galleryName = '' }) {
  const form = $('#galleryForm'); form.reset();
  form.elements.eventId.value = eventId; form.elements.action.value = action; form.elements.galleryFolderId.value = galleryFolderId; form.elements.galleryName.value = galleryName;
  $('#galleryDialogTitle').textContent = action === 'CREATE' ? 'Create gallery' : action === 'RENAME' ? 'Rename gallery' : 'Set gallery cover';
  $('#galleryNameField').hidden = action === 'SET_COVER'; $('#coverFileField').hidden = action !== 'SET_COVER';
  form.elements.galleryName.required = action !== 'SET_COVER'; form.elements.coverFileId.required = action === 'SET_COVER'; $('#galleryResult').value = '';
  $('#galleryDialog').showModal();
}

async function openEvent(id) {
  const { event, uploadAccess = { authorized: false }, galleryOperations = [], galleryManagementQualified } = await api(`events/${encodeURIComponent(id)}`);
  const detail = $('#eventDetail');
  detail.hidden = false;
  const known = new Map(event.galleries.map((g) => [g.drive_folder_id, g]));
  [...galleryOperations].reverse().filter((o) => o.gallery_folder_id).forEach((o) => {
    const current = known.get(o.gallery_folder_id);
    if (o.operation_type === 'CREATE' && !current) known.set(o.gallery_folder_id, { drive_folder_id: o.gallery_folder_id, public_name: o.requested_name, photo_count: 0, sync_status: o.operation_state, destination_url: o.drive_folder_url, cover_url: '' });
    if (o.operation_type === 'RENAME' && known.has(o.gallery_folder_id)) known.set(o.gallery_folder_id, { ...known.get(o.gallery_folder_id), public_name: o.requested_name, sync_status: o.operation_state });
  });
  const canCreate = event.capabilities.includes('GALLERY_CREATE'); const canRename = event.capabilities.includes('GALLERY_RENAME'); const canCover = event.capabilities.includes('GALLERY_COVER_SELECT');
  const cards = [...known.values()];
  const canOpenUpload = state.actor.role === 'PHOTO_ADMIN' || uploadAccess.authorized;
  const galleries = cards.length ? `<div class="gallery-grid">${cards.map((g) => `<article class="gallery-card"><span class="gallery-cover">${g.cover_url ? `<img src="${escapeHtml(g.cover_url)}" alt="" loading="lazy">` : '<span class="empty-cover">EMPTY GALLERY</span>'}</span><span class="gallery-copy"><b>${escapeHtml(g.public_name)}</b><small>${Number(g.photo_count).toLocaleString()} photos · ${escapeHtml(String(g.sync_status || 'SYNC_PENDING').replaceAll('_',' '))}</small></span><div class="gallery-actions">${canOpenUpload && g.destination_url ? `<a href="${escapeHtml(g.destination_url)}" target="_blank" rel="noopener">Open upload folder</a>` : '<span>Drive upload access pending</span>'}${canRename ? `<button data-gallery-rename="${escapeHtml(g.drive_folder_id)}" data-gallery-name="${escapeHtml(g.public_name)}" data-gallery-event="${escapeHtml(event.id)}">Rename</button>` : ''}${canCover ? `<button data-gallery-cover="${escapeHtml(g.drive_folder_id)}" data-gallery-event="${escapeHtml(event.id)}" ${Number(g.photo_count) ? '' : 'disabled'}>Set cover</button>` : ''}</div></article>`).join('')}</div>` : `<div class="gallery-empty">No galleries exist for this event yet.</div>`;
  detail.innerHTML = `<div class="section-head"><div><p class="eyebrow">${escapeHtml(event.series)} · ${escapeHtml(event.region)}</p><h2>${escapeHtml(event.public_name)}</h2></div><div class="event-management"><p>${escapeHtml(event.event_year)} · ${escapeHtml(event.sync_status.replaceAll('_', ' '))}</p>${canCreate ? `<button class="primary" data-gallery-create="${escapeHtml(event.id)}" ${galleryManagementQualified ? '' : 'disabled'}>Create gallery</button>` : ''}</div></div>${galleries}`;
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadPhotographers() {
  const { photographers } = await api('photographers');
  const options = state.events.map((event) => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.public_name)} ${escapeHtml(event.event_year)}</option>`).join('');
  $('#photographerList').innerHTML = photographers.length ? photographers.map((person) => `<article class="person"><span class="person-main"><b>${escapeHtml(person.display_name)}</b><small>${escapeHtml(person.email || 'Invitation pending')} · ${escapeHtml(person.event_ids || 'No assignments')}</small><small>${escapeHtml(person.event_scope)} · ${(person.capabilities || []).map(escapeHtml).join(', ')}</small></span><span class="person-actions"><span class="assignment-control"><select data-preset-select="${escapeHtml(person.id)}" aria-label="Permission preset for ${escapeHtml(person.display_name)}"><option value="ASSIGNED" ${person.preset_key === 'ASSIGNED' ? 'selected' : ''}>Assigned</option><option value="GENERAL" ${person.preset_key === 'GENERAL' ? 'selected' : ''}>General</option><option value="LEAD" ${person.preset_key === 'LEAD' ? 'selected' : ''}>Lead</option></select><button data-permissions="${escapeHtml(person.id)}">Apply preset</button></span><span class="assignment-control"><select data-assignment-select="${escapeHtml(person.id)}" aria-label="Event assignment for ${escapeHtml(person.display_name)}"><option value="">Select event</option>${options}</select><button data-assignment="${escapeHtml(person.id)}" data-active="true">Assign</button><button data-assignment="${escapeHtml(person.id)}" data-active="false">Revoke event</button></span><button data-status="${escapeHtml(person.id)}" data-next="${person.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}">${person.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button><button data-status="${escapeHtml(person.id)}" data-next="REVOKED">Revoke account</button></span></article>`).join('') : '<div class="gallery-empty">No photographers have accepted an invitation yet.</div>';
}
async function loadMediaAssets() {
  const { collections } = await api('media-assets');
  $('#mediaAssets').innerHTML = collections.map((item) => `<a class="event-card media-card" href="${escapeHtml(item.public_destination || '#')}" target="_blank" rel="noopener"><span class="event-art"><b>LH</b></span><span class="event-body"><h3>${escapeHtml(item.public_name)}</h3><p>${escapeHtml(item.source_system)} · ${escapeHtml(item.sync_status.replaceAll('_', ' '))}</p><span class="event-stats"><span>${Number(item.item_count).toLocaleString()} indexed assets</span></span></span></a>`).join('');
}
async function loadActivity() {
  const { activity } = await api('activity');
  $('#activityList').innerHTML = activity.length ? activity.map((item) => `<article class="activity-row"><small>${escapeHtml(new Date(item.occurred_at).toLocaleString())}</small><span><b>${escapeHtml(item.operation)}</b><small>${escapeHtml(item.actor_email || 'System')} · ${escapeHtml(item.target_type || '')}</small></span><span>${escapeHtml(item.operation_outcome)}</span></article>`).join('') : '<div class="gallery-empty">No Photo Studio administrative actions have occurred.</div>';
}

async function boot() {
  try {
    const { actor } = await api('session');
    const { events } = await api('events');
    state.actor = actor; state.events = events;
    const isAdmin = actor.role === 'PHOTO_ADMIN';
    document.body.classList.toggle('is-admin', isAdmin);
    $$('.admin-only').forEach((item) => { item.hidden = !isAdmin; });
    $$('.creator-only').forEach((item) => { item.hidden = !actor.canCreateEvent; });
    $('#actorName').textContent = actor.displayName;
    $('#actorRole').textContent = isAdmin ? 'Administrator' : 'Photographer';
    $('#nav').hidden = false; $('#loading').hidden = true; $('#app').hidden = false;
    $('#heroCopy').textContent = isAdmin ? 'Manage event photography, people and publication readiness.' : 'Your assigned events and approved photo operations.';
    $('#eventsTitle').textContent = isAdmin ? 'All events' : 'Your assigned events';
    $('#eventGrid').innerHTML = events.length ? events.map(eventCard).join('') : '<div class="gallery-empty">No events are assigned to this account.</div>';
    $('#overviewEvents').innerHTML = events.length ? events.slice(0, 5).map(eventRow).join('') : '<div class="gallery-empty">No assigned events.</div>';
    if (isAdmin) {
      const { overview } = await api('overview'); state.overview = overview;
      $('#metrics').innerHTML = metric(overview.events, 'Registered events') + metric(overview.photographers, 'Active photographers') + metric(overview.galleries, 'Confirmed galleries') + metric(overview.photos, 'Confirmed photos');
      const select = $('#inviteForm select'); if (select) events.forEach((event) => select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(event.id)}">${escapeHtml(event.public_name)} ${escapeHtml(event.event_year)}</option>`));
    } else $('#metrics').innerHTML = metric(events.length, 'Assigned events') + metric(events.reduce((n,e)=>n+e.gallery_count,0), 'Available galleries') + metric(events.reduce((n,e)=>n+e.photo_count,0), 'Confirmed photos');
    if (actor.canCreateEvent) {
      renderCreationOperations();
      try { await loadCreationOperations(); }
      catch (error) {
        state.creationQualification = { enabled: false, blockers: ['The operation ledger could not be loaded. Refresh before validating an event draft.'] };
        $('#creationSummary').innerHTML = `<section class="operation-group"><h3>Failed / needs attention</h3><article class="operation-card"><b>Operation status unavailable</b><p>${escapeHtml(error.message)}</p></article></section>`;
      }
    }
    const requested = new URL(location.href).searchParams.get('view'); showView(requested && $(`[data-view-panel="${requested}"]`) ? requested : 'overview');
  } catch (error) {
    $('#loading').hidden = true; $('#denied').hidden = false;
    $('#deniedMessage').textContent = error.status === 403 ? 'This authenticated Google account has not been invited to Photo Studio.' : 'Secure access could not be verified. Please refresh or contact an administrator.';
  }
}

document.addEventListener('click', async (event) => {
  const view = event.target.closest('[data-view]'); if (view) showView(view.dataset.view);
  const card = event.target.closest('[data-event]'); if (card) await openEvent(card.dataset.event);
  const create = event.target.closest('[data-gallery-create]'); if (create) {
    openGalleryDialog({ eventId: create.dataset.galleryCreate, action: 'CREATE' });
  }
  const rename = event.target.closest('[data-gallery-rename]'); if (rename) {
    openGalleryDialog({ eventId: rename.dataset.galleryEvent, action: 'RENAME', galleryFolderId: rename.dataset.galleryRename, galleryName: rename.dataset.galleryName });
  }
  const cover = event.target.closest('[data-gallery-cover]'); if (cover) {
    openGalleryDialog({ eventId: cover.dataset.galleryEvent, action: 'SET_COVER', galleryFolderId: cover.dataset.galleryCover });
  }
  const status = event.target.closest('[data-status]'); if (status) { await api('photographers/status', { method: 'POST', body: JSON.stringify({ userId: status.dataset.status, status: status.dataset.next }) }); await loadPhotographers(); }
  const assignment = event.target.closest('[data-assignment]'); if (assignment) {
    const select = $(`[data-assignment-select="${CSS.escape(assignment.dataset.assignment)}"]`);
    if (!select?.value) { select?.focus(); return; }
    await api('assignments', { method: 'POST', body: JSON.stringify({ userId: assignment.dataset.assignment, eventId: select.value, active: assignment.dataset.active === 'true' }) });
    await loadPhotographers(); await loadActivity();
  }
  const permissions = event.target.closest('[data-permissions]'); if (permissions) {
    const select = $(`[data-preset-select="${CSS.escape(permissions.dataset.permissions)}"]`);
    await api('photographers/permissions', { method: 'POST', body: JSON.stringify({ userId: permissions.dataset.permissions, preset: select.value }) });
    await loadPhotographers(); await loadActivity();
  }
  const retry = event.target.closest('[data-retry-operation]'); if (retry) {
    retry.disabled = true;
    try { await api(`setup/${encodeURIComponent(retry.dataset.retryOperation)}/retry`, { method: 'POST', body: '{}' }); await loadCreationOperations(); }
    catch (error) { $('#creationResult').value = error.message; }
    finally { retry.disabled = false; }
  }
  if (event.target.closest('[data-close-wizard]')) $('#eventWizard').close();
  if (event.target.closest('[data-close-gallery-dialog]')) $('#galleryDialog').close();
});
$('#galleryForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); const output = $('#galleryResult');
  output.value = 'Applying the governed Drive operation…';
  try { await galleryAction(values.eventId, values.action, values); $('#galleryDialog').close(); }
  catch (error) { output.value = error.message.replaceAll('_', ' '); }
});
$('#newEvent').addEventListener('click', async () => {
  if (!state.creationQualification) {
    const result = await api('creation-capabilities'); state.creationQualification = result.qualification;
  }
  renderQualification(); $('#eventWizard').showModal();
});
$('#eventCreationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $('#submitEventCreation'); const output = $('#creationResult');
  const input = Object.fromEntries(new FormData(form));
  const idempotencyKey = crypto.randomUUID();
  submit.disabled = true; output.value = 'Validating and recording the recoverable operation…';
  try {
    const result = await api('setup', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) });
    state.creationQualification = result.qualification;
    output.value = result.qualification.enabled ? `Event workflow started: ${creationLabels[result.operation.operation_state]}.` : 'Draft validated and recorded. External provisioning remains safely paused.';
    form.reset(); await loadCreationOperations(); renderQualification();
  } catch (error) { output.value = error.message.replaceAll('_', ' '); }
  finally { submit.disabled = false; }
});
$('#inviteForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const output = $('#inviteResult'); output.value = 'Creating invitation…';
  try { const { invitation } = await api('invitations', { method: 'POST', body: JSON.stringify(data) }); output.value = `Invitation ready for ${invitation.email}. Access is granted when that account signs in.`; form.reset(); await loadActivity(); }
  catch (error) { output.value = error.message; }
});
$('#auditDriveAccess').addEventListener('click', async (event) => {
  const button = event.currentTarget; const output = $('#driveAuditResult'); button.disabled = true; output.value = 'Auditing authoritative event roots…';
  try {
    const { audit } = await api('drive-access/audit'); const roots = audit.roots || [];
    const shared = roots.filter((root) => root.storageAuthority === 'SHARED_DRIVE').length;
    const manageable = roots.filter((root) => root.canShare).length;
    output.value = `${roots.length} roots audited · ${shared} Shared Drive · ${manageable} manageable by automation`;
  } catch (error) { output.value = error.message.replaceAll('_', ' '); }
  finally { button.disabled = false; }
});
boot();
