import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('same-page selection, direct query, back, directory and stale responses stay synchronized',async()=>{
  const a='02a9ab6c-42a6-4568-8b14-f46e0ca08dc2',b='e42172c5-67dc-4971-a87c-a507551e1ad3';
  const source=readFileSync('../my-site-1/src/public/headshots-v2-page.js','utf8').replace(/^import .*;\n/gm,'').replace('export async function','async function');
  let handler,onChange,current;const pending=new Map();
  const location={url:'https://www.goodlifetrainings.com/blank-14-1',query:{leaderId:a},to(url){this.query={leaderId:new URL(url,'https://www.goodlifetrainings.com').searchParams.get('leaderId')||''};onChange?.();},onChange(callback){onChange=callback;}};
  const host={setAttribute(name,value){current=JSON.parse(value);},on(name,callback){handler=callback;}};
  const context=vm.createContext({URL,wixLocationFrontend:location,headshotsDirectory:async()=>[{id:a,name:'Janie'},{id:b,name:'Raymond'}],headshotsCollection:async id=>pending.has(id)?new Promise(resolve=>pending.set(id,resolve)):{leaderId:id,photos:[{fileId:id}],total:1,approvedTotal:1,pendingTotal:0,nextOffset:null},headshotsDownload:async()=>''});
  vm.runInContext(source+'\nthis.initialize=initializeHeadshotsV2;',context);
  await context.initialize(host);
  expect(current.selectedLeader.id).toBe(a);
  await handler({detail:{action:'select-leader',leaderId:b}});
  expect(current.selectedLeader.id).toBe(b);expect(current.photos[0].fileId).toBe(b);expect(location.query.leaderId).toBe(b);
  location.query={leaderId:a};await handler({detail:{action:'location-change'}});
  expect(current.selectedLeader.id).toBe(a);
  pending.set(b,true);const slow=handler({detail:{action:'select-leader',leaderId:b}});
  expect(current.photos).toEqual([]);expect(current.approvedTotal).toBe(0);
  await handler({detail:{action:'directory'}});
  pending.get(b)({photos:[{fileId:b}],total:1,nextOffset:null});await slow;
  expect(current.selectedLeader).toBeNull();expect(current.photos).toEqual([]);
});
