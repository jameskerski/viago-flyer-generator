import { publicLeaderPhotos, publicPrimaryDirectory, publicLeaderImage, MAX_PUBLIC_IMAGE_BYTES } from './headshot-publication.mjs';
import { reconcileSharedHeadshotSnapshot } from './headshot-sources.mjs';

async function verifyPublicSource(database,env,id) {
  const row=await database.prepare(`SELECT l.active,p.file_id FROM headshot_leaders l JOIN headshot_public_photos p ON p.wix_item_id=l.wix_item_id WHERE l.wix_item_id=? AND l.active=1 AND p.approval_state='APPROVED' LIMIT 1`).bind(id).first();
  if(!row) throw new Error('not_public');
  const check=await database.prepare('SELECT * FROM headshot_public_checks WHERE wix_item_id=?').bind(id).first();
  if(check?.check_state==='AVAILABLE' && Date.parse(check.checked_at.replace(' ','T')+'Z')>Date.now()-300000) return;
  if(check?.check_state==='UNAVAILABLE' && Date.parse(check.checked_at.replace(' ','T')+'Z')>Date.now()-60000) throw new Error('source_unavailable');
  const claim=await database.prepare(`INSERT INTO headshot_public_checks(wix_item_id,check_state,lease_until) VALUES(?,'CHECKING',datetime('now','+1 minute')) ON CONFLICT(wix_item_id) DO UPDATE SET check_state='CHECKING',lease_until=excluded.lease_until WHERE lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP`).bind(id).run();
  if(!(claim.meta?.changes||claim.changes)) throw new Error('source_check_in_progress');
  let phase='configuration';
  try {
    if(!env.PHOTO_EVENT_PROVISION_ENDPOINT||!env.PHOTO_STUDIO_SYNC_SECRET) throw new Error('source_configuration_missing');
    phase='source_fetch';
    const response=await fetch(env.PHOTO_EVENT_PROVISION_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'HEADSHOT_VERIFY_SOURCES',operationId:'headshot-'+crypto.randomUUID(),wixItemId:id,token:env.PHOTO_STUDIO_SYNC_SECRET}),signal:AbortSignal.timeout(15000)});
    phase='source_response';
    if(!response.ok) throw new Error('source_unavailable');
    const snapshot=await response.json();
    phase='source_contract';
    if(snapshot.success!==true || snapshot.wixItemId!==id || snapshot.active!==true || snapshot.sourceContractVersion!==3) throw new Error('source_unavailable');
    phase='source_persistence';
    await reconcileSharedHeadshotSnapshot(database,snapshot);
    await database.prepare(`UPDATE headshot_public_checks SET check_state='AVAILABLE',checked_at=CURRENT_TIMESTAMP,lease_until=NULL WHERE wix_item_id=?`).bind(id).run();
  } catch(error) {
    console.warn('HEADSHOTS_PUBLIC_SOURCE_CHECK_FAILED',phase,error?.name==='TimeoutError'?'deadline':'verification');
    await database.prepare(`UPDATE headshot_public_checks SET check_state='UNAVAILABLE',checked_at=CURRENT_TIMESTAMP,lease_until=NULL WHERE wix_item_id=?`).bind(id).run();
    throw error;
  }
}

export async function publicHeadshotApi(request,env) {
  const headers={'Cache-Control':'no-store','Access-Control-Allow-Origin':'https://www.goodlifetrainings.com','X-Content-Type-Options':'nosniff'};
  if(request.method!=='GET') return Response.json({error:'method_not_allowed'},{status:405,headers});
  if(env.PHOTO_PUBLIC_HEADSHOTS_ENABLED!=='true') return Response.json({error:'not_available'},{status:404,headers});
  const url=new URL(request.url);
  const imageMatch=url.pathname.match(/^\/public\/headshots\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{10,160})$/i);
  if(imageMatch) {
    const variant=url.searchParams.get('variant')||'960';
    const download=url.searchParams.get('download')==='1';
    if([...url.searchParams.keys()].some(key=>key!=='variant'&&key!=='download') || url.searchParams.getAll('variant').length>1 || url.searchParams.getAll('download').length>1 || (url.searchParams.has('download')&&!download) || (download&&url.searchParams.has('variant')) || !['240','480','960','1280'].includes(variant)) return Response.json({error:'not_found'},{status:404,headers});
    try {
      await verifyPublicSource(env.PLATFORM_DB,env,imageMatch[1]);
      const photo=await publicLeaderImage(env.PLATFORM_DB,imageMatch[1],imageMatch[2]);
      if(download) {
        // Fetch only the bounded derivative already admitted by the ingestion
        // contract, never an original or a caller-supplied address.
        const source=await fetch(photo.displayUrl,{redirect:'manual',signal:AbortSignal.timeout(15000)});
        const type=(source.headers.get('content-type')||'').split(';')[0];
        if(!source.ok || !['image/png','image/jpeg'].includes(type) || Number(source.headers.get('content-length'))>MAX_PUBLIC_IMAGE_BYTES) throw new Error('download_unavailable');
        const reader=source.body.getReader();let length=0;const chunks=[];
        try { for(;;) { const part=await reader.read();if(part.done) break;length+=part.value.byteLength;if(length>MAX_PUBLIC_IMAGE_BYTES) throw new Error('download_exceeds_bound');chunks.push(part.value); } }
        finally { await reader.cancel(); }
        if(length<24) throw new Error('download_empty');
        const bytes=new Uint8Array(length);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}
        const filename=String(photo.downloadFilename||'headshot.jpg').replace(/[^a-zA-Z0-9_. -]/g,'_').slice(0,160);
        return new Response(bytes,{headers:{...headers,'Content-Type':type,'Content-Length':String(length),'Content-Disposition':`attachment; filename="${filename}"`}});
      }
      const mediaName=photo.displayUrl.split('/').pop();
      // The stable, no-store gateway rechecks publication on every request.
      // Only the already bounded, approved, versioned Wix derivative is exposed;
      // Wix CDN serves/caches its bytes directly rather than another full proxy.
      return new Response(null,{status:302,headers:{...headers,Location:`${photo.displayUrl}/v1/fit/w_${variant},h_${Math.round(Number(variant)*1.4)},q_85,enc_auto/${mediaName}`}});
    } catch (_) { return Response.json({error:'not_found'},{status:404,headers}); }
  }
  if(url.pathname==='/public/headshots/directory' && !url.search) return Response.json({leaders:await publicPrimaryDirectory(env.PLATFORM_DB)},{headers});
  const match=url.pathname.match(/^\/public\/headshots\/([a-f0-9-]{36})$/i);
  if(!match || [...url.searchParams.keys()].some(key=>key!=='offset')) return Response.json({error:'not_found'},{status:404,headers});
  try {
    await verifyPublicSource(env.PLATFORM_DB,env,match[1]);
    const result=await publicLeaderPhotos(env.PLATFORM_DB,match[1],Number(url.searchParams.get('offset')||0));
    return Response.json({...result,photos:result.photos.map(photo=>({...photo,displayUrl:`${url.origin}/public/headshots/${match[1]}/${photo.fileId}`}))},{headers});
  } catch (_) { return Response.json({error:'not_found'},{status:404,headers}); }
}
