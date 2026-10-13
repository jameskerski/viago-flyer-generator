import { test,expect } from '@playwright/test';
import { readFileSync,readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { createHeadshotManagement } from '../../hosted/platform/headshot-management.mjs';
import { createPhotoRegistry } from '../../hosted/platform/photo-registry.mjs';
import { reconcileHeadshotSnapshot } from '../../hosted/platform/headshot-sync.mjs';

const leaderId='e5f7b56a-2b8f-4941-a563-98b7ec81aaeb';
const folderId='18ooBxoL8HGXJgVU5c2oZTxD20aIWzpvN';
function setup() {
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync('migrations').filter((file)=>file.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${file}`,'utf8'));
  db.exec(`INSERT INTO platform_users(id,display_name,status) VALUES('owner','Owner','ACTIVE'),('photographer','Photographer','ACTIVE');`);
  const adapter={prepare(sql){let params=[];return {bind(...args){params=args;return this;},async first(){return db.prepare(sql).get(...params)||null;},async all(){return {results:db.prepare(sql).all(...params)};},async run(){return db.prepare(sql).run(...params);}};}};
  const registry=createPhotoRegistry(adapter);
  return {db,adapter,registry};
}
const snapshot=()=>({kind:'headshots',leaders:[{wixItemId:leaderId,folderId,primaryImage:'wix:image://v1/fixture.png/image.png#originWidth=20&originHeight=30',photos:[{fileId:'canonical-file-0001',sourceItemId:'canonical-file-0001',filename:'one.png',mimeType:'image/png',currentPrimary:false}]}]});

test('headshot snapshots are idempotent and conflicting identities preserve previous state',async()=>{
  const {db,adapter}=setup();
  expect((await reconcileHeadshotSnapshot(adapter,snapshot())).changed).toBe(true);
  const before=db.prepare('SELECT * FROM headshot_leaders WHERE wix_item_id=?').get(leaderId);
  expect((await reconcileHeadshotSnapshot(adapter,snapshot())).changed).toBe(false);
  const conflicting=snapshot();conflicting.leaders[0].folderId='another-folder-001';
  await expect(reconcileHeadshotSnapshot(adapter,conflicting)).rejects.toThrow('mapping_conflict');
  expect(db.prepare('SELECT * FROM headshot_leaders WHERE wix_item_id=?').get(leaderId)).toEqual(before);
  const duplicate=snapshot();duplicate.leaders[0].photos.push(duplicate.leaders[0].photos[0]);
  await expect(reconcileHeadshotSnapshot(adapter,duplicate)).rejects.toThrow('invalid_headshot_photo');
  db.close();
});

test('headshot writes fail closed and capabilities need a leader assignment',async()=>{
  const {db,adapter,registry}=setup();
  const manager=createHeadshotManagement(adapter,{},registry);
  db.exec(`INSERT INTO headshot_capability_grants(user_id,capability,status,granted_by_user_id) VALUES('photographer','HEADSHOT_VIEW','ACTIVE','owner');`);
  expect(await manager.directory({id:'photographer',role:'PHOTOGRAPHER'})).toEqual([]);
  db.prepare(`INSERT INTO headshot_leader_assignments(user_id,wix_item_id,status,updated_by_user_id) VALUES(?,?,'ACTIVE','owner')`).run('photographer',leaderId);
  expect(await manager.directory({id:'photographer',role:'PHOTOGRAPHER'})).toHaveLength(1);
  expect(await manager.allowed({id:'photographer',role:'PHOTOGRAPHER'},leaderId,'HEADSHOT_MANAGE')).toBe(false);
  await expect(manager.perform({id:'owner',role:'PHOTO_ADMIN'},leaderId,'SET_PRIMARY',{},'controlled-operation-key')).rejects.toThrow('pending_controlled_qualification');
  db.close();
});

test('governed operations replay durably without repeating a Drive/Wix write',async()=>{
  const {db,adapter,registry}=setup();await reconcileHeadshotSnapshot(adapter,snapshot());
  const prior=globalThis.fetch;let writes=0;
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);if(body.action==='HEADSHOT_SET_PRIMARY'){writes++;return Response.json({success:true,wixItemId:leaderId,confirmed:true});}const current=snapshot().leaders[0];if(writes){current.primaryFileId='canonical-file-0001';current.photos[0].currentPrimary=true;}return Response.json({success:true,...current});};
  const manager=createHeadshotManagement(adapter,{PHOTO_HEADSHOT_WRITES_ENABLED:'true',PHOTO_HEADSHOT_DISCOVERY_ENABLED:'true',PHOTO_HEADSHOT_QUALIFIED_LEADER_IDS:leaderId,PHOTO_EVENT_PROVISION_ENDPOINT:'https://qualified.example',PHOTO_STUDIO_SYNC_SECRET:'fixture'},registry);
  const actor={id:'owner',role:'PHOTO_ADMIN',email:'owner@example.com'};
  try {
    const input={fileId:'canonical-file-0001',sourceItemId:'canonical-file-0001',confirmed:true};
    expect((await manager.perform(actor,leaderId,'SET_PRIMARY',input,'controlled-operation-key')).operation.operation_state).toBe('CONFIRMED');
    expect((await manager.perform(actor,leaderId,'SET_PRIMARY',input,'controlled-operation-key')).idempotent).toBe(true);
    expect(writes).toBe(1);
    await expect(manager.perform(actor,leaderId,'SET_PRIMARY',{...input,fileId:'different-file-0001'},'controlled-operation-key')).rejects.toThrow('idempotency_key_conflict');
  } finally {globalThis.fetch=prior;db.close();}
});

function scriptFixture() {
  const properties=new Map(),operations=new Map();
  const file=(id,name,shortcut='')=>({getId:()=>id,getName:()=>name,getMimeType:()=>shortcut?'application/vnd.google-apps.shortcut':'image/png',getTargetId:()=>shortcut,getTargetMimeType:()=>shortcut?'image/png':null,isTrashed:()=>trashed.has(id),getParents:()=>iterator([folder]),setTrashed:(value)=>{if(value)trashed.add(id);},getBlob:()=>({getBytes:()=>[1,2,3]})});
  const iterator=(rows)=>{let i=0;return {hasNext:()=>i<rows.length,next:()=>rows[i++]};};
  const trashed=new Set();const files=[file('canonical-file-0001','one.png'),file('canonical-file-0002','two.png'),file('shortcut-source-0001','shortcut.png','canonical-file-0002')];
  const root={getId:()=> '1HJl9ujtRr0_wF09g2BNsGWvkTf7z3ASh'};
  const folder={getId:()=>folderId,getName:()=> 'Leader',isTrashed:()=>false,getParents:()=>iterator([root]),getFiles:()=>iterator(files.filter((f)=>!f.isTrashed())),getFolders:()=>iterator([])};
  const row={wixItemId:leaderId,leaderName:'Controlled Leader',downloadUrl:`https://drive.google.com/drive/folders/${folderId}`,primaryImage:'wix:image://v1/old.png/old.png#originWidth=20&originHeight=30'};
  let uploads=0;
  const sandbox={Date,JSON,Object,String,Number,encodeURIComponent,DriveApp:{getFolderById:()=>folder,getFileById:(id)=>files.find((f)=>f.getId()===id)},WIX_BASE_URL:'https://qualified.example',photoAutomationSecret_:()=> 'fixture',PropertiesService:{getScriptProperties:()=>({getProperty:(key)=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value),deleteProperty:(key)=>properties.delete(key)})},photoEventStoredOperation_:(key)=>operations.get(key)||null,photoEventStoreOperation_:(key,value)=>operations.set(key,structuredClone(value)),driveFolderId_:(url)=>url.match(/\/folders\/([^?]+)/)?.[1]||'',isReservedName_:(name)=>name.startsWith('_'),supportedPhotoEvidence_:(f)=>({id:f.getTargetId()||f.getId(),sourceItemId:f.getId(),name:f.getName(),mimeType:'image/png',shortcut:!!f.getTargetId()}),parseJsonResponse_:(response)=>JSON.parse(response.getContentText()),UrlFetchApp:{fetch:(url,options)=>{
    let result;if(url.startsWith('https://upload.wixmp.com')){uploads++;result=[{file_name:'new.png',original_file_name:'one.png',width:20,height:30}];}
    else {const body=JSON.parse(options.payload);if(body.action==='READ')result={success:true,leaders:[row]};if(body.action==='CONFIRM_PRIMARY'){row.imageReference={...body.imageReference,displayUrl:`https://drive.google.com/thumbnail?id=${body.fileId}&sz=w1600`,sourceFingerprint:`${folderId}:${body.fileId}:image/png`};result={success:true};}}
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(result)};
  }}};
  vm.createContext(sandbox);vm.runInContext(readFileSync('../my-site-1/automation/headshot-management.gs','utf8'),sandbox);
  return {sandbox,row,properties,operations,trashed,get uploads(){return uploads;}};
}

