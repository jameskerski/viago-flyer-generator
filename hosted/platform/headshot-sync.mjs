import { applyHeadshotMappingAudit } from './headshot-mapping.mjs';

export async function reconcileHeadshotSnapshot(database,payload) {
  if(payload.kind!=='headshots'||!Array.isArray(payload.leaders)||payload.leaders.length!==1) throw new Error('bounded_headshot_snapshot_required');
  const input=payload.leaders[0];
  const row=await database.prepare(`SELECT * FROM headshot_leaders WHERE wix_item_id=?`).bind(input.wixItemId).first();
  if(!row) throw new Error('authoritative_leader_not_indexed');
  if(!input.mappingStatus && input.folderId!==row.candidate_drive_folder_id && input.folderId!==row.verified_drive_folder_id) throw new Error('leader_folder_mapping_conflict');
  const mapping=await applyHeadshotMappingAudit(database,row,input);
  if(mapping.status!=='VERIFIED') return {changed:mapping.changed,leaderId:row.wix_item_id,mappingStatus:mapping.status};
  if(input.folderId!==row.candidate_drive_folder_id && input.folderId!==row.verified_drive_folder_id) throw new Error('leader_folder_mapping_conflict');
  if(!Array.isArray(input.photos)||input.photos.length>5000) throw new Error('invalid_headshot_inventory');
  const seen=new Set();
  const photos=input.photos.map((photo)=>{
    if(!/^[A-Za-z0-9_-]{10,160}$/.test(photo.fileId)||!/^[A-Za-z0-9_-]{10,160}$/.test(photo.sourceItemId)||seen.has(photo.fileId)||!['image/jpeg','image/png'].includes(photo.mimeType)) throw new Error('invalid_headshot_photo');
    seen.add(photo.fileId);
    if(photo.parentFolderId&&!/^[A-Za-z0-9_-]{10,160}$/.test(photo.parentFolderId)) throw new Error('invalid_headshot_photo_parent');
    return {fileId:photo.fileId,sourceItemId:photo.sourceItemId,parentFolderId:photo.parentFolderId||'',filename:String(photo.filename||'').slice(0,300),mimeType:photo.mimeType,shortcut:photo.shortcut===true,currentPrimary:photo.fileId===input.primaryFileId,thumbnailUrl:`https://drive.google.com/thumbnail?id=${photo.fileId}&sz=w480`};
  });
  const reference=input.imageReference||null;
  if(reference && (reference.fileId!==input.primaryFileId || reference.sourceFolderId!==input.folderId || !photos.some(photo=>photo.fileId===reference.fileId) || !/^https:\/\/drive\.google\.com\/thumbnail\?id=/.test(reference.displayUrl||''))) throw new Error('invalid_confirmed_image_reference');
  const normalized={folder:input.folderId,photos,primaryImage:String(input.primaryImage||''),primaryFileId:String(input.primaryFileId||''),leaderName:String(input.leaderName||row.leader_name),active:typeof input.active==='boolean'?input.active:row.active===1,imageReference:reference};
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(normalized)));
  const fingerprint=[...new Uint8Array(bytes)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
  if(row.source_fingerprint===fingerprint&&row.sync_status==='CONFIRMED') return {changed:false,leaderId:row.wix_item_id,photoCount:photos.length,fingerprint};
  const media=normalized.primaryImage.match(/^wix:image:\/\/v1\/([^/]+)/)?.[1];
  await database.prepare(`UPDATE headshot_leaders SET verified_drive_folder_id=?,mapping_state='VERIFIED',photo_count=?,photo_inventory_json=?,source_fingerprint=?,primary_image_source=?,primary_image_url=?,primary_drive_file_id=?,leader_name=?,active=?,source_updated_at=COALESCE(?,source_updated_at),sync_status='CONFIRMED',sync_error=NULL,indexed_at=CURRENT_TIMESTAMP WHERE wix_item_id=?`).bind(input.folderId,photos.length,JSON.stringify(photos),fingerprint,normalized.primaryImage,reference?.displayUrl||(media?`https://static.wixstatic.com/media/${media}`:''),normalized.primaryFileId||null,normalized.leaderName,normalized.active?1:0,input.sourceUpdatedAt||null,row.wix_item_id).run();
  return {changed:true,leaderId:row.wix_item_id,photoCount:photos.length,fingerprint};
}
