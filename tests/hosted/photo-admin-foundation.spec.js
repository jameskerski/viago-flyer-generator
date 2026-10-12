import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createPhotoRegistry } from '../../hosted/platform/photo-registry.mjs';
import { utcDate } from '../../studio/photos/photo-admin-format.js';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { onRequest } from '../../functions/api/photos/[[path]].js';

function database() {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${name}`, 'utf8'));
  const adapter = { prepare(sql) { let args=[]; return { bind(...values) { args=values;return this; }, async run() { return db.prepare(sql).run(...args); }, async first() { return db.prepare(sql).get(...args) || null; }, async all() { return { results:db.prepare(sql).all(...args) }; } }; }, async batch(statements) { return Promise.all(statements.map((statement)=>statement.run())); } };
  return { db, adapter, registry:createPhotoRegistry(adapter) };
}

test('Worker enforces headshot permissions and rejects unqualified writes server-side',async()=>{
  const {db,adapter}=database();
  db.exec(`INSERT INTO platform_users(id,display_name,status) VALUES('external','External','ACTIVE');
    INSERT INTO identity_bindings(id,user_id,provider,issuer,provider_subject,verified_email,status) VALUES('binding','external','cloudflare_access','https://qualification.cloudflareaccess.com','subject','external@example.com','ACTIVE');
    INSERT INTO module_grants(id,user_id,module_key,role_key,status) VALUES('grant','external','PHOTO_STUDIO','PHOTOGRAPHER','ACTIVE');`);
  const {publicKey,privateKey}=await generateKeyPair('ES256');
  const jwk=await exportJWK(publicKey);jwk.kid='qualification';
  const token=await new SignJWT({email:'external@example.com',name:'External'}).setProtectedHeader({alg:'ES256',kid:jwk.kid}).setIssuer('https://qualification.cloudflareaccess.com').setSubject('subject').setAudience('qualification').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({keys:[jwk]});
  const env={PLATFORM_DB:adapter,CF_TEAM_DOMAIN:'https://qualification.cloudflareaccess.com',PHOTO_CF_ACCESS_AUD:'qualification'};
  const request=(method='GET')=>new Request('https://qualification.example/api/photos/headshots',{method,headers:{'cf-access-jwt-assertion':token}});
  try {
    const denied=await onRequest({request:request(),env});expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:'headshot_view_permission_required'});
    db.exec(`INSERT INTO headshot_capability_grants(user_id,capability,status,granted_by_user_id) VALUES('external','HEADSHOT_VIEW','ACTIVE','external');`);
    const allowed=await onRequest({request:request(),env});expect(allowed.status).toBe(200);expect((await allowed.json()).leaders).toHaveLength(23);
    // Administrator also cannot use an unqualified headshot write endpoint.
    db.exec(`UPDATE module_grants SET role_key='PHOTO_ADMIN' WHERE id='grant';`);
    const mutation=await onRequest({request:request('POST'),env});expect(mutation.status).toBe(403);expect(await mutation.json()).toMatchObject({error:'headshot_writes_not_qualified'});
  } finally {globalThis.fetch=originalFetch;db.close();}
});

test('SQLite timestamps retain their UTC instant',()=>{
  expect(utcDate('2026-10-12 21:30:00').toISOString()).toBe('2026-10-12T21:30:00.000Z');
  expect(utcDate('2026-10-12T16:30:00-05:00').toISOString()).toBe('2026-10-12T21:30:00.000Z');
  expect(utcDate('invalid')).toBeNull();
});

test('invitations are visible immediately, repeat safely, and revoke without creating identities',async()=>{
  const { db,registry }=database();
  const first=await registry.invite(null,{email:' Photographer@example.com '});
  const second=await registry.invite(null,{email:'photographer@example.com'});
  expect(second.id).toBe(first.id);
  expect(second.emailSent).toBe(false);
  expect(await registry.listPhotographers()).toMatchObject([{email:'photographer@example.com',status:'PENDING',invitation_id:first.id}]);
  expect(db.prepare('SELECT COUNT(*) AS n FROM platform_users').get().n).toBe(0);
  await registry.revokeInvitation(null,first.id);
  expect(await registry.listPhotographers()).toMatchObject([{status:'REVOKED',email:'photographer@example.com'}]);
  expect(db.prepare('SELECT status FROM invitations WHERE id=?').get(first.id).status).toBe('REVOKED');
  db.close();
});

test('headshots retain 23 Wix identities and event presets grant no headshot capability',async()=>{
  const { db,registry }=database();
  const leaders=await registry.headshotLeaders();
  expect(leaders).toHaveLength(23);
  expect(new Set(leaders.map((row)=>row.wix_item_id)).size).toBe(23);
  expect(leaders.every((row)=>row.mapping_state==='CMS_REFERENCE_UNVERIFIED'&&row.photo_count==null)).toBe(true);
  expect(await registry.headshotCapabilities({id:'external',role:'PHOTOGRAPHER'})).toEqual([]);
  expect(await registry.headshotCapabilities({id:'owner',role:'PHOTO_ADMIN'})).toEqual(['HEADSHOT_VIEW','HEADSHOT_UPLOAD','HEADSHOT_MANAGE']);
  db.close();
});

test('successful invitation confirmation survives form reset and exposes management',async({page})=>{
  let pending=false;
  await page.route('**/api/photos/**',async(route)=>{
    const path=new URL(route.request().url()).pathname.split('/api/photos/')[1];
    let result={};
    if(path==='session') result={actor:{id:'owner',role:'PHOTO_ADMIN',displayName:'Owner',canCreateEvent:false}};
    if(path==='events') result={events:[]};
    if(path==='overview') result={overview:{}};
    if(path==='activity') result={activity:[]};
    if(path==='photographers') result={photographers:pending?[{id:'invite-one',invitation_id:'invite-one',email:'pending@example.com',status:'PENDING'}]:[]};
    if(path==='invitations') {pending=true;result={invitation:{id:'invite-one',email:'pending@example.com',status:'PENDING',emailSent:false}};}
    await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('/studio/photos/index.html?view=photographers');
  await page.getByRole('textbox',{name:'Photographer email'}).fill('pending@example.com');
  await page.getByRole('button',{name:'Create invitation'}).click();
  await expect(page.locator('#inviteResult')).toContainText('Photographer invitation created');
  await expect(page.locator('#inviteResult')).toContainText('No invitation email was sent');
  await expect(page.getByRole('textbox',{name:'Photographer email'})).toHaveValue('');
  await expect(page.locator('.person')).toHaveCount(1);
  await page.locator('#inviteResult').getByRole('button',{name:'Manage Invitation'}).click();
  await expect(page.locator('.person details')).toHaveAttribute('open','');
});

for(const width of [375,390,430,1024,1280,1440]) {
  test(`photographer cards and expanded access fit ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.route('**/api/photos/**',async(route)=>{
      const path=new URL(route.request().url()).pathname.split('/api/photos/')[1];
      const result=path==='session'?{actor:{id:'owner',role:'PHOTO_ADMIN',displayName:'admin@goodlifetrainings.com',canCreateEvent:true,headshotCapabilities:['HEADSHOT_VIEW']}}:
        path==='events'?{events:[{id:'wix-event-one',public_name:'Qualification event',event_year:2027}]}:
        path==='overview'?{overview:{events:1}}:
        path==='setup'?{operations:[{id:'op',event_name:'Inactive qualification event',event_type:'OTHER',event_year:2027,operation_state:'READY_FOR_PUBLICATION'}],qualification:{enabled:false,blockers:[]}}:
        path==='photographers'?{photographers:[{id:'person-one',email:'admin@pristinecleantn.com',status:'ACTIVE',preset_key:'ASSIGNED',event_ids:'wix-event-one'}, {id:'invite-one',invitation_id:'invite-one',email:'pending.photographer@gmail.com',status:'PENDING',preset_key:'ASSIGNED',event_ids:''}]}:
        path==='media-assets'?{leaders:[{wix_item_id:'leader-one',leader_name:'Jane Smith',mapping_state:'CMS_REFERENCE_UNVERIFIED',photo_count:null}]}:{activity:[]};
      await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.goto('/studio/photos/index.html?view=photographers');
    await expect(page.locator('.person')).toHaveCount(2);
    const card=page.locator('.person').first();
    expect((await card.boundingBox()).height).toBeLessThan(230);
    await page.getByText('Manage Access',{exact:true}).click();
    await expect(page.getByRole('button',{name:'Revoke event',exact:true})).toBeVisible();
    const geometry=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,identityWidth:document.querySelector('.person-main').getBoundingClientRect().width}));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    expect(geometry.identityWidth).toBeGreaterThan(200);
    await page.screenshot({path:`/private/tmp/uap05a-photographers-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Events',exact:true}).click();
    await expect(page.locator('.operation-filter')).toHaveCount(4);
    await page.getByRole('button',{name:'Ready for Review 1'}).click();
    await expect(page.locator('.operation-results')).toContainText('Publication Not Yet Enabled');
    await page.getByRole('button',{name:'Media Assets',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Leader Headshots'})).toBeVisible();
    await page.getByRole('button',{name:'Open Leader'}).click();
    await expect(page.getByRole('dialog')).toContainText('disabled until');
    await expect(page.getByRole('button',{name:'Select primary headshot'})).toBeDisabled();
  });
}