test('Apps Script protects legacy/current primary images, scoped source identity and shortcuts',()=>{
  const f=scriptFixture();
  expect(()=>f.sandbox.removeHeadshotPhoto_({fileId:'canonical-file-0002',sourceItemId:'canonical-file-0002',operationId:'test'},f.row,{getId:()=>folderId})).toThrow('primary_source_unqualified');
  const discovered=f.sandbox.discoverHeadshot_(leaderId);expect(discovered.photos).toHaveLength(2);
  const body={wixItemId:leaderId,operationId:'headshot-00000000-0000-4000-8000-000000000001',fileId:'canonical-file-0001',sourceItemId:'canonical-file-0001',expectedPrimaryImage:f.row.primaryImage};
  f.properties.set('PHOTO_HEADSHOT_WRITES_ENABLED','true');f.properties.set('PHOTO_HEADSHOT_QUALIFIED_LEADER_IDS',leaderId);
  const selected=f.sandbox.routeHeadshotManagement_({...body,action:'HEADSHOT_SET_PRIMARY'});
  expect(selected.confirmed).toBe(true);expect(f.row.primaryImage).toContain('old.png');expect(f.row.imageReference.fileId).toBe(body.fileId);expect(selected.previousImage).toContain('old.png');
  expect(f.sandbox.routeHeadshotManagement_({...body,action:'HEADSHOT_SET_PRIMARY'}).confirmed).toBe(true);expect(f.uploads).toBe(0);
  expect(()=>f.sandbox.routeHeadshotManagement_({...body,action:'HEADSHOT_REMOVE_PHOTO',operationId:'headshot-00000000-0000-4000-8000-000000000002'})).toThrow('primary_removal_requires_replacement');
  const removed=f.sandbox.routeHeadshotManagement_({...body,action:'HEADSHOT_REMOVE_PHOTO',fileId:'canonical-file-0002',sourceItemId:'canonical-file-0002',operationId:'headshot-00000000-0000-4000-8000-000000000003'});
  expect(removed.trashed).toBe(true);expect(f.trashed.has('canonical-file-0002')).toBe(true);expect(f.trashed.has('canonical-file-0001')).toBe(false);
});

