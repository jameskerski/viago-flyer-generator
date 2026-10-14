import { test,expect } from '@playwright/test';
import { readFileSync,readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db=new DatabaseSync(':memory:');
for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${name}`,'utf8'));
const leaders=db.prepare('SELECT wix_item_id,leader_name,primary_image_source FROM headshot_leaders WHERE active=1 ORDER BY leader_name').all().map(row=>({
  id:row.wix_item_id,name:row.leader_name.trim(),primaryImage:'https://static.wixstatic.com/media/'+row.primary_image_source.match(/^wix:image:\/\/v1\/([^/]+)/)[1],destination:'/blank-14-1?leaderId='+row.wix_item_id
}));
const source=readFileSync('../my-site-1/src/public/custom-elements/headshots-v2-host.js','utf8');

async function load(page,model) {
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:black}</style><headshots-v2-host></headshots-v2-host>');
  await page.addScriptTag({content:source});
  await page.locator('headshots-v2-host').evaluate((element,data)=>element.setAttribute('model',JSON.stringify(data)),{status:'ready',route:'/blank-14-1',leaders,...model});
}

test('directory displays 23 original leaders with canonical links and working search',async({page})=>{
  await load(page,{});
  await expect(page.locator('.leader')).toHaveCount(23);
  await expect(page.getByRole('link',{name:'View Janie Braun photographs'})).toHaveAttribute('href',/leaderId=02a9ab6c-42a6-4568-8b14-f46e0ca08dc2$/);
  await page.getByRole('searchbox').fill('braun');
  await expect(page.locator('.leader')).toHaveCount(2);
  await page.getByRole('searchbox').fill('not-a-leader');
  await expect(page.getByText('No leaders match your search.')).toBeVisible();
});

for(const width of [320,375,390,430,768,1024,1280,1440]) test(`real Wix portrait assets fit ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await load(page,{});
  const bounds=await page.locator('headshots-v2-host').evaluate(element=>{
    const root=element.shadowRoot;
    return {pageScroll:document.documentElement.scrollWidth,pageClient:document.documentElement.clientWidth,rootWidth:root.querySelector('main').getBoundingClientRect().width,hostWidth:element.getBoundingClientRect().width,badNames:[...root.querySelectorAll('h3')].filter(e=>e.scrollWidth>e.clientWidth).length};
  });
  expect(bounds.pageScroll).toBeLessThanOrEqual(bounds.pageClient);
  expect(bounds.rootWidth).toBe(bounds.hostWidth);
  expect(bounds.badNames).toBe(0);
});

test('selected collection has no management controls and preserves shared labels',async({page})=>{
  await load(page,{selectedLeader:leaders.find(l=>l.name==='Janie Braun'),collectionStatus:'ready',total:1,nextOffset:null,photos:[{fileId:'approved-photo-01',filename:'Portrait.png',displayUrl:leaders[0].primaryImage,sources:[{label:'Both',shared:true}],originalUrl:'https://drive.google.com/file/d/approved-photo-01/view'}]});
  await expect(page.getByText('Both · Shared',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'DOWNLOAD',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'DOWNLOAD',exact:true})).toHaveAttribute('href',leaders[0].primaryImage+'?download=1');
  await expect(page.getByRole('link',{name:/Open Drive original/i})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Primary|Remove|Upload/})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'← BACK TO DIRECTORY'})).toHaveAttribute('href','/blank-14-1');
  await page.getByRole('link',{name:'VIEW',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Leader photograph viewer'})).toBeVisible();
  await expect(page.getByRole('link',{name:'DOWNLOAD DISPLAY IMAGE'})).toHaveAttribute('href',leaders[0].primaryImage+'?download=1');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('link',{name:'VIEW',exact:true})).toBeFocused();
});

for(const width of [320,375,390,430,768,1024,1280,1440]) test(`collection feedback and viewer preserve bounds at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const leader=leaders.find(l=>l.name==='Janie Braun');
  await load(page,{selectedLeader:leader,collectionStatus:'loading',photos:[],nextOffset:null});
  await expect(page.getByText('LOADING HEADSHOTS',{exact:true})).toBeVisible();
  await expect(page.getByText("Preparing Janie Braun's photo collection…",{exact:true})).toBeVisible();
  await expect(page.getByText('No approved photographs are available for this leader yet.')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await page.locator('.loading-ring').evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
  await load(page,{selectedLeader:leader,collectionStatus:'error',photos:[],nextOffset:null});
  await expect(page.getByRole('button',{name:'TRY AGAIN'})).toBeVisible();
  await load(page,{selectedLeader:leader,collectionStatus:'ready',photos:[],nextOffset:null});
  await expect(page.getByText('No approved photographs are available for this leader yet.')).toBeVisible();
  await load(page,{selectedLeader:leader,collectionStatus:'ready',photos:[{fileId:'photo-01',filename:'Portrait.png',displayUrl:leader.primaryImage}],nextOffset:null});
  await page.getByRole('link',{name:'VIEW',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const bounds=await dialog.boundingBox();
  if(width>720){expect(bounds.width).toBeCloseTo(width*.88,0);expect(bounds.height).toBeCloseTo(900*.88,0);}
  else {expect(bounds.width).toBeLessThanOrEqual(width-24);expect(await dialog.evaluate(e=>getComputedStyle(e).maxHeight)).toBe('876px');}
  expect(await page.evaluate(()=>document.documentElement.style.overflow)).toBe('hidden');
  await page.mouse.click(1,1);
  await expect(dialog).not.toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.style.overflow)).toBe('');
  await expect(page.getByRole('link',{name:'VIEW',exact:true})).toBeFocused();
});
