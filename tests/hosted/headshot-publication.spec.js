import { test, expect } from '@playwright/test';
import { approvedPublicInventory, publicWixImageUrl } from '../../hosted/platform/headshot-publication.mjs';

const leaderId = '02a9ab6c-42a6-4568-8b14-f46e0ca08dc2';
const fileId = 'approved-canonical-file-001';
const folderId = 'verified-source-folder-001';
const photo = { fileId, filename: 'Portrait.png', modifiedTime:'2026-06-18T00:00:00.000Z',sourceVersion:'verified-version',sources: [{ folderId, label: 'Both', shared: true }] };
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
