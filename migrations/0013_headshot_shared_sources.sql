-- Canonical many-to-many source relationships in the existing D1 database.
-- Legacy folder columns remain compatibility caches, not new mapping authorities.
CREATE TABLE headshot_photo_sources (
  folder_id TEXT PRIMARY KEY,
  display_label TEXT NOT NULL,
  verification_state TEXT NOT NULL DEFAULT 'PENDING' CHECK(verification_state IN ('PENDING','VERIFIED','INACCESSIBLE','MISSING','AMBIGUOUS')),
  photo_inventory_json TEXT NOT NULL DEFAULT '[]',
  source_fingerprint TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE headshot_leader_sources (
  wix_item_id TEXT NOT NULL REFERENCES headshot_leaders(wix_item_id),
  folder_id TEXT NOT NULL REFERENCES headshot_photo_sources(folder_id),
  relationship_type TEXT NOT NULL CHECK(relationship_type IN ('INDIVIDUAL','SHARED')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
  PRIMARY KEY(wix_item_id,folder_id)
);
CREATE TABLE headshot_source_access_grants (
  user_id TEXT NOT NULL REFERENCES platform_users(id),
  folder_id TEXT NOT NULL REFERENCES headshot_photo_sources(folder_id),
  permission_id TEXT,
  access_role TEXT,
  verified_email TEXT NOT NULL,
  grant_origin TEXT NOT NULL CHECK(grant_origin IN ('STUDIO_MANAGED','PRE_EXISTING','INHERITED')),
  operation_state TEXT NOT NULL,
  safe_error TEXT,
  PRIMARY KEY(user_id,folder_id)
);

INSERT INTO headshot_photo_sources(folder_id,display_label,verification_state,photo_inventory_json,source_fingerprint,evidence_json)
SELECT verified_drive_folder_id,leader_name,'VERIFIED',photo_inventory_json,source_fingerprint,mapping_evidence_json
FROM headshot_leaders WHERE mapping_status='VERIFIED' AND verified_drive_folder_id IS NOT NULL;
INSERT INTO headshot_leader_sources(wix_item_id,folder_id,relationship_type)
SELECT wix_item_id,verified_drive_folder_id,'INDIVIDUAL'
FROM headshot_leaders WHERE mapping_status='VERIFIED' AND verified_drive_folder_id IS NOT NULL;
INSERT INTO headshot_source_access_grants(user_id,folder_id,permission_id,access_role,verified_email,grant_origin,operation_state,safe_error)
SELECT user_id,drive_folder_id,permission_id,access_role,verified_email,grant_origin,operation_state,safe_error
FROM headshot_drive_access_grants WHERE drive_folder_id IN (SELECT folder_id FROM headshot_photo_sources);
