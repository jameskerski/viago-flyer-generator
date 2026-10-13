const driveId = /^[A-Za-z0-9_-]{10,160}$/;
const uuid = /^[a-f0-9-]{36}$/i;

export async function leaderSourcePlan(database, leaderId) {
  if (!uuid.test(leaderId)) throw new Error('invalid_leader_identity');
  const sources = (await database.prepare(`SELECT s.*,r.relationship_type,r.sort_order FROM headshot_leader_sources r JOIN headshot_photo_sources s ON s.folder_id=r.folder_id WHERE r.wix_item_id=? AND r.status='ACTIVE' ORDER BY r.sort_order,s.folder_id`).bind(leaderId).all()).results || [];
  for (const source of sources) {
    source.linkedLeaderIds = (await database.prepare(`SELECT wix_item_id FROM headshot_leader_sources WHERE folder_id=? AND status='ACTIVE' ORDER BY wix_item_id`).bind(source.folder_id).all()).results.map(row => row.wix_item_id);
    source.shared = source.relationship_type === 'SHARED' || source.linkedLeaderIds.length > 1;
  }
  return sources;
}

export function combineSourceInventories(sources, snapshots) {
  if (!Array.isArray(sources) || sources.length > 16 || !Array.isArray(snapshots) || snapshots.length !== sources.length) throw new Error('incomplete_source_inventory');
  const canonical = new Map();
  const collections = sources.map(source => {
    if (!driveId.test(source.folder_id)) throw new Error('invalid_drive_identity');
    const matches = snapshots.filter(snapshot => snapshot.folderId === source.folder_id);
    if (matches.length !== 1 || matches[0].verificationState !== 'VERIFIED' || !Array.isArray(matches[0].photos) || matches[0].photos.length > 5000) throw new Error('source_verification_failed');
    const seen = new Set();
    for (const photo of matches[0].photos) {
      if (!driveId.test(photo.fileId) || !driveId.test(photo.sourceItemId) || !['image/png','image/jpeg'].includes(photo.mimeType) || seen.has(photo.fileId)) throw new Error('invalid_source_photo');
      seen.add(photo.fileId);
      const origin = { folderId: source.folder_id, label: source.display_label, shared: source.shared === true };
      const previous = canonical.get(photo.fileId);
      if (previous) {
        previous.sources.push(origin);
        previous.shared = true;
        // Prefer a canonical file rather than a shortcut as the removal identity.
        if (previous.shortcut && !photo.shortcut) Object.assign(previous, photo, { sourceFolderId: source.folder_id });
      } else canonical.set(photo.fileId, { ...photo, sourceFolderId: source.folder_id, shared: origin.shared, sources: [origin] });
    }
    return { folderId: source.folder_id, label: source.display_label, shared: source.shared === true, photoCount: seen.size };
  });
  const photos = [...canonical.values()].sort((a,b) => a.filename.localeCompare(b.filename) || a.fileId.localeCompare(b.fileId));
  return { photos, collections, total: photos.length };
}

export function assertSourcePhotoOperation({ actorRole, operation, photo, linkedPrimaries }) {
  if (!photo) throw new Error('headshot_photo_outside_leader_scope');
  if (operation !== 'REMOVE_PHOTO') return;
  if (photo.shared && actorRole !== 'PHOTO_ADMIN') throw new Error('shared_photo_deletion_administrator_required');
  if (linkedPrimaries.some(primary => primary.fileId === photo.fileId)) throw new Error('linked_leader_primary_requires_replacement');
}