test('Apps Script keeps Janie ambiguity blocked and denies unqualified writes',()=>{
  const f=scriptFixture();
  f.row.wixItemId='02a9ab6c-42a6-4568-8b14-f46e0ca08dc2';
  expect(()=>f.sandbox.headshotLeader_(f.row.wixItemId)).toThrow('leader_folder_ownership_ambiguous');
  f.row.wixItemId=leaderId;
  expect(()=>f.sandbox.routeHeadshotManagement_({wixItemId:leaderId,operationId:'headshot-00000000-0000-4000-8000-000000000001',action:'HEADSHOT_CREATE_FOLDER'})).toThrow('leader_write_not_qualified');
});

test('Apps Script grants only the leader folder and preserves inherited access on revocation',()=>{
  const f=scriptFixture();const permissions=[];let calls=0;
  f.sandbox.normalizedGoogleAccountEmail_=(email)=>email.toLowerCase();
  f.sandbox.drivePermissionInventory_=(id)=>{expect(id).toBe(folderId);return {folderId:id,canShare:true,permissions:[...permissions]};};
  f.sandbox.driveApi_=(path,method,input)=>{
    expect(path).toContain(`files/${folderId}/permissions`);
    if(method==='post'){calls++;permissions.push({permissionId:'permission-0001',email:input.emailAddress,role:'writer',inherited:false});return {id:'permission-0001'};}
    if(method==='delete')permissions.splice(permissions.findIndex((permission)=>!permission.inherited),1);
    return {};
  };
  f.properties.set('PHOTO_HEADSHOT_WRITES_ENABLED','true');f.properties.set('PHOTO_HEADSHOT_QUALIFIED_LEADER_IDS',leaderId);
  const body={wixItemId:leaderId,operationId:'headshot-00000000-0000-4000-8000-000000000001',email:'approved@example.com'};
  const granted=f.sandbox.routeHeadshotManagement_({...body,action:'HEADSHOT_GRANT_ACCESS'});
  expect(granted.verified).toBe(true);expect(granted.studioManaged).toBe(true);
  f.sandbox.routeHeadshotManagement_({...body,action:'HEADSHOT_GRANT_ACCESS'});expect(calls).toBe(1);
  permissions.push({permissionId:'inherited-0001',email:'approved@example.com',role:'reader',inherited:true});
  const revoked=f.sandbox.routeHeadshotManagement_({...body,action:'HEADSHOT_REVOKE_ACCESS',permissionId:'permission-0001',studioManaged:true});
  expect(revoked.revoked).toBe(true);expect(revoked.remainingAccess).toBe(true);expect(permissions).toHaveLength(1);
  expect(()=>f.sandbox.routeHeadshotManagement_({...body,action:'HEADSHOT_REVOKE_ACCESS',permissionId:'inherited-0001',studioManaged:true})).toThrow('refusing_inherited');
});

