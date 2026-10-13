import { localTimestamp, utcDate, accountStatus, assignedIds } from './photo-admin-format.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { actor: null, events: [], overview: null, creationQualification: null, creationOperations: [], coverBrowser: null, operationFilter: '', leaders: [], photographers: [], headshotProfile: null };
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
  const stale = event.sync_status !== 'CONFIRMED' || !utcDate(event.last_reconciled_at) || Date.now() - utcDate(event.last_reconciled_at).getTime() > 26 * 60 * 60 * 1000;
  return `<button class="event-card" data-event="${escapeHtml(event.id)}" aria-label="Open ${escapeHtml(event.public_name)}"><span class="event-art">${art}<i class="sync-state ${stale ? 'stale' : ''}">${stale ? 'STALE' : 'CURRENT'}</i></span><span class="event-body"><h3>${escapeHtml(event.public_name)}</h3><p>${escapeHtml(event.region)} · ${escapeHtml(event.event_year)}</p><span class="event-stats"><span>${escapeHtml(event.gallery_count)} galleries</span><span>${Number(event.photo_count).toLocaleString()} photos</span></span></span></button>`;
}

const creationLabels = {
  REQUESTED: 'Requested', VALIDATED: 'Validated', DRIVE_ROOT_CREATED: 'Drive root created',
  WIX_EVENT_REGISTERED: 'Wix event registered', VERIFIED: 'Verified',
  READY_FOR_PUBLICATION: 'Ready for Review — Publication Not Yet Enabled', FAILED_NEEDS_ATTENTION: 'Needs attention'
};
function operationCard(operation) {
  const retry = ['VALIDATED', 'FAILED_NEEDS_ATTENTION', 'DRIVE_ROOT_CREATED', 'WIX_EVENT_REGISTERED'].includes(operation.operation_state);
  return `<article class="operation-card"><span><b>${escapeHtml(operation.event_name)}</b><small>${escapeHtml(operation.event_type.replaceAll('_', ' '))} · ${escapeHtml(operation.event_year)}</small></span><span class="operation-state state-${escapeHtml(operation.operation_state.toLowerCase())}">${escapeHtml(creationLabels[operation.operation_state] || operation.operation_state)}</span>${operation.safe_error_message ? `<p>${escapeHtml(operation.safe_error_message)}</p>` : ''}${retry ? `<button data-retry-operation="${escapeHtml(operation.id)}">Retry safely</button>` : ''}</article>`;
}
function renderCreationOperations() {
  const container = $('#creationSummary');
  if (!state.actor?.canCreateEvent) { container.hidden = true; return; }
  const groups = [
    ['Drafts', ['VALIDATED']], ['In Progress', ['REQUESTED', 'DRIVE_ROOT_CREATED', 'WIX_EVENT_REGISTERED', 'VERIFIED']],
    ['Ready for Review', ['READY_FOR_PUBLICATION']], ['Needs Attention', ['FAILED_NEEDS_ATTENTION']]
  ];
  container.innerHTML = groups.map(([label, states]) => {
    const rows = state.creationOperations.filter((item) => states.includes(item.operation_state));
    return `<button type="button" class="operation-filter ${state.operationFilter === label ? 'selected' : ''} ${label === 'Needs Attention' && rows.length ? 'needs-attention' : ''}" data-operation-filter="${label}" aria-pressed="${state.operationFilter === label}">${label} <strong>${rows.length}</strong></button>`;
  }).join('') + `<div class="operation-results">${state.creationOperations.filter((item) => state.operationFilter ? groups.find(([label]) => label === state.operationFilter)?.[1].includes(item.operation_state) : item.operation_state === 'FAILED_NEEDS_ATTENTION').map(operationCard).join('')}</div>`;
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
  if (['photographers','activity'].includes(name) && state.actor?.role !== 'PHOTO_ADMIN') name = 'events';
  if (name === 'media-assets' && !(state.actor?.headshotCapabilities || []).includes('HEADSHOT_VIEW')) name = 'events';
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
  $('#gallerySubmit').textContent = action === 'SET_COVER' ? 'Confirm cover' : 'Confirm';
  $('#galleryDialog').showModal();
  if (action === 'SET_COVER') loadCoverPhotos({ eventId, galleryFolderId, reset: true });
}

