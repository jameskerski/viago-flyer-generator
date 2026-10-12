-- Preserve older duplicate invitations as revoked history; one pending invitation per mailbox.
UPDATE invitations SET status='REVOKED' WHERE module_key='PHOTO_STUDIO' AND status='PENDING'
  AND id NOT IN (SELECT id FROM invitations i WHERE module_key='PHOTO_STUDIO' AND status='PENDING'
    AND id=(SELECT j.id FROM invitations j WHERE j.normalized_email=i.normalized_email AND j.module_key=i.module_key AND j.status='PENDING' ORDER BY j.created_at DESC,j.id DESC LIMIT 1));
CREATE UNIQUE INDEX invitation_pending_mailbox ON invitations(normalized_email,module_key) WHERE status='PENDING';

-- A read model of existing Wix identities, never a second publication authority.
CREATE TABLE headshot_leaders (
  wix_item_id TEXT PRIMARY KEY,
  leader_name TEXT NOT NULL,
  primary_image_source TEXT,
  primary_image_url TEXT,
  source_download_url TEXT,
  candidate_drive_folder_id TEXT,
  verified_drive_folder_id TEXT UNIQUE,
  mapping_state TEXT NOT NULL DEFAULT 'CMS_REFERENCE_UNVERIFIED' CHECK(mapping_state IN ('CMS_REFERENCE_UNVERIFIED','VERIFIED')),
  photo_count INTEGER,
  active INTEGER NOT NULL,
  source_updated_at TEXT,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE headshot_capability_grants (
  user_id TEXT NOT NULL REFERENCES platform_users(id),
  capability TEXT NOT NULL CHECK(capability IN ('HEADSHOT_VIEW','HEADSHOT_UPLOAD','HEADSHOT_MANAGE')),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),
  granted_by_user_id TEXT NOT NULL REFERENCES platform_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,capability)
);
