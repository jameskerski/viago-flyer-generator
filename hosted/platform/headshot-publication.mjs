import { leaderSourcePlan } from './headshot-sources.mjs';

const uuid = /^[a-f0-9-]{36}$/i;
const fileIdPattern = /^[A-Za-z0-9_-]{10,160}$/;
const wixImagePattern = /^wix:image:\/\/v1\/([A-Za-z0-9_~.-]+\.(?:png|jpe?g))\//i;
export const MAX_PUBLIC_IMAGE_BYTES = 786432;

export function publicWixImageUrl(reference) {
  const media = String(reference || '').match(wixImagePattern)?.[1];
  return media ? `https://static.wixstatic.com/media/${media}` : '';
}

export function approvedPublicInventory({ leader, sources, approvals, media }) {
  if (!leader || leader.active !== 1 || leader.mapping_status !== 'VERIFIED') return [];
  const allowed = new Map(approvals.filter(a => a.approval_state === 'APPROVED' && a.wix_item_id === leader.wix_item_id).map(a => [a.file_id,a]));
  const verifiedSources = new Set(sources.filter(s => s.verification_state === 'VERIFIED').map(s => s.folder_id));
  const ready = new Map(media.filter(m => m.media_state === 'READY' && publicWixImageUrl(m.wix_file_url)).map(m => [m.file_id, m]));
  const seen = new Set();
  return JSON.parse(leader.photo_inventory_json || '[]').filter(photo => {
    if (photo.trashed === true || !['image/png','image/jpeg'].includes(photo.mimeType)) return false;
    if (!fileIdPattern.test(photo.fileId) || seen.has(photo.fileId) || !allowed.has(photo.fileId) || !ready.has(photo.fileId) || !photo.sourceVersion || ready.get(photo.fileId).source_version!==photo.sourceVersion) return false;
    if (!photo.modifiedTime || !(Date.parse(photo.modifiedTime)<=Date.parse(allowed.get(photo.fileId).approved_at))) return false;
    if (!(photo.sources || []).some(source => verifiedSources.has(source.folderId))) return false;
    seen.add(photo.fileId); return true;
  }).map(photo => ({
    fileId: photo.fileId,
    filename: String(photo.filename || ''),
    downloadFilename: String(photo.filename || 'headshot').replace(/\.[^.]+$/, '')+(ready.get(photo.fileId).mime_type==='image/png'?'.png':'.jpg'),
    displayUrl: publicWixImageUrl(ready.get(photo.fileId).wix_file_url),
    assetReference: ready.get(photo.fileId).wix_file_url,
    sourceVersion: ready.get(photo.fileId).source_version,
    sources: (photo.sources || []).filter(s => verifiedSources.has(s.folderId)).map(s => ({ label: s.label, shared: s.shared === true })),
    originalUrl: `https://drive.google.com/file/d/${photo.fileId}/view`,
    originalRequiresGooglePermissions: true
  })).sort((a,b) => a.filename.localeCompare(b.filename) || a.fileId.localeCompare(b.fileId));
}

export async function publicLeaderPhotos(database, leaderId, offset = 0) {
  if (!uuid.test(leaderId) || !Number.isInteger(offset) || offset < 0 || offset > 5000) throw new Error('invalid_public_headshot_query');
  const leader = await database.prepare('SELECT * FROM headshot_leaders WHERE wix_item_id=?').bind(leaderId).first();
  if (!leader || leader.active !== 1) throw new Error('public_leader_not_found');
  const sources = await leaderSourcePlan(database, leaderId);
  const approvals = (await database.prepare('SELECT * FROM headshot_public_photos WHERE wix_item_id=?').bind(leaderId).all()).results || [];
  const media = (await database.prepare(`SELECT m.* FROM headshot_public_media m JOIN headshot_public_photos p ON p.file_id=m.file_id WHERE p.wix_item_id=?`).bind(leaderId).all()).results || [];
  const photos = approvedPublicInventory({ leader, sources, approvals, media });
  const approvedIds=new Map(approvals.filter(a=>a.approval_state==='APPROVED').map(a=>[a.file_id,a.approved_at]));
  const currentIds=new Set(JSON.parse(leader.photo_inventory_json||'[]').filter(p=>approvedIds.has(p.fileId)&&Date.parse(p.modifiedTime)<=Date.parse(approvedIds.get(p.fileId))).map(p=>p.fileId));
  return { leaderId, photos: photos.slice(offset,offset+24), total: photos.length, approvedTotal:currentIds.size, pendingTotal:Math.max(0,currentIds.size-photos.length),nextOffset: offset+24 < photos.length ? offset+24 : null };
}