function renderCoverPhotos() {
  const browser = state.coverBrowser;
  if (!browser) return;
  $('#coverBrowserStatus').textContent = browser.loading
    ? 'Loading gallery photographs…'
    : browser.error
      ? browser.error.replaceAll('_', ' ')
      : `${browser.total.toLocaleString()} photographs · choose one cover`;
  $('#coverPhotoGrid').innerHTML = browser.photos.map((photo) => `<div class="cover-photo-shell"><button type="button" class="cover-photo ${photo.fileId === browser.selectedId ? 'selected' : ''}" data-cover-choice="${escapeHtml(photo.fileId)}" role="option" aria-selected="${photo.fileId === browser.selectedId}" title="${escapeHtml(photo.relativePath)}"><img src="${escapeHtml(photo.thumbnailUrl)}" alt="" loading="lazy">${photo.currentCover ? '<i class="cover-badge">CURRENT COVER</i>' : ''}<span>${escapeHtml(photo.filename)}</span></button><button type="button" class="danger" data-photo-remove="${escapeHtml(photo.fileId)}" data-photo-source="${escapeHtml(photo.sourceItemId)}" data-photo-name="${escapeHtml(photo.filename)}">Remove</button></div>`).join('');
  $('#loadMoreCoverPhotos').hidden = !browser.nextCursor || browser.loading;
  $('#gallerySubmit').disabled = !browser.selectedId || browser.loading;
}

