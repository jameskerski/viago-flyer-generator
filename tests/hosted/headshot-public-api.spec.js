import {test,expect} from '@playwright/test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {publicHeadshotApi} from '../../hosted/platform/headshot-public-api.mjs';

test('concurrent cold source checks share work and never masquerade as missing collections',async()=>{
  let state=null,requests=0,release;
  const database={prepare(sql){return {bind(){return this;},async first(){
    if(sql.includes('NOT EXISTS')) return null;
    if(sql.includes('JOIN headshot_public_photos')) return {active:1,file_id:'approved-file-0001'};
    return state;
  },async run(){
    if(sql.includes("VALUES(?,'CHECKING'")) {if(state?.lease_until) return {meta:{changes:0}};state={check_state:'CHECKING',lease_until:'2099-01-01 00:00:00'};}
    else state={check_state:'UNAVAILABLE',checked_at:new Date().toISOString().slice(0,19).replace('T',' ')};
    return {meta:{changes:1}};
  }};}};
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>{requests++;await new Promise(resolve=>release=resolve);return Response.json({success:false});};
  const env={PLATFORM_DB:database,PHOTO_PUBLIC_HEADSHOTS_ENABLED:'true',PHOTO_EVENT_PROVISION_ENDPOINT:'https://example.test/verify',PHOTO_STUDIO_SYNC_SECRET:'test-only-secret'};
  const url='https://example.test/public/headshots/02a9ab6c-42a6-4568-8b14-f46e0ca08dc2';
  try {
    const first=publicHeadshotApi(new Request(url),env);
    while(!release) await new Promise(resolve=>setImmediate(resolve));
    const second=publicHeadshotApi(new Request(url),env);
    release();
    const responses=await Promise.all([first,second]);
    expect(requests).toBe(1);
    for(const response of responses) {expect(response.status).toBe(503);expect(response.headers.get('retry-after')).toBe('2');expect(await response.json()).toEqual({error:'temporarily_unavailable'});}
    // A different isolate holding the D1 lease must also fail closed as retryable.
    state={check_state:'CHECKING',lease_until:'2099-01-01 00:00:00'};
    expect((await publicHeadshotApi(new Request(url),env)).status).toBe(503);
    expect(requests).toBe(1);
  } finally {globalThis.fetch=previous;}
});

test('stable image route gates identity, relationship approval, source, version and variants',async()=>{
  const db=new DatabaseSync(':memory:');
  for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${name}`,'utf8'));
  const adapter={prepare(sql){let params=[];return {bind(...p){params=p;return this;},async first(){return db.prepare(sql).get(...params)||null;},async all(){return {results:db.prepare(sql).all(...params)};},async run(){return db.prepare(sql).run(...params);}};}};
  const leader='02a9ab6c-42a6-4568-8b14-f46e0ca08dc2',file='approved-canonical-file-001',version='a'.repeat(64);
  const photo={fileId:file,filename:'Portrait.png',mimeType:'image/png',sourceVersion:version,modifiedTime:'2026-06-18T00:00:00.000Z',sources:[{folderId:'1gqUTlsMw2Q8Po6YtoivsvC9rEuI16Iio',label:'Janie'}]};
  db.prepare(`UPDATE headshot_leaders SET active=1,mapping_status='VERIFIED',photo_inventory_json=? WHERE wix_item_id=?`).run(JSON.stringify([photo]),leader);
  db.prepare(`UPDATE headshot_photo_sources SET verification_state='VERIFIED' WHERE folder_id='1gqUTlsMw2Q8Po6YtoivsvC9rEuI16Iio'`).run();
  db.prepare(`INSERT INTO headshot_public_photos(wix_item_id,file_id,approval_state,approved_at) VALUES(?,?,'APPROVED',?)`).run(leader,file,new Date().toISOString());
  db.prepare(`INSERT INTO headshot_public_media(file_id,source_version,media_state,wix_file_url,mime_type) VALUES(?,?,'READY',?,'image/png')`).run(file,version,'wix:image://v1/known-media~mv2.png/Portrait.png');
  db.prepare(`INSERT INTO headshot_public_checks(wix_item_id,check_state,checked_at) VALUES(?,'AVAILABLE',CURRENT_TIMESTAMP)`).run(leader);
  const env={PLATFORM_DB:adapter,PHOTO_PUBLIC_HEADSHOTS_ENABLED:'true'};
  const base=`https://example.test/public/headshots/${leader}/${file}`;
  const previous=globalThis.fetch;let requests=0;
  globalThis.fetch=async url=>{requests++;expect(String(url)).toMatch(/^https:\/\/static\.wixstatic\.com\/media\/known-media~mv2.png\/v1\/fit\//);return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}});};
  try {
    const response=await publicHeadshotApi(new Request(base+'?variant=480'),env);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://static.wixstatic.com/media/known-media~mv2.png/v1/fit/w_480,h_672,q_85,enc_auto/known-media~mv2.png');
    expect(response.headers.get('cache-control')).toBe('no-store');
    for(const url of [base+'?variant=999',base+'?variant=480&variant=960',base+'?url=https://drive.google.com',base.replace(file,'arbitrary-private-file-001'),base.replace(leader,'ffffffff-ffff-ffff-ffff-ffffffffffff')]) expect((await publicHeadshotApi(new Request(url),env)).status).toBe(404);
    expect(requests).toBe(0);
    globalThis.fetch=async url=>{requests++;expect(String(url)).toBe('https://static.wixstatic.com/media/known-media~mv2.png');return new Response(new Uint8Array(32).fill(7),{headers:{'Content-Type':'image/png'}});};
    const download=await publicHeadshotApi(new Request(base+'?download=1'),env);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="Portrait.png"');
    expect(download.headers.get('content-type')).toBe('image/png');
    expect((await download.arrayBuffer()).byteLength).toBe(32);
    expect(requests).toBe(1);requests=0;
    expect((await publicHeadshotApi(new Request(base,{method:'POST'}),env)).status).toBe(405);
    for(const change of [{trashed:true},{mimeType:'application/pdf'},{sourceVersion:'b'.repeat(64)},{sources:[]}]) {
      db.prepare('UPDATE headshot_leaders SET photo_inventory_json=? WHERE wix_item_id=?').run(JSON.stringify([{...photo,...change}]),leader);
      expect((await publicHeadshotApi(new Request(base),env)).status).toBe(404);
    }
    db.prepare('UPDATE headshot_leaders SET photo_inventory_json=? WHERE wix_item_id=?').run(JSON.stringify([photo]),leader);
    db.prepare(`UPDATE headshot_public_photos SET approval_state='REVOKED' WHERE file_id=?`).run(file);
    expect((await publicHeadshotApi(new Request(base),env)).status).toBe(404);
    const empty=await publicHeadshotApi(new Request(base.slice(0,base.lastIndexOf('/'))),env);
    expect(empty.status).toBe(200);expect((await empty.json()).photos).toEqual([]);
    expect((await publicHeadshotApi(new Request(base.slice(0,base.lastIndexOf('/'))+'?offset=bad'),env)).status).toBe(404);
    db.prepare(`UPDATE headshot_public_photos SET approval_state='APPROVED' WHERE file_id=?`).run(file);
    db.prepare(`UPDATE headshot_leaders SET active=0 WHERE wix_item_id=?`).run(leader);
    expect((await publicHeadshotApi(new Request(base),env)).status).toBe(404);
    expect((await publicHeadshotApi(new Request(base.slice(0,base.lastIndexOf('/'))),env)).status).toBe(404);
    expect(requests).toBe(0);
  } finally {globalThis.fetch=previous;db.close();}
});
