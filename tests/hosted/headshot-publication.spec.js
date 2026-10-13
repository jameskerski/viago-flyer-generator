import { test, expect } from '@playwright/test';
import { approvedPublicInventory, publicWixImageUrl } from '../../hosted/platform/headshot-publication.mjs';
import { createHeadshotManagement } from '../../hosted/platform/headshot-management.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';

const leaderId = '02a9ab6c-42a6-4568-8b14-f46e0ca08dc2';
const fileId = 'approved-canonical-file-001';
const folderId = 'verified-source-folder-001';
const photo = { fileId, filename: 'Portrait.png', mimeType:'image/png', modifiedTime:'2026-06-18T00:00:00.000Z',sourceVersion:'verified-version',sources: [{ folderId, label: 'Both', shared: true }] };
const input = () => ({
  leader: { wix_item_id: leaderId, active: 1, mapping_status: 'VERIFIED', photo_inventory_json: JSON.stringify([photo,photo,{...photo,fileId:'new-upload-file-002'}]) },
  sources: [{ folder_id: folderId, verification_state: 'VERIFIED' }],
  approvals: [{ wix_item_id: leaderId, file_id: fileId, approval_state: 'APPROVED',approved_at:'2026-10-13T13:31:05.000Z' }],
  media: [{ file_id: fileId, source_version:'verified-version',mime_type:'image/png',media_state: 'READY', wix_file_url: 'wix:image://v1/known-media~mv2.png/Portrait.png' }]
});

test('only explicit approved, ready images appear and canonical files are deduplicated', () => {
  const result = approvedPublicInventory(input());
  expect(result).toHaveLength(1);
  expect(result[0].sources).toEqual([{label:'Both',shared:true}]);
  expect(result[0].displayUrl).toBe('https://static.wixstatic.com/media/known-media~mv2.png');
  expect(result[0].originalRequiresGooglePermissions).toBe(true);
});

test('inactive leaders, revoked approvals, inaccessible sources and unready media fail closed', () => {
  for (const change of [
    i => { i.leader.active=0; },
    i => { i.leader.mapping_status='INACCESSIBLE'; },
    i => { i.approvals[0].approval_state='REVOKED'; },
    i => { i.sources[0].verification_state='INACCESSIBLE'; },
    i => { i.media[0].media_state='PROCESSING'; }
    ,i => { const photos=JSON.parse(i.leader.photo_inventory_json);photos[0].modifiedTime='2026-10-14T00:00:00Z';photos[1].modifiedTime=photos[0].modifiedTime;i.leader.photo_inventory_json=JSON.stringify(photos); }
  ]) { const data=input(); change(data); expect(approvedPublicInventory(data)).toEqual([]); }
});

test('Drive thumbnails, arbitrary URLs and private-reference substitutes never become public delivery', () => {
  for (const url of ['https://drive.google.com/thumbnail?id=x','https://evil.example/image.png','wix:document://v1/x']) expect(publicWixImageUrl(url)).toBe('');
  const data=input(); data.media[0].wix_file_url='https://drive.google.com/thumbnail?id=x';
  expect(approvedPublicInventory(data)).toEqual([]);
});

test('administrator approval is explicit, idempotent, revocable and never available to photographers',async()=>{
  const db=new DatabaseSync(':memory:');
  for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${name}`,'utf8'));
  const adapter={prepare(sql){let params=[];return {bind(...values){params=values;return this;},async first(){return db.prepare(sql).get(...params)||null;},async all(){return {results:db.prepare(sql).all(...params)};},async run(){return db.prepare(sql).run(...params);}};}};
  const newFile='future-private-photo-001';
  const source='1gqUTlsMw2Q8Po6YtoivsvC9rEuI16Iio';
  const snapshot={sourceContractVersion:3,wixItemId:leaderId,leaderName:'Janie Braun',active:true,primaryImage:db.prepare('SELECT primary_image_source FROM headshot_leaders WHERE wix_item_id=?').get(leaderId).primary_image_source,sources:[{folderId:source,verificationState:'VERIFIED',photos:[{fileId:newFile,sourceItemId:newFile,filename:'Future.png',mimeType:'image/png',sourceVersion:'a'.repeat(64),modifiedTime:'2026-06-18T00:00:00.000Z'}]},{folderId:'1WM7epm1HUkb97dOkC4CaLyCyZ95kENB0',verificationState:'VERIFIED',photos:[]}]};
  const previous=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return Response.json({success:true,snapshot});};
  try {
    const manager=createHeadshotManagement(adapter,{PHOTO_HEADSHOT_WRITES_ENABLED:'true',PHOTO_PUBLIC_HEADSHOTS_ENABLED:'true',PHOTO_HEADSHOT_QUALIFIED_LEADER_IDS:leaderId,PHOTO_EVENT_PROVISION_ENDPOINT:'https://qualified.example',PHOTO_STUDIO_SYNC_SECRET:'fixture'},{audit:async()=>{},headshotCapabilities:async()=>[]});
    const input={fileId:newFile,approved:true,confirmed:true};
    await expect(manager.publication({role:'PHOTOGRAPHER'},leaderId,input)).rejects.toThrow('not_authorized');
    expect(requests).toBe(0);
    expect(db.prepare('SELECT * FROM headshot_public_photos WHERE file_id=?').get(newFile)).toBeUndefined();
    expect((await manager.publication({role:'PHOTO_ADMIN'},leaderId,input)).changed).toBe(true);
    expect((await manager.publication({role:'PHOTO_ADMIN'},leaderId,input)).changed).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS total FROM headshot_public_photos WHERE file_id=?').get(newFile).total).toBe(1);
    await manager.publication({role:'PHOTO_ADMIN'},leaderId,{...input,approved:false});
    expect(db.prepare('SELECT approval_state FROM headshot_public_photos WHERE file_id=?').get(newFile).approval_state).toBe('REVOKED');
  } finally {globalThis.fetch=previous;db.close();}
});