async function loadCoverPhotos({ eventId, galleryFolderId, reset = false }) {
  if (reset) state.coverBrowser = { eventId, galleryFolderId, photos: [], nextCursor: '', total: 0, selectedId: '', loading: true, error: '' };
  const browser = state.coverBrowser;
  if (!browser || browser.loading && !reset) return;
  browser.loading = true; browser.error = ''; renderCoverPhotos();
  try {
    const cursor = reset ? '' : browser.nextCursor;
    const result = await api(`events/${encodeURIComponent(eventId)}/galleries/${encodeURIComponent(galleryFolderId)}/photos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
    browser.photos = reset ? result.photos : [...browser.photos, ...result.photos];
    browser.nextCursor = result.nextCursor || ''; browser.total = Number(result.total || browser.photos.length);
    const current = browser.photos.find((photo) => photo.currentCover || photo.fileId === result.gallery?.coverFileId);
    if (!browser.selectedId && current) browser.selectedId = current.fileId;
    if (browser.selectedId) $('#galleryForm').elements.coverFileId.value = browser.selectedId;
  } catch (error) { browser.error = error.message; }
  finally { browser.loading = false; renderCoverPhotos(); }
}

async function openEvent(id) {
  const { event, uploadAccess = { authorized: false }, galleryOperations = [], galleryManagementQualified } = await api(`events/${encodeURIComponent(id)}`);
  const detail = $('#eventDetail');
  detail.hidden = false;
  const known = new Map(event.galleries.map((g) => [g.drive_folder_id, g]));
  [...galleryOperations].reverse().filter((o) => o.gallery_folder_id).forEach((o) => {
    const current = known.get(o.gallery_folder_id);
    if (o.operation_type === 'CREATE' && !current) known.set(o.gallery_folder_id, { drive_folder_id: o.gallery_folder_id, public_name: o.requested_name, photo_count: 0, sync_status: o.operation_state, destination_url: o.drive_folder_url, cover_url: '', can_delete: state.actor.role === 'PHOTO_ADMIN' || o.requested_by_user_id === state.actor.id });
    if (o.operation_type === 'RENAME' && known.has(o.gallery_folder_id)) known.set(o.gallery_folder_id, { ...known.get(o.gallery_folder_id), public_name: o.requested_name, sync_status: o.operation_state });
  });
  const canCreate = event.capabilities.includes('GALLERY_CREATE'); const canRename = event.capabilities.includes('GALLERY_RENAME'); const canCover = event.capabilities.includes('GALLERY_COVER_SELECT'); const canDelete = event.capabilities.includes('GALLERY_DELETE_ANY') || event.capabilities.includes('GALLERY_DELETE_OWN');
  const cards = [...known.values()];
  const canOpenUpload = state.actor.role === 'PHOTO_ADMIN' || uploadAccess.authorized;
  const galleries = cards.length ? `<div class="gallery-grid">${cards.map((g) => `<article class="gallery-card"><span class="gallery-cover">${g.cover_url ? `<img src="${escapeHtml(g.cover_url)}" alt="" loading="lazy">` : '<span class="empty-cover">EMPTY GALLERY</span>'}</span><span class="gallery-copy"><b>${escapeHtml(g.public_name)}</b><small>${Number(g.photo_count).toLocaleString()} photos · ${escapeHtml(String(g.cover_selection_state || g.sync_status || 'SYNC_PENDING').replaceAll('_',' '))}</small></span><div class="gallery-actions">${canOpenUpload && g.destination_url ? `<a href="${escapeHtml(g.destination_url)}" target="_blank" rel="noopener">Open upload folder</a>` : '<span>Drive upload access pending</span>'}${canRename ? `<button data-gallery-rename="${escapeHtml(g.drive_folder_id)}" data-gallery-name="${escapeHtml(g.public_name)}" data-gallery-event="${escapeHtml(event.id)}">Rename</button>` : ''}${canCover ? `<button data-gallery-cover="${escapeHtml(g.drive_folder_id)}" data-gallery-event="${escapeHtml(event.id)}" ${Number(g.photo_count) ? '' : 'disabled'}>Manage photos / cover</button>` : ''}${canDelete && g.can_delete ? `<button class="danger" data-gallery-delete="${escapeHtml(g.drive_folder_id)}" data-gallery-name="${escapeHtml(g.public_name)}" data-gallery-count="${Number(g.photo_count)}" data-gallery-event="${escapeHtml(event.id)}">Delete gallery</button>` : ''}</div></article>`).join('')}</div>` : `<div class="gallery-empty">No galleries exist for this event yet.</div>`;
  detail.innerHTML = `<div class="section-head"><div><p class="eyebrow">${escapeHtml(event.series)} · ${escapeHtml(event.region)}</p><h2>${escapeHtml(event.public_name)}</h2></div><div class="event-management"><p>${escapeHtml(event.event_year)} · ${escapeHtml(event.sync_status.replaceAll('_', ' '))}</p>${canCreate ? `<button class="primary" data-gallery-create="${escapeHtml(event.id)}" ${galleryManagementQualified ? '' : 'disabled'}>Create gallery</button>` : ''}</div></div>${galleries}`;
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadPhotographers() {
  const { photographers } = await api('photographers');
  state.photographers = photographers;
  const options = state.events.map((event) => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.public_name)} ${escapeHtml(event.event_year)}</option>`).join('');
  $('#photographerList').innerHTML = photographers.length ? photographers.map((person) => {
    const count = assignedIds(person.event_ids).length;
    const pending = Boolean(person.invitation_id);
    const invitationOpen = pending && person.status === 'PENDING';
    return `<article class="person" id="person-${escapeHtml(person.id)}"><div class="person-main"><h3>${escapeHtml(person.email || person.display_name)}</h3><p>${escapeHtml(accountStatus(person.status))} · ${escapeHtml(person.preset_key || 'ASSIGNED').toLowerCase().replace(/^./, (c) => c.toUpperCase())} Photographer</p><small>${count} Assigned ${count === 1 ? 'Event' : 'Events'}${invitationOpen ? ` · ${person.expired ? 'Invitation expired' : 'Awaiting acceptance'}` : ''}</small></div><details class="person-management"><summary>${pending ? 'Manage Invitation' : 'Manage Access'}</summary><div class="person-actions">${pending ? `<p>${invitationOpen ? 'No invitation email was sent. Share the Photo Studio link to complete email verification.' : 'This invitation no longer permits acceptance. Create a new invitation only when access is approved again.'}</p><small>Created ${escapeHtml(localTimestamp(person.created_at))} · Expires ${escapeHtml(localTimestamp(person.expires_at))}</small>${invitationOpen ? `<button type="button" data-copy-studio>Copy Photo Studio Link</button><button data-invitation-revoke="${escapeHtml(person.invitation_id)}">Revoke invitation</button>` : ''}` : `<label>Access preset<select data-preset-select="${escapeHtml(person.id)}" aria-label="Permission preset for ${escapeHtml(person.email)}"><option value="ASSIGNED" ${person.preset_key === 'ASSIGNED' ? 'selected' : ''}>Assigned</option><option value="GENERAL" ${person.preset_key === 'GENERAL' ? 'selected' : ''}>General</option><option value="LEAD" ${person.preset_key === 'LEAD' ? 'selected' : ''}>Lead</option></select></label><button data-permissions="${escapeHtml(person.id)}">Apply preset</button><label>Event assignment<select data-assignment-select="${escapeHtml(person.id)}" aria-label="Event assignment for ${escapeHtml(person.email)}"><option value="">Select event</option>${options}</select></label><button data-assignment="${escapeHtml(person.id)}" data-active="true">Assign</button><button data-assignment="${escapeHtml(person.id)}" data-active="false">Revoke event</button><p class="assigned-event-names">${assignedIds(person.event_ids).map((id) => escapeHtml(state.events.find((event) => event.id === id)?.public_name || 'Assigned event')).join(' · ') || 'No event assignments'}</p><button data-status="${escapeHtml(person.id)}" data-next="${person.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}">${person.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button><button data-status="${escapeHtml(person.id)}" data-next="REVOKED">Revoke account</button><details class="diagnostics"><summary>Technical details</summary><small>${escapeHtml(person.id)}</small><small>${(person.capabilities || []).map(escapeHtml).join(', ')}</small></details>`}</div></details></article>`;
  }).join('') : '<div class="gallery-empty">No photographers or pending invitations.</div>';
}
async function loadMediaAssets() {
  try {
    const { leaders = [] } = await api('media-assets');
    state.leaders = leaders;
    renderLeaders();
  } catch (error) { $('#mediaAssets').innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`; }
}
function leaderMappingLabel(leader) {
  if(leader.mapping_status==='INACCESSIBLE') return 'ACCESS UNAVAILABLE';
  if(leader.mapping_status==='MISSING') return 'NEEDS FOLDER';
  if(leader.mapping_status==='VERIFIED'&&leader.management_enabled===false) return 'VERIFIED — ACTIVATION PENDING';
  return leader.mapping_status==='VERIFIED'&&leader.mapping_state==='VERIFIED'&&leader.management_enabled!==false&&leader.sync_status!=='FAILED' ? 'READY TO MANAGE' : 'MAPPING NEEDS REVIEW';
}
async function verifyLeaderMappings() {
  if(state.actor?.role!=='PHOTO_ADMIN'||!state.leaders.length||state.mappingVerificationActive) return;
  const button=$('#verifyLeaderMappings'),output=$('#leaderMappingProgress');
  state.mappingVerificationActive=true;button.disabled=true;let completed=0,failed=0;
  const targets=state.leaders.slice();
  try {
    for(const target of targets) {
      output.textContent=`Verifying ${completed+1} of ${targets.length}: ${target.leader_name}`;
      try {
        const result=await api(`headshots/${encodeURIComponent(target.wix_item_id)}`);
        if(result.leader?.wix_item_id!==target.wix_item_id) throw new Error('leader_identity_mismatch');
        const index=state.leaders.findIndex(row=>row.wix_item_id===target.wix_item_id);
        if(index>=0)state.leaders[index]=result.leader;
      }catch{failed++;}
      completed++;renderLeaders();
    }
    output.textContent=`Verification complete: ${completed} records checked${failed?`; ${failed} requests need attention`:''}. No photographs or CMS records were modified.`;
  }finally{state.mappingVerificationActive=false;button.disabled=false;}
}
function renderLeaders() {
  $('#verifyLeaderMappings').disabled=!state.leaders.length||state.mappingVerificationActive;
  const query = ($('#leaderSearch').value || '').trim().toLocaleLowerCase();
  const leaders = state.leaders.filter((leader) => leader.leader_name.toLocaleLowerCase().includes(query)).sort((a,b) => a.leader_name.localeCompare(b.leader_name));
  $('#leaderCount').textContent = `${leaders.length} of ${state.leaders.length} leaders · Wix CMS directory`;
  $('#mediaAssets').innerHTML = leaders.map((leader) => `<article class="leader-card"><div class="leader-image">${leader.primary_image_url ? `<img src="${escapeHtml(leader.primary_image_url)}" alt="${escapeHtml(leader.leader_name)}" loading="lazy">` : '<span>No primary headshot</span>'}</div><div><h3>${escapeHtml(leader.leader_name)}</h3><p>${leader.photo_count == null ? 'Photo count awaiting Drive verification' : `${leader.photo_count} photographs`}</p><small>${leaderMappingLabel(leader)}</small><button type="button" data-leader="${escapeHtml(leader.wix_item_id)}">Open Leader</button></div></article>`).join('') || '<p class="notice">No matching leaders.</p>';
}
async function openLeader(id) {
  const leader = state.leaders.find((item) => item.wix_item_id === id);
  if (!leader) return;
  state.headshotProfile={id,leader,photos:[],nextCursor:'',loading:true,writesEnabled:false,error:''};
  $('#leaderDialogTitle').textContent = leader.leader_name;
  $('#leaderDialog').showModal();
  renderHeadshotProfile();
  try {
    const result=await api(`headshots/${encodeURIComponent(id)}`);
    if(state.headshotProfile?.id!==id) return;
    if(result.leader?.wix_item_id!==id) throw new Error('leader_identity_mismatch');
    if(state.actor.role==='PHOTO_ADMIN') { const people=await api('photographers');state.photographers=people.photographers||[]; }
    state.headshotProfile={...state.headshotProfile,...result,photos:result.photos||[],loading:false};
    const index=state.leaders.findIndex((item)=>item.wix_item_id===id);if(index>=0) state.leaders[index]=result.leader;
    renderLeaders();
  } catch(error) {if(state.headshotProfile?.id===id) Object.assign(state.headshotProfile,{loading:false,error:error.message});}
  renderHeadshotProfile();
}
function renderHeadshotProfile() {
  const profile=state.headshotProfile;if(!profile) return;
  const leader=profile.leader,ready=profile.writesEnabled&&profile.canManage&&leader.mapping_status==='VERIFIED';
  const access=state.actor.role==='PHOTO_ADMIN'?`<details class="headshot-access"><summary>Manage leader access</summary><p>Headshot permissions apply only to this leader and are separate from event access.</p><label>Photographer<select id="headshotPhotographer"><option value="">Select photographer</option>${state.photographers.filter((person)=>person.status==='ACTIVE'&&!person.invitation_id).map((person)=>`<option value="${escapeHtml(person.id)}">${escapeHtml(person.email)}</option>`).join('')}</select></label><label>Headshot permissions<select id="headshotPermissionPreset"><option value="VIEW">View</option><option value="UPLOAD">View &amp; Upload</option><option value="MANAGE">View, Upload &amp; Manage</option><option value="REVOKE">Revoke access</option></select></label><button type="button" data-headshot-access ${profile.writesEnabled?'':'disabled'}>Apply headshot access</button></details>`:'';
  $('#leaderProfile').innerHTML=`${leader.primary_image_url?`<img class="leader-primary" src="${escapeHtml(leader.primary_image_url)}" alt="${escapeHtml(leader.leader_name)}">`:''}<p>${leader.primary_drive_file_id?'Approved Drive primary headshot (legacy public Wix image preserved)':'Current Wix primary headshot'}</p><p class="notice" aria-live="polite">${profile.loading?'Loading verified leader photographs…':leader.mapping_status&&leader.mapping_status!=='VERIFIED'?leaderMappingLabel(leader):profile.error?escapeHtml(profile.error.replaceAll('_',' ')):leader.sync_error?escapeHtml(leader.sync_error.replaceAll('_',' ')):`${Number(profile.total||0)} photographs · ${escapeHtml(String(leader.sync_status||'AWAITING_DISCOVERY').replaceAll('_',' '))}`}</p>${!profile.writesEnabled?'<p class="form-note">Primary selection, removal and folder creation remain disabled until controlled qualification is complete.</p>':''}${profile.canUpload&&profile.uploadUrl?`<a class="headshot-upload" href="${escapeHtml(profile.uploadUrl)}" target="_blank" rel="noopener noreferrer">OPEN GOOGLE DRIVE UPLOAD FOLDER ↗</a>`:'<button disabled>Open upload folder</button>'}<div class="headshot-photo-grid">${profile.photos.map((photo)=>`<article><img src="${escapeHtml(photo.thumbnailUrl)}" alt="${escapeHtml(photo.filename)}" loading="lazy"><p>${escapeHtml(photo.filename)}</p>${photo.currentPrimary?'<strong>Current primary</strong>':''}<button type="button" data-headshot-primary="${escapeHtml(photo.fileId)}" data-headshot-source="${escapeHtml(photo.sourceItemId)}" ${ready&&!photo.currentPrimary?'':'disabled'}>Set Primary Headshot</button><button type="button" class="danger" data-headshot-remove="${escapeHtml(photo.fileId)}" data-headshot-source="${escapeHtml(photo.sourceItemId)}" ${ready&&!photo.currentPrimary&&leader.primary_drive_file_id?'':'disabled'}>Remove Photograph</button></article>`).join('')}</div>${profile.nextCursor?'<button type="button" data-headshot-more>Load more photographs</button>':''}<div class="headshot-disabled-actions"><button type="button" data-headshot-create ${profile.writesEnabled&&state.actor.role==='PHOTO_ADMIN'&&!leader.candidate_drive_folder_id?'':'disabled'}>CREATE HEADSHOT FOLDER</button><button disabled title="Leader creation requires a qualified inactive-record contract">Add leader</button></div>${access}<details class="diagnostics"><summary>Operation history</summary>${(profile.operationHistory||[]).map(operation=>`<p>${escapeHtml(operation.operation_type.replaceAll('_',' '))} · ${escapeHtml(operation.operation_state)} · ${escapeHtml(localTimestamp(operation.updated_at))}</p>`).join('')||'<p>No recorded operations.</p>'}</details><output id="headshotActionResult" aria-live="polite"></output><details class="diagnostics"><summary>Identity and source evidence</summary><p>Wix record: ${escapeHtml(leader.wix_item_id)}</p><p>CMS folder reference: ${escapeHtml(leader.candidate_drive_folder_id||'None')}</p><p>Mapping: ${escapeHtml(leader.mapping_state)}</p><p>Verified ${escapeHtml(localTimestamp(leader.indexed_at))}</p></details>`;
  if(profile.collections?.length) {
    const oldUpload=$('#leaderProfile .headshot-upload')||[...$('#leaderProfile').querySelectorAll('button')].find(button=>button.textContent==='Open upload folder');
    oldUpload?.remove();
    const collections=document.createElement('section');
    collections.className='headshot-collections';collections.setAttribute('aria-label','Authorized photo collections');
    collections.innerHTML=`<h3>Photo Collections</h3>${profile.collections.map(source=>`<div><strong>${escapeHtml(source.label)}</strong><span>${Number(source.photoCount)} photographs · ${source.shared?'Shared':'Individual'}</span>${source.canUpload?`<a class="headshot-upload" href="${escapeHtml(source.uploadUrl)}" target="_blank" rel="noopener noreferrer">UPLOAD TO THIS COLLECTION ↗</a>`:''}</div>`).join('')}<p>Available photographs: ${Number(profile.total||0)}</p>`;
    $('#leaderProfile .headshot-photo-grid').before(collections);
    [...$('#leaderProfile .headshot-photo-grid').querySelectorAll('article')].forEach((card,index)=>{
      const photo=profile.photos[index];
      const label=document.createElement('p');label.className='form-note';
      label.textContent=(photo.sources||[]).map(source=>`${source.label}${source.shared?' · Shared':''}`).join(' / ');
      card.querySelector('p').after(label);
      if(photo.shared&&state.actor.role!=='PHOTO_ADMIN') {const button=card.querySelector('[data-headshot-remove]');button.disabled=true;button.title='Shared photographs can be removed only by an administrator';}
      if(profile.canPublish&&state.actor.role==='PHOTO_ADMIN') {
        const button=document.createElement('button');button.type='button';button.dataset.publicHeadshot=photo.fileId;
        button.textContent=photo.publicApproved?'Revoke Public Display':'Approve Public Display';
        card.append(button);
      }
    });
  }
  if(!profile.loading&&profile.discoveryEnabled===false&&!profile.error) $('#leaderProfile .notice').textContent='Photograph discovery awaits controlled verification. The current Wix primary image is preserved.';
}
async function headshotAction(action,fileId='',sourceItemId='') {
  const profile=state.headshotProfile;if(!profile) return;
  const photo=profile.photos.find((item)=>item.fileId===fileId&&item.sourceItemId===sourceItemId);
  const message=action==='SET_PRIMARY'?`Use “${photo?.filename}” as ${profile.leader.leader_name}'s approved Drive primary headshot? The existing public Wix image will be preserved.`:
    action==='REMOVE_PHOTO'?`Move “${photo?.filename}” to Google Drive Trash? The current primary must remain intact.`:`Create the canonical folder for ${profile.leader.leader_name}?`;
  if(!confirm(message)) return;
  const output=$('#headshotActionResult');output.textContent='Applying and verifying the operation…';
  try {
    const result=await api(`headshots/${encodeURIComponent(profile.id)}/operations`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({action,fileId,sourceItemId,confirmed:true})});
    const refreshed=await api(`headshots/${encodeURIComponent(profile.id)}`);
    if(state.headshotProfile?.id!==profile.id) return;
    state.headshotProfile={id:profile.id,...refreshed,loading:false};renderHeadshotProfile();
    $('#headshotActionResult').textContent=result.operation?.operation_state==='CONFIRMED'?'Operation confirmed. Wix and Drive state verified.':'Operation recorded; confirmation pending.';
  } catch(error) {output.textContent=error.message.replaceAll('_',' ');}
}
async function loadActivity() {
  const { activity } = await api('activity');
  $('#activityList').innerHTML = activity.length ? activity.map((item) => `<article class="activity-row"><time datetime="${escapeHtml(utcDate(item.occurred_at)?.toISOString() || '')}">${escapeHtml(localTimestamp(item.occurred_at))}</time><span><b>${escapeHtml(item.operation)}</b><small>${escapeHtml(item.actor_email || 'System')} · ${escapeHtml(item.target_type || '')}</small></span><span>${escapeHtml(item.operation_outcome)}</span></article>`).join('') : '<div class="gallery-empty">No Photo Studio administrative actions have occurred.</div>';
}

async function boot() {
  try {
    const { actor } = await api('session');
    const { events } = await api('events');
    state.actor = actor; state.events = events;
    const isAdmin = actor.role === 'PHOTO_ADMIN';
    document.body.classList.toggle('is-admin', isAdmin);
    $$('.admin-only').forEach((item) => { item.hidden = !isAdmin; });
    $('[data-view="media-assets"]').hidden = !(actor.headshotCapabilities || (isAdmin ? ['HEADSHOT_VIEW'] : [])).includes('HEADSHOT_VIEW');
    if (isAdmin && !actor.headshotCapabilities) actor.headshotCapabilities = ['HEADSHOT_VIEW','HEADSHOT_UPLOAD','HEADSHOT_MANAGE'];
    $$('.creator-only').forEach((item) => { item.hidden = !actor.canCreateEvent; });
    $('#actorName').textContent = actor.displayName;
    $('#actorRole').textContent = isAdmin ? 'Administrator' : 'Photographer';
    $('#signOut').hidden = false;
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
  const filter = event.target.closest('[data-operation-filter]'); if (filter) { state.operationFilter = state.operationFilter === filter.dataset.operationFilter ? '' : filter.dataset.operationFilter; renderCreationOperations(); }
  const leader = event.target.closest('[data-leader]'); if (leader) openLeader(leader.dataset.leader);
  if (event.target.closest('[data-close-leader]')) {$('#leaderDialog').close();state.headshotProfile=null;}
  const headshotPrimary=event.target.closest('[data-headshot-primary]');if(headshotPrimary) await headshotAction('SET_PRIMARY',headshotPrimary.dataset.headshotPrimary,headshotPrimary.dataset.headshotSource);
  const headshotRemove=event.target.closest('[data-headshot-remove]');if(headshotRemove) await headshotAction('REMOVE_PHOTO',headshotRemove.dataset.headshotRemove,headshotRemove.dataset.headshotSource);
  const publication=event.target.closest('[data-public-headshot]');if(publication&&state.headshotProfile) {
    const profile=state.headshotProfile,photo=profile.photos.find(p=>p.fileId===publication.dataset.publicHeadshot);
    if(!photo || !confirm(photo.publicApproved?'Remove this photograph from this leader’s public Headshots V2 collection?':'Approve this photograph for anonymous public display and derivative download on Headshots V2? Drive permissions will not change.')) return;
    try {
      await api(`headshots/${encodeURIComponent(profile.id)}/publication`,{method:'POST',body:JSON.stringify({fileId:photo.fileId,approved:!photo.publicApproved,confirmed:true})});
      const refreshed=await api(`headshots/${encodeURIComponent(profile.id)}`);
      if(state.headshotProfile?.id===profile.id) {state.headshotProfile={id:profile.id,...refreshed,loading:false};renderHeadshotProfile();$('#headshotActionResult').textContent='Public approval updated. New derivatives are prepared by governed reconciliation.';}
    } catch(error) {$('#headshotActionResult').textContent=error.message.replaceAll('_',' ');}
  }
  if(event.target.closest('[data-headshot-create]')) await headshotAction('CREATE_FOLDER');
  if(event.target.closest('[data-headshot-access]')&&state.headshotProfile) {
    const userId=$('#headshotPhotographer').value,preset=$('#headshotPermissionPreset').value;
    if(!userId){$('#headshotPhotographer').focus();return;}
    if(!confirm(`Apply ${preset.toLowerCase()} headshot access for this photographer to ${state.headshotProfile.leader.leader_name}?`)) return;
    try {const result=await api(`headshots/${state.headshotProfile.id}/access`,{method:'POST',body:JSON.stringify({userId,preset})});$('#headshotActionResult').textContent=result.state.replaceAll('_',' ');}
    catch(error){$('#headshotActionResult').textContent=error.message.replaceAll('_',' ');}
  }
  if(event.target.closest('[data-headshot-more]')&&state.headshotProfile?.nextCursor) {
    const profile=state.headshotProfile;
    try {const next=await api(`headshots/${encodeURIComponent(profile.id)}?cursor=${encodeURIComponent(profile.nextCursor)}`);if(state.headshotProfile?.id===profile.id){profile.photos.push(...next.photos);profile.nextCursor=next.nextCursor;renderHeadshotProfile();}}
    catch(error){$('#headshotActionResult').textContent=error.message;}
  }
  if (event.target.closest('[data-copy-studio]')) {
    try { await navigator.clipboard.writeText(`${location.origin}/photos/`); event.target.textContent = 'Link copied'; }
    catch { $('#inviteResult').textContent = `Share this link: ${location.origin}/photos/`; }
  }
  const manageInvite = event.target.closest('[data-manage-invitation]'); if (manageInvite) {
    const details = $(`#person-${CSS.escape(manageInvite.dataset.manageInvitation)} .person-management`);
    if (details) { details.open = true; details.scrollIntoView({ block: 'nearest' }); details.querySelector('summary').focus(); }
  }
  const revokeInvite = event.target.closest('[data-invitation-revoke]'); if (revokeInvite) {
    try { await api('invitations/revoke', { method: 'POST', body: JSON.stringify({ invitationId: revokeInvite.dataset.invitationRevoke }) }); await loadPhotographers(); $('#inviteResult').textContent = 'Invitation revoked. Sign-in can no longer accept it.'; }
    catch (error) { $('#inviteResult').textContent = error.message; }
  }
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
  const coverChoice = event.target.closest('[data-cover-choice]'); if (coverChoice && state.coverBrowser) {
    state.coverBrowser.selectedId = coverChoice.dataset.coverChoice;
    $('#galleryForm').elements.coverFileId.value = state.coverBrowser.selectedId;
    renderCoverPhotos();
  }
  const removePhoto = event.target.closest('[data-photo-remove]'); if (removePhoto && state.coverBrowser) {
    const browser = state.coverBrowser;
    if (!confirm(`Remove “${removePhoto.dataset.photoName}” from this gallery? It will be moved to Google Drive Trash and can be restored there.`)) return;
    removePhoto.disabled = true;
    try {
      await api(`events/${encodeURIComponent(browser.eventId)}/galleries/${encodeURIComponent(browser.galleryFolderId)}/photos/${encodeURIComponent(removePhoto.dataset.photoRemove)}`, { method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ fileId: removePhoto.dataset.photoRemove, sourceItemId: removePhoto.dataset.photoSource, filename: removePhoto.dataset.photoName }) });
      await loadCoverPhotos({ eventId: browser.eventId, galleryFolderId: browser.galleryFolderId, reset: true });
    } catch (error) { $('#coverBrowserStatus').textContent = error.message.replaceAll('_', ' '); }
  }
  const deleteGallery = event.target.closest('[data-gallery-delete]'); if (deleteGallery) {
    const count = Number(deleteGallery.dataset.galleryCount || 0);
    const explanation = count ? ` It currently contains ${count.toLocaleString()} photos.` : ' It is currently empty.';
    if (!confirm(`Delete gallery “${deleteGallery.dataset.galleryName}”?${explanation} The entire folder will be moved to Google Drive Trash and can be restored there.`)) return;
    deleteGallery.disabled = true;
    try {
      await api(`events/${encodeURIComponent(deleteGallery.dataset.galleryEvent)}/galleries/${encodeURIComponent(deleteGallery.dataset.galleryDelete)}`, { method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ photoCount: count }) });
      await openEvent(deleteGallery.dataset.galleryEvent);
    } catch (error) { alert(error.message.replaceAll('_', ' ')); deleteGallery.disabled = false; }
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
  if (values.action === 'SET_COVER') {
    const selected = state.coverBrowser?.photos.find((photo) => photo.fileId === values.coverFileId);
    if (!selected || !confirm(`Use “${selected.filename}” as this gallery's cover? The website will update after reconciliation confirms it.`)) return;
  }
  output.value = 'Applying the governed Drive operation…';
  try { await galleryAction(values.eventId, values.action, values); $('#galleryDialog').close(); }
  catch (error) { output.value = error.message.replaceAll('_', ' '); }
});
$('#loadMoreCoverPhotos').addEventListener('click', () => {
  const browser = state.coverBrowser;
  if (browser?.nextCursor) loadCoverPhotos({ eventId: browser.eventId, galleryFolderId: browser.galleryFolderId });
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
  try {
    const { invitation } = await api('invitations', { method: 'POST', body: JSON.stringify(data) });
    // Reset first: HTML form reset also restores <output> to its default value.
    form.reset();
    output.innerHTML = `<strong>${invitation.existing ? 'Photographer access already exists' : 'Photographer invitation created'}</strong><span>${escapeHtml(invitation.email)}</span><span>Status: ${invitation.status === 'PENDING' ? 'Awaiting acceptance' : escapeHtml(accountStatus(invitation.status))}</span><p>No invitation email was sent. Access has been prepared. Share the Photo Studio link with this photographer to complete sign-in.</p><button type="button" data-copy-studio>Copy Photo Studio Link</button><button type="button" data-manage-invitation="${escapeHtml(invitation.id)}">${invitation.status === 'PENDING' ? 'Manage Invitation' : 'Manage Access'}</button>`;
    await loadPhotographers(); await loadActivity();
  }
  catch (error) { output.textContent = error.message; }
});
$('#leaderSearch').addEventListener('input', renderLeaders);
$('#verifyLeaderMappings').addEventListener('click', verifyLeaderMappings);
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
$('#signOut').addEventListener('click', () => {
  state.actor = null; state.events = []; state.overview = null; state.coverBrowser = null;
  const returnTo = `${location.origin}/photos/`;
  location.assign(`/cdn-cgi/access/logout?returnTo=${encodeURIComponent(returnTo)}`);
});
boot();