export async function reconcileSharedHeadshotSnapshot(database, input) {
  const row = await database.prepare('SELECT * FROM headshot_leaders WHERE wix_item_id=?').bind(input.wixItemId).first();
  if (!row) throw new Error('authoritative_leader_not_indexed');
  const plan = await leaderSourcePlan(database, input.wixItemId);
  if (!plan.length) throw new Error('authorized_sources_missing');
  const inventory = combineSourceInventories(plan, input.sources);
  const primaryFileId = String(input.primaryFileId || '');
  const reference = input.imageReference || null;
  if (reference && (reference.fileId !== primaryFileId || !inventory.photos.some(p => p.fileId === reference.fileId && p.sources.some(s => s.folderId === reference.sourceFolderId)) || reference.displayUrl !== `https://drive.google.com/thumbnail?id=${reference.fileId}&sz=w1600`)) throw new Error('invalid_confirmed_image_reference');
  const photos = inventory.photos.map(p => ({ ...p, currentPrimary: p.fileId === primaryFileId, thumbnailUrl: `https://drive.google.com/thumbnail?id=${p.fileId}&sz=w480` }));
  const normalized = { collections: inventory.collections, photos, primaryFileId, reference, primaryImage: String(input.primaryImage || ''), leaderName: String(input.leaderName || row.leader_name), active: typeof input.active === 'boolean' ? input.active : row.active === 1 };
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(normalized)));
  const fingerprint = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
  const freshPublicProof=async()=>{
    // Reuse the same complete, authenticated Drive evidence already reconciled
    // by the producer. An unchanged fingerprint is not an unchanged check time.
    if(input.sourceContractVersion===3 && typeof input.active==='boolean')
      await database.prepare(`INSERT INTO headshot_public_checks(wix_item_id,check_state,checked_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(wix_item_id) DO UPDATE SET check_state=excluded.check_state,checked_at=excluded.checked_at,lease_until=NULL`).bind(input.wixItemId,input.active?'AVAILABLE':'UNAVAILABLE').run();
  };
  if (row.source_fingerprint === fingerprint && row.mapping_status === 'VERIFIED') { await freshPublicProof();return { changed: false, leaderId: row.wix_item_id, photoCount: photos.length, fingerprint, collections: inventory.collections }; }
  // Validate every source before replacing any cached inventory. Partial scans never publish partial totals.
  for (const source of input.sources) {
    await database.prepare(`UPDATE headshot_photo_sources SET verification_state='VERIFIED',photo_inventory_json=?,source_fingerprint=?,evidence_json=? WHERE folder_id=?`).bind(JSON.stringify(source.photos),String(source.fingerprint || ''),JSON.stringify(source.evidence || {}),source.folderId).run();
  }
  const media = normalized.primaryImage.match(/^wix:image:\/\/v1\/([^/]+)/)?.[1];
  // A shared-only leader has no singular compatibility folder. Never force a
  // shared relationship through the legacy UNIQUE cache column.
  const individual = plan.find(s => s.relationship_type === 'INDIVIDUAL' && !s.shared);
  const evidence = JSON.stringify({ source: 'verified-d1-source-relationships', collections: inventory.collections });
  await database.prepare(`UPDATE headshot_leaders SET verified_drive_folder_id=?,mapping_state='VERIFIED',mapping_status='VERIFIED',mapping_evidence_json=?,photo_count=?,photo_inventory_json=?,source_fingerprint=?,primary_image_source=?,primary_image_url=?,primary_drive_file_id=?,leader_name=?,active=?,source_updated_at=COALESCE(?,source_updated_at),sync_status='CONFIRMED',sync_error=NULL,indexed_at=CURRENT_TIMESTAMP WHERE wix_item_id=?`).bind(individual?.folder_id||null,evidence,photos.length,JSON.stringify(photos),fingerprint,normalized.primaryImage,reference?.displayUrl || (media ? `https://static.wixstatic.com/media/${media}` : ''),primaryFileId || null,normalized.leaderName,normalized.active ? 1 : 0,input.sourceUpdatedAt || null,input.wixItemId).run();
  await freshPublicProof();
  return { changed: true, leaderId: row.wix_item_id, photoCount: photos.length, fingerprint, collections: inventory.collections };
}
