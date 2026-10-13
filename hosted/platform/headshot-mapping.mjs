const statuses = new Set(['VERIFIED','AMBIGUOUS','MISSING','INACCESSIBLE']);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;

export async function applyHeadshotMappingAudit(database,row,snapshot) {
  if(snapshot.wixItemId!==row.wix_item_id) throw new Error('leader_identity_mismatch');
  let status=snapshot.mappingStatus||'VERIFIED';
  if(!statuses.has(status)) throw new Error('invalid_mapping_status');
  const evidence={...(snapshot.mappingEvidence||{})};
  if(status==='VERIFIED' && snapshot.folderId!==row.candidate_drive_folder_id && snapshot.folderId!==row.verified_drive_folder_id) {
    status='AMBIGUOUS';evidence.reason='leader_folder_changed_requires_review';
  }
  const json=JSON.stringify(stable(evidence));
  if(row.mapping_status===status&&row.mapping_evidence_json===json) return {status,changed:false};
  await database.prepare(`UPDATE headshot_leaders SET mapping_status=?,mapping_evidence_json=?,mapping_state=CASE WHEN ?='VERIFIED' AND verified_drive_folder_id=? THEN 'VERIFIED' WHEN ?!='VERIFIED' THEN 'CMS_REFERENCE_UNVERIFIED' ELSE mapping_state END WHERE wix_item_id=?`).bind(status,json,status,snapshot.folderId||'',status,row.wix_item_id).run();
  return {status,changed:true};
}