export async function publicLeaderImage(database, leaderId, fileId) {
  if (!uuid.test(leaderId) || !fileIdPattern.test(fileId)) throw new Error('invalid_public_image_identity');
  const leader = await database.prepare('SELECT * FROM headshot_leaders WHERE wix_item_id=?').bind(leaderId).first();
  const sources = await leaderSourcePlan(database, leaderId);
  const approvals = (await database.prepare('SELECT * FROM headshot_public_photos WHERE wix_item_id=? AND file_id=?').bind(leaderId,fileId).all()).results || [];
  const media = (await database.prepare('SELECT * FROM headshot_public_media WHERE file_id=?').bind(fileId).all()).results || [];
  const photo = approvedPublicInventory({leader,sources,approvals,media}).find(item=>item.fileId===fileId);
  if (!photo) throw new Error('public_image_not_found');
  return photo;
}

export async function publicPrimaryDirectory(database) {
  const rows=(await database.prepare(`SELECT l.wix_item_id,l.primary_drive_file_id,m.wix_file_url FROM headshot_leaders l,json_each(l.photo_inventory_json) photo JOIN headshot_public_photos p ON p.wix_item_id=l.wix_item_id AND p.file_id=l.primary_drive_file_id JOIN headshot_public_media m ON m.file_id=p.file_id JOIN headshot_public_checks c ON c.wix_item_id=l.wix_item_id WHERE l.active=1 AND l.mapping_status='VERIFIED' AND p.approval_state='APPROVED' AND m.media_state='READY' AND c.check_state='AVAILABLE' AND c.checked_at>datetime('now','-5 minutes') AND json_extract(photo.value,'$.fileId')=m.file_id AND json_extract(photo.value,'$.sourceVersion')=m.source_version AND json_extract(photo.value,'$.modifiedTime')<=p.approved_at LIMIT 1000`).all()).results||[];
  return rows.filter(row=>publicWixImageUrl(row.wix_file_url)).map(row=>({leaderId:row.wix_item_id,fileId:row.primary_drive_file_id,displayUrl:publicWixImageUrl(row.wix_file_url)}));
}

export async function confirmPublicMedia(database, receipt) {
  if (!fileIdPattern.test(String(receipt.fileId || '')) || !/^[a-f0-9]{64}$/.test(String(receipt.contentHash || '')) || !publicWixImageUrl(receipt.wixFileUrl)) throw new Error('invalid_public_media_receipt');
  if (!['image/png','image/jpeg'].includes(receipt.mimeType) || !Number.isInteger(receipt.byteLength) || receipt.byteLength < 1 || receipt.byteLength > MAX_PUBLIC_IMAGE_BYTES) throw new Error('invalid_public_media_size_or_type');
  const row = await database.prepare('SELECT * FROM headshot_public_media WHERE file_id=?').bind(receipt.fileId).first();
  if (!row || row.request_id !== receipt.requestId || row.source_version !== receipt.sourceVersion) throw new Error('public_media_receipt_not_reserved');
  if (row.media_state === 'READY') {
    if (row.wix_file_url !== receipt.wixFileUrl || row.content_hash !== receipt.contentHash) throw new Error('conflicting_public_media_receipt');
    return { changed: false };
  }
  await database.prepare(`UPDATE headshot_public_media SET media_state='READY',wix_file_url=?,content_hash=?,mime_type=?,byte_length=?,updated_at=CURRENT_TIMESTAMP WHERE file_id=? AND request_id=? AND source_version=?`).bind(receipt.wixFileUrl,receipt.contentHash,receipt.mimeType,receipt.byteLength,receipt.fileId,receipt.requestId,receipt.sourceVersion).run();
  return { changed: true };
}

