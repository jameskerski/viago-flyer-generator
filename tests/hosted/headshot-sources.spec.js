import { test, expect } from '@playwright/test';
import { combineSourceInventories, assertSourcePhotoOperation } from '../../hosted/platform/headshot-sources.mjs';
import { reconcileSharedHeadshotSnapshot } from '../../hosted/platform/headshot-sources.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';

function sharedDatabase() {
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${file}`,'utf8'));
  const adapter={prepare(sql){let params=[];return {bind(...values){params=values;return this;},async first(){return db.prepare(sql).get(...params)||null;},async all(){return {results:db.prepare(sql).all(...params)};},async run(){return db.prepare(sql).run(...params);}};}};
  return {db,adapter};
}

const source = (id, shared=false) => ({folder_id:id,display_label:id,shared});
const photo = id => ({fileId:id,sourceItemId:id,filename:`${id}.png`,mimeType:'image/png'});
const snapshot = (id, ids) => ({folderId:id,verificationState:'VERIFIED',photos:ids.map(photo)});

test('one-folder compatibility and multiple collections preserve canonical identities', () => {
  const sources=[source('individual-folder'),source('shared-folder',true)];
  const result=combineSourceInventories(sources,[snapshot('individual-folder',['photo-file-0001']),snapshot('shared-folder',['photo-file-0002'])]);
  expect(result.total).toBe(2);
  expect(result.collections.map(c=>c.photoCount)).toEqual([1,1]);
  expect(result.photos[1].shared).toBe(true);
  expect(result.photos[1].sourceFolderId).toBe('shared-folder');
  expect(combineSourceInventories(sources.slice(0,1),[snapshot('individual-folder',['photo-file-0001'])]).total).toBe(1);
});

test('canonical deduplication preserves all source origins and deterministic ordering', () => {
  const sources=[source('individual-folder'),source('shared-folder',true)];
  const snapshots=[snapshot('individual-folder',['photo-file-0002','photo-file-0001']),snapshot('shared-folder',['photo-file-0001'])];
  const result=combineSourceInventories(sources,snapshots);
  expect(result.total).toBe(2);
  expect(result.photos[0].sources).toHaveLength(2);
  expect(result.photos[0].shared).toBe(true);
  expect(combineSourceInventories(sources,snapshots.toReversed())).toEqual(result);
});

test('partial failure and forged/duplicate snapshots reject the entire replacement', () => {
  const sources=[source('individual-folder'),source('shared-folder',true)];
  expect(()=>combineSourceInventories(sources,[snapshot('individual-folder',[])])).toThrow('incomplete');
  expect(()=>combineSourceInventories(sources,[snapshot('individual-folder',[]),{folderId:'shared-folder',verificationState:'INACCESSIBLE',photos:[]}])).toThrow('verification');
  expect(()=>combineSourceInventories(sources,[snapshot('individual-folder',[]),snapshot('unapproved-folder',[])])).toThrow('verification');
  expect(()=>combineSourceInventories([source('individual-folder')],[snapshot('individual-folder',['photo-file-0001','photo-file-0001'])])).toThrow('invalid_source_photo');
});

test('shared deletion is administrator-only and every linked primary remains protected', () => {
  const shared={...photo('shared-photo-01'),shared:true};
  expect(()=>assertSourcePhotoOperation({actorRole:'PHOTOGRAPHER',operation:'SET_PRIMARY',photo:shared,linkedPrimaries:[]})).not.toThrow();
  expect(()=>assertSourcePhotoOperation({actorRole:'PHOTOGRAPHER',operation:'REMOVE_PHOTO',photo:shared,linkedPrimaries:[]})).toThrow('administrator_required');
  expect(()=>assertSourcePhotoOperation({actorRole:'PHOTO_ADMIN',operation:'REMOVE_PHOTO',photo:shared,linkedPrimaries:[{leaderId:'other-leader',fileId:shared.fileId}]})).toThrow('primary_requires_replacement');
  expect(()=>assertSourcePhotoOperation({actorRole:'PHOTO_ADMIN',operation:'REMOVE_PHOTO',photo:shared,linkedPrimaries:[]})).not.toThrow();
});

test('two leaders can share one source and choose independent primary images idempotently',async()=>{
  const {db,adapter}=sharedDatabase();
  const ids=['02a9ab6c-42a6-4568-8b14-f46e0ca08dc2','e42172c5-67dc-4971-a87c-a507551e1ad3'];
  db.exec("INSERT INTO headshot_photo_sources(folder_id,display_label) VALUES('shared-folder','Both');");
  for(const id of ids) {
    db.prepare('DELETE FROM headshot_leader_sources WHERE wix_item_id=?').run(id);
    db.prepare("INSERT INTO headshot_leader_sources(wix_item_id,folder_id,relationship_type) VALUES(?,'shared-folder','SHARED')").run(id);
  }
  const input=id=>({wixItemId:id,sourceContractVersion:3,primaryImage:db.prepare('SELECT primary_image_source FROM headshot_leaders WHERE wix_item_id=?').get(id).primary_image_source,sources:[snapshot('shared-folder',['shared-photo-01','shared-photo-02'])]});
  const first=input(ids[0]);first.primaryFileId='shared-photo-01';first.imageReference={fileId:first.primaryFileId,sourceFolderId:'shared-folder',displayUrl:'https://drive.google.com/thumbnail?id=shared-photo-01&sz=w1600'};
  const second=input(ids[1]);second.primaryFileId='shared-photo-02';second.imageReference={fileId:second.primaryFileId,sourceFolderId:'shared-folder',displayUrl:'https://drive.google.com/thumbnail?id=shared-photo-02&sz=w1600'};
  expect((await reconcileSharedHeadshotSnapshot(adapter,first)).photoCount).toBe(2);
  expect((await reconcileSharedHeadshotSnapshot(adapter,second)).photoCount).toBe(2);
  const before=db.prepare('SELECT * FROM headshot_leaders WHERE wix_item_id=?').get(ids[0]);
  expect((await reconcileSharedHeadshotSnapshot(adapter,first)).changed).toBe(false);
  expect(db.prepare('SELECT * FROM headshot_leaders WHERE wix_item_id=?').get(ids[0])).toEqual(before);
  expect(before.verified_drive_folder_id).toBeNull();
  expect(db.prepare('SELECT primary_drive_file_id FROM headshot_leaders WHERE wix_item_id=?').get(ids[1]).primary_drive_file_id).toBe('shared-photo-02');
  const failed=structuredClone(first);failed.sources[0].verificationState='INACCESSIBLE';
  await expect(reconcileSharedHeadshotSnapshot(adapter,failed)).rejects.toThrow('verification');
  expect(db.prepare('SELECT * FROM headshot_leaders WHERE wix_item_id=?').get(ids[0])).toEqual(before);
  db.close();
});
