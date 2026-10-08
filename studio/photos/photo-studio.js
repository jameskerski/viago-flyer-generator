const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { actor: null, events: [], overview: null };
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
  const letters = escapeHtml(event.series.slice(0, 2).toUpperCase());
  const art = event.artwork_url ? `<img src="${escapeHtml(event.artwork_url)}" alt="" loading="lazy">` : `<b>${letters}</b>`;
  const stale = event.sync_status !== 'CONFIRMED' || !event.last_reconciled_at || Date.now() - new Date(event.last_reconciled_at).getTime() > 26 * 60 * 60 * 1000;
  return `<button class="event-card" data-event="${escapeHtml(event.id)}" aria-label="Open ${escapeHtml(event.public_name)}"><span class="event-art">${art}<i class="sync-state ${stale ? 'stale' : ''}">${stale ? 'STALE' : 'CURRENT'}</i></span><span class="event-body"><h3>${escapeHtml(event.public_name)}</h3><p>${escapeHtml(event.region)} · ${escapeHtml(event.event_year)}</p><span class="event-stats"><span>${escapeHtml(event.gallery_count)} galleries</span><span>${Number(event.photo_count).toLocaleString()} photos</span></span></span></button>`;
}

function showView(name) {
  $$('[data-view-panel]').forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== name; });
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  if (name === 'photographers') loadPhotographers();
  if (name === 'activity') loadActivity();
  if (name === 'media-assets') loadMediaAssets();
  history.replaceState(null, '', name === 'overview' ? '/photos/' : `/photos/?view=${name}`);
}

async function openEvent(id) {
  const { event } = await api(`events/${encodeURIComponent(id)}`);
  const detail = $('#eventDetail');
  detail.hidden = false;
  const galleries = event.galleries.length ? `<div class="gallery-grid">${event.galleries.map((g) => `<article class="gallery-card"><a href="${escapeHtml(g.destination_url)}" target="_blank" rel="noopener"><span class="gallery-cover">${g.cover_url ? `<img src="${escapeHtml(g.cover_url)}" alt="" loading="lazy">` : ''}</span><span class="gallery-copy"><b>${escapeHtml(g.public_name)}</b><small>${Number(g.photo_count).toLocaleString()} photos · ${escapeHtml(g.sync_status)}</small><small>Folder ${escapeHtml(g.drive_folder_id)}</small></span></a><div class="gallery-actions"><span>View available</span><span>Create · Rename · Cover · Upload pending qualification</span></div></article>`).join('')}</div>` : `<div class="gallery-empty">No reconciled public galleries are available for this event.</div>`;
  detail.innerHTML = `<div class="section-head"><div><p class="eyebrow">${escapeHtml(event.series)} · ${escapeHtml(event.region)}</p><h2>${escapeHtml(event.public_name)}</h2></div><p>${escapeHtml(event.event_year)} · ${escapeHtml(event.sync_status.replaceAll('_', ' '))}</p></div>${galleries}`;
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
      const select = $('#inviteForm select'); events.forEach((event) => select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(event.id)}">${escapeHtml(event.public_name)} ${escapeHtml(event.event_year)}</option>`));
    } else $('#metrics').innerHTML = metric(events.length, 'Assigned events') + metric(events.reduce((n,e)=>n+e.gallery_count,0), 'Available galleries') + metric(events.reduce((n,e)=>n+e.photo_count,0), 'Confirmed photos');
    const requested = new URL(location.href).searchParams.get('view'); showView(requested && $(`[data-view-panel="${requested}"]`) ? requested : 'overview');
  } catch (error) {
    $('#loading').hidden = true; $('#denied').hidden = false;
    $('#deniedMessage').textContent = error.status === 403 ? 'This authenticated Google account has not been invited to Photo Studio.' : 'Secure access could not be verified. Please refresh or contact an administrator.';
  }
}

document.addEventListener('click', async (event) => {
  const view = event.target.closest('[data-view]'); if (view) showView(view.dataset.view);
  const card = event.target.closest('[data-event]'); if (card) await openEvent(card.dataset.event);
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
});
$('#newEvent').addEventListener('click', () => $('#eventWizard').showModal());
$('#inviteForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const output = $('#inviteResult'); output.value = 'Creating invitation…';
  try { const { invitation } = await api('invitations', { method: 'POST', body: JSON.stringify(data) }); output.value = `Invitation ready for ${invitation.email}. Access is granted when that Google account signs in.`; event.currentTarget.reset(); await loadActivity(); }
  catch (error) { output.value = error.message; }
});
boot();