export async function claimPublicMediaJob(database) {
  const candidates = (await database.prepare(`SELECT m.*,p.wix_item_id,p.approved_at,l.photo_inventory_json FROM headshot_public_media m JOIN headshot_public_photos p ON p.file_id=m.file_id JOIN headshot_leaders l ON l.wix_item_id=p.wix_item_id WHERE p.approval_state='APPROVED' AND l.active=1 AND l.mapping_status='VERIFIED' AND EXISTS(SELECT 1 FROM json_each(l.photo_inventory_json) photo WHERE json_extract(photo.value,'$.fileId')=m.file_id) AND (m.media_state='PENDING' OR (m.media_state='FAILED' AND m.failure_count<3 AND m.next_retry_at<=CURRENT_TIMESTAMP) OR (m.media_state='PROCESSING' AND m.updated_at<datetime('now','-10 minutes'))) ORDER BY m.failure_count,p.wix_item_id,m.file_id LIMIT 16`).all()).results || [];
  for (const row of candidates) {
    const photo = JSON.parse(row.photo_inventory_json||'[]').find(p=>p.fileId===row.file_id);
    if (!photo) continue;
    const sources = await leaderSourcePlan(database,row.wix_item_id);
    const source = sources.find(s=>s.verification_state==='VERIFIED' && ((photo.sources||[]).some(p=>p.folderId===s.folder_id) || photo.sourceFolderId===s.folder_id || photo.parentFolderId===s.folder_id));
    if (!source) continue;
    const requestId = crypto.randomUUID();
    const result = await database.prepare(`UPDATE headshot_public_media SET media_state='PROCESSING',request_id=?,updated_at=CURRENT_TIMESTAMP WHERE file_id=? AND (media_state='PENDING' OR (media_state='FAILED' AND failure_count<3 AND next_retry_at<=CURRENT_TIMESTAMP) OR (media_state='PROCESSING' AND updated_at<datetime('now','-10 minutes')))` ).bind(requestId,row.file_id).run();
    if (!(result.meta?.changes || result.changes)) continue;
    return { fileId:row.file_id,wixItemId:row.wix_item_id,sourceFolderId:source.folder_id,approvedAt:row.approved_at,requestId };
  }
  return null;
}

export async function setPublicMediaSourceVersion(database, job) {
  if (!/^[a-f0-9]{64}$/.test(String(job.sourceVersion||''))) throw new Error('invalid_public_source_version');
  const row=await database.prepare('SELECT * FROM headshot_public_media WHERE file_id=?').bind(job.fileId).first();
  if (!row || row.media_state!=='PROCESSING' || row.request_id!==job.requestId) throw new Error('public_media_job_not_reserved');
  await database.prepare(`UPDATE headshot_public_media SET source_version=?,updated_at=CURRENT_TIMESTAMP WHERE file_id=? AND request_id=?`).bind(job.sourceVersion,job.fileId,job.requestId).run();
  return {success:true};
}

export async function failPublicMediaJob(database,job) {
  if(job.checkpoint===true) {
    await database.prepare(`UPDATE headshot_public_media SET media_state='PENDING',updated_at=CURRENT_TIMESTAMP WHERE file_id=? AND request_id=? AND media_state='PROCESSING'`).bind(job.fileId,job.requestId).run();
    return {success:true};
  }
  await database.prepare(`UPDATE headshot_public_media SET media_state='FAILED',failure_count=failure_count+1,next_retry_at=datetime('now','+15 minutes'),updated_at=CURRENT_TIMESTAMP WHERE file_id=? AND request_id=? AND media_state='PROCESSING'`).bind(job.fileId,job.requestId).run();
  return {success:true};
}

export async function approvePublicPhoto(database,actor,leaderId,fileId,approved) {
  if(actor.role!=='PHOTO_ADMIN') throw new Error('public_photo_approval_administrator_required');
  if(!uuid.test(leaderId)||!fileIdPattern.test(fileId)||typeof approved!=='boolean') throw new Error('invalid_public_approval');
  const leader=await database.prepare('SELECT * FROM headshot_leaders WHERE wix_item_id=?').bind(leaderId).first();
  if(!leader || leader.active!==1 || leader.mapping_status!=='VERIFIED') throw new Error('public_leader_not_available');
  const photo=JSON.parse(leader.photo_inventory_json||'[]').find(p=>p.fileId===fileId);
  if(!photo?.sourceVersion || !photo.modifiedTime) throw new Error('fresh_public_source_verification_required');
  const previous=await database.prepare('SELECT * FROM headshot_public_photos WHERE wix_item_id=? AND file_id=?').bind(leaderId,fileId).first();
  const unchanged=previous?.approval_state===(approved?'APPROVED':'REVOKED')&&Date.parse(photo.modifiedTime)<=Date.parse(previous.approved_at);
  if(unchanged) return {changed:false};
  await database.prepare(`INSERT INTO headshot_public_photos(wix_item_id,file_id,approval_state,approved_at) VALUES(?,?,?,?) ON CONFLICT(wix_item_id,file_id) DO UPDATE SET approval_state=excluded.approval_state,approved_at=excluded.approved_at`).bind(leaderId,fileId,approved?'APPROVED':'REVOKED',new Date().toISOString()).run();
  if(approved) await database.prepare(`INSERT INTO headshot_public_media(file_id) VALUES(?) ON CONFLICT(file_id) DO UPDATE SET media_state=CASE WHEN source_version=? AND media_state='READY' THEN media_state ELSE 'PENDING' END,failure_count=0,next_retry_at=NULL`).bind(fileId,photo.sourceVersion).run();
  return {changed:true};
}
