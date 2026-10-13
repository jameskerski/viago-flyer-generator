import { applyHeadshotMappingAudit } from './headshot-mapping.mjs';
import { leaderSourcePlan, reconcileSharedHeadshotSnapshot, assertSourcePhotoOperation } from './headshot-sources.mjs';

const identity = (value) => {
  const id = String(value || '').trim();
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('invalid_leader_identity');
  return id;
};
const driveId = (value) => {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{10,160}$/.test(id)) throw new Error('invalid_drive_identity');
  return id;
};
const imageUrl = (source) => {
  const media = String(source || '').match(/^wix:image:\/\/v1\/([^/]+)/)?.[1];
  return media ? `https://static.wixstatic.com/media/${media}` : '';
};
async function digest(input) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
  return [...new Uint8Array(bytes)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
}

export function createHeadshotManagement(database,env,registry) {
  const enabled = env.PHOTO_HEADSHOT_WRITES_ENABLED === 'true';
  const discoveryEnabled = env.PHOTO_HEADSHOT_DISCOVERY_ENABLED === 'true';
  const qualifiedLeaders = new Set(String(env.PHOTO_HEADSHOT_QUALIFIED_LEADER_IDS||'').split(',').map((id)=>id.trim()).filter(Boolean));
  const available = Boolean(env.PHOTO_EVENT_PROVISION_ENDPOINT && env.PHOTO_STUDIO_SYNC_SECRET);
  const isAdmin = (actor) => actor.role === 'PHOTO_ADMIN';
  async function allowed(actor,id,capability='HEADSHOT_VIEW') {
    if (isAdmin(actor)) return true;
    if (!(await registry.headshotCapabilities(actor)).includes(capability)) return false;
    const assignment=await database.prepare(`SELECT capabilities_json FROM headshot_leader_assignments WHERE user_id=? AND wix_item_id=? AND status='ACTIVE'`).bind(actor.id,id).first();
    if(!assignment||!JSON.parse(assignment.capabilities_json||'[]').includes(capability)) return false;
    if(capability==='HEADSHOT_UPLOAD'||capability==='HEADSHOT_MANAGE') {
      const grant=await database.prepare(`SELECT operation_state FROM headshot_drive_access_grants WHERE user_id=? AND wix_item_id=?`).bind(actor.id,id).first();
      return grant?.operation_state==='VERIFIED';
    }
    return true;
  }
  async function leader(actor,id,capability='HEADSHOT_VIEW') {
    const key=identity(id);
    if (!(await allowed(actor,key,capability))) throw new Error('leader_permission_required');
    const row=await database.prepare(`SELECT * FROM headshot_leaders WHERE wix_item_id=?`).bind(key).first();
    if(!row) throw new Error('leader_not_found');
    return row;
  }
  async function apps(action,id,values={},operationId=`headshot-${crypto.randomUUID()}`) {
    if(!available) throw new Error('headshot_integration_unavailable');
    const response=await fetch(env.PHOTO_EVENT_PROVISION_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:env.PHOTO_STUDIO_SYNC_SECRET,action,wixItemId:identity(id),operationId,...values})});
    const body=await response.json().catch(()=>({}));
    if(!response.ok || body.success!==true) throw new Error(body.error || 'headshot_integration_failed');
    return body;
  }
  function safePhotos(photos) {
    if(!Array.isArray(photos)||photos.length>10000) throw new Error('invalid_headshot_inventory');
    const ids=new Set();
    return photos.map((photo)=>{
      const sourceItemId=driveId(photo.sourceItemId||photo.fileId),fileId=driveId(photo.fileId);
      if(ids.has(fileId)||!['image/jpeg','image/png'].includes(photo.mimeType)) throw new Error('duplicate_or_invalid_headshot_source');ids.add(fileId);
      return {fileId,sourceItemId,parentFolderId:photo.parentFolderId?driveId(photo.parentFolderId):'',filename:String(photo.filename||'').slice(0,300),mimeType:photo.mimeType,shortcut:photo.shortcut===true,currentPrimary:photo.currentPrimary===true,thumbnailUrl:`https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w480`};
    });
  }
  async function refresh(actor,id) {
    const previous=await leader(actor,id);
    const snapshot=await apps('HEADSHOT_DISCOVER',previous.wix_item_id);
    if(snapshot.wixItemId!==previous.wix_item_id) throw new Error('leader_identity_mismatch');
    if(snapshot.sourceContractVersion===3) {
      const outcome=await reconcileSharedHeadshotSnapshot(database,snapshot);
      return {...await leader(actor,id),photos:JSON.parse((await leader(actor,id)).photo_inventory_json),changed:outcome.changed,writesEnabled:enabled};
    }
    const mapping=await applyHeadshotMappingAudit(database,previous,snapshot);
    if(mapping.status!=='VERIFIED') return {...await leader(actor,id),photos:[],changed:mapping.changed,writesEnabled:false};
    const folder=driveId(snapshot.folderId);
    if(folder!==previous.candidate_drive_folder_id && folder!==previous.verified_drive_folder_id) throw new Error('leader_folder_changed_requires_review');
    const photos=safePhotos(snapshot.photos);
    const leaderName=String(snapshot.leaderName||previous.leader_name),active=typeof snapshot.active==='boolean'?snapshot.active:previous.active===1;
    const fingerprint=await digest({folder,photos,primaryImage:snapshot.primaryImage,primaryFileId:snapshot.primaryFileId||'',leaderName,active,imageReference:snapshot.imageReference||null});
    if(fingerprint===previous.source_fingerprint) return {...await leader(actor,id),photos,changed:false,writesEnabled:enabled};
    const reference=snapshot.imageReference;
    if(reference && (reference.fileId!==snapshot.primaryFileId || reference.sourceFolderId!==folder || !photos.some(photo=>photo.fileId===reference.fileId) || !/^https:\/\/drive\.google\.com\/thumbnail\?id=/.test(reference.displayUrl||''))) throw new Error('invalid_confirmed_image_reference');
    await database.prepare(`UPDATE headshot_leaders SET verified_drive_folder_id=?,mapping_state='VERIFIED',photo_count=?,photo_inventory_json=?,source_fingerprint=?,primary_image_source=?,primary_image_url=?,primary_drive_file_id=?,leader_name=?,active=?,source_updated_at=COALESCE(?,source_updated_at),sync_status='CONFIRMED',sync_error=NULL,indexed_at=CURRENT_TIMESTAMP WHERE wix_item_id=?`).bind(folder,photos.length,JSON.stringify(photos),fingerprint,String(snapshot.primaryImage||''),reference?.displayUrl||imageUrl(snapshot.primaryImage),snapshot.primaryFileId||null,leaderName,active?1:0,snapshot.sourceUpdatedAt||null,id).run();
    return {...await leader(actor,id),photos,changed:true,writesEnabled:enabled};
  }
  async function browse(actor,id,cursor='') {
    let row=await leader(actor,id);
    try {if(!cursor&&discoveryEnabled) row=await refresh(actor,id);} catch(error) {
      const mappingStatus=/identity|mapping_conflict|folder_changed/.test(String(error.message))?'AMBIGUOUS':'INACCESSIBLE';
      await database.prepare(`UPDATE headshot_leaders SET sync_status='FAILED',sync_error=?,mapping_status=?,mapping_state='CMS_REFERENCE_UNVERIFIED' WHERE wix_item_id=?`).bind(String(error.message).slice(0,300),mappingStatus,id).run();
      row={...row,sync_status:'FAILED',sync_error:error.message,mapping_status:mappingStatus,mapping_state:'CMS_REFERENCE_UNVERIFIED'};
    }
    const all=row.photos||JSON.parse(row.photo_inventory_json||'[]');
    const offset=Number(cursor||0);if(!Number.isInteger(offset)||offset<0) throw new Error('invalid_photo_cursor');
    const caps=await registry.headshotCapabilities(actor);
    const grant=isAdmin(actor)?{operation_state:'VERIFIED'}:await database.prepare(`SELECT operation_state FROM headshot_drive_access_grants WHERE user_id=? AND wix_item_id=?`).bind(actor.id,id).first();
    const canUpload=caps.includes('HEADSHOT_UPLOAD')&&(await allowed(actor,id,'HEADSHOT_UPLOAD'))&&grant?.operation_state==='VERIFIED'&&row.mapping_state==='VERIFIED';
    const mappingReady=row.mapping_status==='VERIFIED'&&row.mapping_state==='VERIFIED';
    const mayInitialize=row.mapping_status==='MISSING'&&!row.candidate_drive_folder_id;
    const history=(await database.prepare(`SELECT id,operation_type,operation_state,safe_error,updated_at FROM headshot_operations WHERE wix_item_id=? ORDER BY updated_at DESC LIMIT 10`).bind(id).all()).results||[];
    const managementEnabled=enabled&&discoveryEnabled&&qualifiedLeaders.has(id)&&(mappingReady||mayInitialize);
    const sourceMode=env.PHOTO_HEADSHOT_SHARED_SOURCES_ENABLED==='true';
    const collections=sourceMode?await leaderSourcePlan(database,id):[];
    const sourceViews=[];
    for(const source of collections) {
      const sourceGrant=isAdmin(actor)?{operation_state:'VERIFIED'}:await database.prepare('SELECT operation_state FROM headshot_source_access_grants WHERE user_id=? AND folder_id=?').bind(actor.id,source.folder_id).first();
      const upload=managementEnabled&&source.verification_state==='VERIFIED'&&sourceGrant?.operation_state==='VERIFIED'&&caps.includes('HEADSHOT_UPLOAD')&&Boolean(isAdmin(actor)||await allowed(actor,id,'HEADSHOT_VIEW'));
      sourceViews.push({folderId:source.folder_id,label:source.display_label,shared:source.shared,photoCount:JSON.parse(source.photo_inventory_json).length,canUpload:upload,uploadUrl:upload?`https://drive.google.com/drive/folders/${source.folder_id}`:''});
    }
    const view={...row,management_enabled:managementEnabled};
    const visibleRow=isAdmin(actor)?view:{...view,mapping_evidence_json:'{}'};
    return {leader:visibleRow,collections:sourceViews,photos:all.slice(offset,offset+48),total:all.length,nextCursor:offset+48<all.length?String(offset+48):'',discoveryEnabled,writesEnabled:managementEnabled,canManage:await allowed(actor,id,'HEADSHOT_MANAGE'),canUpload:canUpload&&mappingReady&&managementEnabled,uploadUrl:canUpload&&mappingReady&&managementEnabled?`https://drive.google.com/drive/folders/${row.verified_drive_folder_id}`:'',capabilities:caps,operationHistory:history};
  }
  async function perform(actor,id,type,input,key) {
    if(!enabled) throw new Error('headshot_writes_pending_controlled_qualification');
    if(!discoveryEnabled||!qualifiedLeaders.has(id)) throw new Error('leader_write_not_qualified');
    const row=await leader(actor,id,'HEADSHOT_MANAGE');
    if(type!=='CREATE_FOLDER'&&row.mapping_status!=='VERIFIED') throw new Error('leader_mapping_not_verified');
    if(type==='CREATE_FOLDER'&&row.mapping_status!=='VERIFIED'&&!(row.mapping_status==='MISSING'&&!row.candidate_drive_folder_id)) throw new Error('leader_mapping_requires_review');
    if(!['CREATE_FOLDER','SET_PRIMARY','REMOVE_PHOTO'].includes(type)) throw new Error('unsupported_headshot_operation');
    if(type==='CREATE_FOLDER'&&!isAdmin(actor)) throw new Error('administrator_required');
    if(type!=='CREATE_FOLDER'&&row.mapping_state!=='VERIFIED') throw new Error('leader_mapping_not_verified');
    if(input.confirmed!==true) throw new Error('explicit_confirmation_required');
    const inventory=JSON.parse(row.photo_inventory_json||'[]');
    const selected=inventory.find(p=>p.fileId===input.fileId&&p.sourceItemId===(input.sourceItemId||input.fileId));
    if(type!=='CREATE_FOLDER'&&env.PHOTO_HEADSHOT_SHARED_SOURCES_ENABLED==='true') {
      const plan=await leaderSourcePlan(database,id);
      if(!selected||!plan.some(s=>s.folder_id===selected.sourceFolderId&&s.verification_state==='VERIFIED')) throw new Error('headshot_photo_outside_leader_scope');
      const linked=(await database.prepare('SELECT wix_item_id,primary_drive_file_id FROM headshot_leaders WHERE primary_drive_file_id=?').bind(input.fileId).all()).results;
      assertSourcePhotoOperation({actorRole:actor.role,operation:type,photo:selected,linkedPrimaries:linked.map(p=>({leaderId:p.wix_item_id,fileId:p.primary_drive_file_id}))});
    }
    if(!/^[A-Za-z0-9_-]{16,128}$/.test(String(key||''))) throw new Error('idempotency_key_required');
    const values=type==='CREATE_FOLDER'?{}:{fileId:driveId(input.fileId),sourceItemId:driveId(input.sourceItemId||input.fileId),sourceFolderId:selected?.sourceFolderId||'',actorRole:actor.role,expectedPrimaryImage:String(row.primary_image_source||'')};
    const normalized={leaderId:id,type,values},requestHash=await digest(normalized);
    let operation=await database.prepare(`SELECT * FROM headshot_operations WHERE idempotency_key=?`).bind(key).first();
    if(operation && (operation.requested_by_user_id!==actor.id||operation.wix_item_id!==id||operation.operation_type!==type||JSON.parse(operation.request_json).fileId!==values.fileId||JSON.parse(operation.request_json).sourceItemId!==values.sourceItemId)) throw new Error('idempotency_key_conflict');
    if(operation?.operation_state==='CONFIRMED') return {operation,idempotent:true};
    if(!operation) {
      const operationId=`headshot-${crypto.randomUUID()}`;
      await database.prepare(`INSERT INTO headshot_operations(id,idempotency_key,request_hash,wix_item_id,operation_type,requested_by_user_id,requested_by_email,request_json,operation_state) VALUES(?,?,?,?,?,?,?,?,'VALIDATED')`).bind(operationId,key,requestHash,id,type,actor.id,actor.email,JSON.stringify(values)).run();
      operation=await database.prepare(`SELECT * FROM headshot_operations WHERE id=?`).bind(operationId).first();
    }
    try {
      const result=await apps(`HEADSHOT_${type}`,id,JSON.parse(operation.request_json),operation.id);
      if(type==='CREATE_FOLDER') await database.prepare(`UPDATE headshot_leaders SET candidate_drive_folder_id=?,verified_drive_folder_id=?,mapping_state='VERIFIED' WHERE wix_item_id=?`).bind(driveId(result.folderId),driveId(result.folderId),id).run();
      const refreshed=await refresh(actor,id);
      const requested=JSON.parse(operation.request_json);
      if(type==='SET_PRIMARY'&&refreshed.primary_drive_file_id!==requested.fileId) throw new Error('wix_primary_confirmation_failed');
      if(type==='REMOVE_PHOTO'&&refreshed.photos.some((photo)=>photo.sourceItemId===requested.sourceItemId)) throw new Error('headshot_removal_not_reconciled');
      await database.prepare(`UPDATE headshot_operations SET operation_state='CONFIRMED',result_json=?,safe_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(JSON.stringify(result),operation.id).run();
      await registry.audit(actor,`headshot.${type.toLowerCase()}`,'leader',id,'SUCCEEDED',{operationId:operation.id,recoverable:true});
      return {operation:await database.prepare(`SELECT * FROM headshot_operations WHERE id=?`).bind(operation.id).first(),result};
    } catch(error) {
      await database.prepare(`UPDATE headshot_operations SET operation_state='FAILED_NEEDS_ATTENTION',safe_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(String(error.message).slice(0,300),operation.id).run();
      await registry.audit(actor,`headshot.${type.toLowerCase()}`,'leader',id,'FAILED',{operationId:operation.id});
      throw error;
    }
  }
  async function directory(actor) {
    const rows=await registry.headshotLeaders();
    const visible=[];for(const row of rows) if(await allowed(actor,row.wix_item_id)) {
      const view={...row,management_enabled:enabled&&discoveryEnabled&&qualifiedLeaders.has(row.wix_item_id)&&row.mapping_status==='VERIFIED'};
      visible.push(isAdmin(actor)?view:{...view,mapping_evidence_json:'{}'});
    }
    return visible;
  }
  async function setAccess(actor,id,userId,preset) {
    if(!enabled&&preset!=='REVOKE') throw new Error('headshot_writes_pending_controlled_qualification');
    if(preset!=='REVOKE'&&(!discoveryEnabled||!qualifiedLeaders.has(id))) throw new Error('leader_write_not_qualified');
    if(!isAdmin(actor)) throw new Error('administrator_required');
    const row=await leader(actor,id);
    if(row.mapping_state!=='VERIFIED'||row.mapping_status!=='VERIFIED') throw new Error('leader_mapping_not_verified');
    const target=await database.prepare(`SELECT u.status,i.verified_email AS email,g.status AS grant_status FROM platform_users u JOIN identity_bindings i ON i.user_id=u.id AND i.status='ACTIVE' JOIN module_grants g ON g.user_id=u.id AND g.module_key='PHOTO_STUDIO' AND g.role_key='PHOTOGRAPHER' WHERE u.id=?`).bind(userId).first();
    if(!target||(preset!=='REVOKE'&&(target.status!=='ACTIVE'||target.grant_status!=='ACTIVE'))) throw new Error('active_photographer_required');
    const profiles={VIEW:['HEADSHOT_VIEW'],UPLOAD:['HEADSHOT_VIEW','HEADSHOT_UPLOAD'],MANAGE:['HEADSHOT_VIEW','HEADSHOT_UPLOAD','HEADSHOT_MANAGE'],REVOKE:[]};
    const caps=profiles[preset];if(!caps) throw new Error('invalid_headshot_access_preset');
    await database.prepare(`INSERT INTO headshot_leader_assignments(user_id,wix_item_id,status,capabilities_json,updated_by_user_id) VALUES(?,?,?,?,?) ON CONFLICT(user_id,wix_item_id) DO UPDATE SET status=excluded.status,capabilities_json=excluded.capabilities_json,updated_by_user_id=excluded.updated_by_user_id,updated_at=CURRENT_TIMESTAMP`).bind(userId,id,caps.length?'ACTIVE':'REVOKED',JSON.stringify(caps),actor.id).run();
    // Aggregate capabilities admit the module; every leader request rechecks its own scope.
    const assignments=await database.prepare(`SELECT capabilities_json FROM headshot_leader_assignments WHERE user_id=? AND status='ACTIVE'`).bind(userId).all();
    const aggregate=new Set((assignments.results||[]).flatMap((a)=>JSON.parse(a.capabilities_json)));
    for(const cap of ['HEADSHOT_VIEW','HEADSHOT_UPLOAD','HEADSHOT_MANAGE']) await database.prepare(`INSERT INTO headshot_capability_grants(user_id,capability,status,granted_by_user_id) VALUES(?,?,?,?) ON CONFLICT(user_id,capability) DO UPDATE SET status=excluded.status,granted_by_user_id=excluded.granted_by_user_id`).bind(userId,cap,aggregate.has(cap)?'ACTIVE':'REVOKED',actor.id).run();
    if(env.PHOTO_HEADSHOT_SHARED_SOURCES_ENABLED==='true') {
      const plan=await leaderSourcePlan(database,id);
      if(!plan.length||plan.some(s=>s.verification_state!=='VERIFIED')) throw new Error('leader_sources_not_verified');
      const outcomes=[];
      for(const source of plan) {
        const old=await database.prepare('SELECT * FROM headshot_source_access_grants WHERE user_id=? AND folder_id=?').bind(userId,source.folder_id).first();
        const others=(await database.prepare(`SELECT a.capabilities_json FROM headshot_leader_assignments a JOIN headshot_leader_sources r ON r.wix_item_id=a.wix_item_id WHERE a.user_id=? AND a.status='ACTIVE' AND r.status='ACTIVE' AND r.folder_id=?`).bind(userId,source.folder_id).all()).results;
        const required=new Set(others.flatMap(a=>JSON.parse(a.capabilities_json)));
        let state='REVOKED',result=null;
        try {
          if(required.size) {
            const role=required.has('HEADSHOT_UPLOAD')?'writer':'reader';
            if(old?.operation_state==='VERIFIED'&&old.access_role===role) {state='VERIFIED';result={permissionId:old.permission_id,role,studioManaged:old.grant_origin==='STUDIO_MANAGED'};}
            else {
              if(old?.grant_origin==='STUDIO_MANAGED'&&old.operation_state==='VERIFIED') await apps('HEADSHOT_REVOKE_ACCESS',id,{sourceFolderId:source.folder_id,email:target.email,permissionId:old.permission_id,studioManaged:true});
              result=await apps('HEADSHOT_GRANT_ACCESS',id,{sourceFolderId:source.folder_id,email:target.email,accessRole:role});
              state=result.verified?'VERIFIED':'FAILED_NEEDS_ATTENTION';
            }
          } else if(old&&old.operation_state==='VERIFIED') {
            if(old.grant_origin!=='STUDIO_MANAGED') {state='EXTERNAL_ACCESS_REMAINS';result={permissionId:old.permission_id,role:old.access_role};}
            else {
              result=await apps('HEADSHOT_REVOKE_ACCESS',id,{sourceFolderId:source.folder_id,email:target.email,permissionId:old.permission_id,studioManaged:true});
              state=result.effectiveAccess==='EXTERNAL_ACCESS_UNVERIFIED'?'EXTERNAL_ACCESS_UNVERIFIED':result.remainingAccess?'EXTERNAL_ACCESS_REMAINS':'REVOKED';
            }
          } else {state=old?.operation_state||'REVOKED';}
          await database.prepare(`INSERT INTO headshot_source_access_grants(user_id,folder_id,permission_id,access_role,verified_email,grant_origin,operation_state) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,folder_id) DO UPDATE SET permission_id=excluded.permission_id,access_role=excluded.access_role,grant_origin=excluded.grant_origin,operation_state=excluded.operation_state,safe_error=NULL`).bind(userId,source.folder_id,result?.permissionId||old?.permission_id||null,result?.role||old?.access_role||null,target.email,result?.studioManaged?'STUDIO_MANAGED':result?.inherited?'INHERITED':old?.grant_origin||'PRE_EXISTING',state).run();
          outcomes.push({folderId:source.folder_id,state});
        } catch(error) {
          if(old) await database.prepare("UPDATE headshot_source_access_grants SET operation_state='FAILED_NEEDS_ATTENTION',safe_error=? WHERE user_id=? AND folder_id=?").bind(String(error.message).slice(0,200),userId,source.folder_id).run();
          await registry.audit(actor,'headshot.access','leader',id,'FAILED',{userId,preset,folderId:source.folder_id,error:String(error.message).slice(0,200)});
          throw error;
        }
      }
      const state=preset==='REVOKE'?(outcomes.some(o=>o.state.startsWith('EXTERNAL'))?'EXTERNAL_ACCESS_REMAINS':'REVOKED'):(outcomes.every(o=>o.state==='VERIFIED')?'VERIFIED':'FAILED_NEEDS_ATTENTION');
      // Legacy grant is now an aggregate compatibility cache only.
      await database.prepare(`INSERT INTO headshot_drive_access_grants(user_id,wix_item_id,drive_folder_id,access_role,verified_email,grant_origin,operation_state) VALUES(?,?,?,?,?,'STUDIO_MANAGED',?) ON CONFLICT(user_id,wix_item_id) DO UPDATE SET operation_state=excluded.operation_state`).bind(userId,id,plan[0].folder_id,caps.includes('HEADSHOT_UPLOAD')?'writer':'reader',target.email,state).run();
      await registry.audit(actor,'headshot.access','leader',id,'SUCCEEDED',{userId,preset,state,sources:outcomes});
      return {userId,leaderId:id,state,sources:outcomes};
    }
    const old=await database.prepare(`SELECT * FROM headshot_drive_access_grants WHERE user_id=? AND wix_item_id=?`).bind(userId,id).first();
    let result=null,state='REVOKED';
    try {
      if(caps.length) {
        const role=caps.includes('HEADSHOT_UPLOAD')?'writer':'reader';
        if(old?.grant_origin==='STUDIO_MANAGED'&&old.operation_state==='VERIFIED'&&old.access_role===role) {state='VERIFIED';result={permissionId:old.permission_id,role,studioManaged:true,verified:true};}
        else {
          if(old?.grant_origin==='STUDIO_MANAGED'&&old.operation_state==='VERIFIED') await apps('HEADSHOT_REVOKE_ACCESS',id,{email:target.email,permissionId:old.permission_id,studioManaged:true});
          result=await apps('HEADSHOT_GRANT_ACCESS',id,{email:target.email,accessRole:role});state=result.verified?'VERIFIED':'FAILED_NEEDS_ATTENTION';
        }
      } else if(old && old.operation_state!=='REVOKED') {
        if(old.grant_origin!=='STUDIO_MANAGED') {state='EXTERNAL_ACCESS_REMAINS';result={...old,permissionId:old.permission_id};}
        else {result=await apps('HEADSHOT_REVOKE_ACCESS',id,{email:target.email,permissionId:old.permission_id,studioManaged:true});state=result.effectiveAccess==='EXTERNAL_ACCESS_UNVERIFIED'?'EXTERNAL_ACCESS_UNVERIFIED':result.remainingAccess?'EXTERNAL_ACCESS_REMAINS':'REVOKED';}
      }
      if(result) await database.prepare(`INSERT INTO headshot_drive_access_grants(user_id,wix_item_id,drive_folder_id,permission_id,access_role,verified_email,grant_origin,operation_state) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,wix_item_id) DO UPDATE SET permission_id=excluded.permission_id,access_role=excluded.access_role,grant_origin=excluded.grant_origin,operation_state=excluded.operation_state,safe_error=NULL,updated_at=CURRENT_TIMESTAMP`).bind(userId,id,row.verified_drive_folder_id,result.permissionId||old?.permission_id||null,result.role||old?.access_role||null,target.email,result.studioManaged?'STUDIO_MANAGED':result.inherited?'INHERITED':old?.grant_origin||'PRE_EXISTING',state).run();
      await registry.audit(actor,'headshot.access','leader',id,'SUCCEEDED',{userId,preset,state});
      return {userId,leaderId:id,state};
    } catch(error) {
      await registry.audit(actor,'headshot.access','leader',id,'FAILED',{userId,preset,error:String(error.message).slice(0,200)});
      if(old) await database.prepare(`UPDATE headshot_drive_access_grants SET operation_state='FAILED_NEEDS_ATTENTION',safe_error=? WHERE user_id=? AND wix_item_id=?`).bind(error.message,userId,id).run();
      throw error;
    }
  }
  return {enabled,available,allowed,leader,directory,browse,refresh,perform,apps,setAccess};
}