test('leader folder creation reuses an existing authoritative destination',()=>{
  const f=scriptFixture();
  f.properties.set('PHOTO_HEADSHOT_WRITES_ENABLED','true');f.properties.set('PHOTO_HEADSHOT_QUALIFIED_LEADER_IDS',leaderId);
  const result=f.sandbox.routeHeadshotManagement_({wixItemId:leaderId,operationId:'headshot-00000000-0000-4000-8000-000000000001',action:'HEADSHOT_CREATE_FOLDER'});
  expect(result.folderId).toBe(folderId);expect(result.reused).toBe(true);
});

for(const width of [375,390,430,1024,1280,1440]) {
  test(`native leader photograph management fits ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const leader={wix_item_id:leaderId,leader_name:'Matt Morris',mapping_state:'VERIFIED',verified_drive_folder_id:folderId,primary_drive_file_id:'canonical-file-0001',photo_count:2,sync_status:'CONFIRMED',primary_image_url:'https://static.wixstatic.com/media/8e9777_602dadcb2a4a44a882d12631d4fb85a6~mv2.png'};
    await page.route('**/api/photos/**',async(route)=>{
      const path=new URL(route.request().url()).pathname.split('/api/photos/')[1];
      const body=path==='session'?{actor:{id:'owner',role:'PHOTO_ADMIN',displayName:'Owner',canCreateEvent:false,headshotCapabilities:['HEADSHOT_VIEW','HEADSHOT_UPLOAD','HEADSHOT_MANAGE']}}:
        path==='events'?{events:[]}:path==='overview'?{overview:{}}:path==='photographers'?{photographers:[]}:
        path==='media-assets'?{leaders:[leader]}:path.startsWith('headshots/')?{leader,total:2,nextCursor:'',writesEnabled:true,canManage:true,canUpload:true,uploadUrl:`https://drive.google.com/drive/folders/${folderId}`,photos:[{fileId:'canonical-file-0001',sourceItemId:'canonical-file-0001',filename:'Current.png',currentPrimary:true,thumbnailUrl:leader.primary_image_url},{fileId:'canonical-file-0002',sourceItemId:'canonical-file-0002',filename:'Alternative.png',currentPrimary:false,thumbnailUrl:leader.primary_image_url}]}:{};
      await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto('/studio/photos/index.html?view=media-assets');
    await page.getByRole('button',{name:'Open Leader',exact:true}).click();
    await expect(page.locator('.headshot-photo-grid article')).toHaveCount(2);
    await expect(page.getByRole('link',{name:'OPEN GOOGLE DRIVE UPLOAD FOLDER ↗'})).toHaveAttribute('href',`https://drive.google.com/drive/folders/${folderId}`);
    await expect(page.locator('[data-headshot-primary]').first()).toBeDisabled();
    await expect(page.locator('[data-headshot-remove]').first()).toBeDisabled();
    await expect(page.locator('[data-headshot-primary]').last()).toBeEnabled();
    await page.locator('.leader-primary').evaluate(async(image)=>{await image.decode();return image.naturalWidth;});
    await page.locator('.headshot-photo-grid img').evaluateAll(async(images)=>{await Promise.all(images.map((image)=>image.decode()));});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({path:`/private/tmp/uap05b-leader-${width}.png`,fullPage:false});
  });
}
