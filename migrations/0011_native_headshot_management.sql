ALTER TABLE headshot_leaders ADD COLUMN photo_inventory_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE headshot_leaders ADD COLUMN source_fingerprint TEXT;
ALTER TABLE headshot_leaders ADD COLUMN primary_drive_file_id TEXT;
ALTER TABLE headshot_leaders ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'AWAITING_DISCOVERY';
ALTER TABLE headshot_leaders ADD COLUMN sync_error TEXT;
CREATE TABLE headshot_leader_assignments (
  user_id TEXT NOT NULL REFERENCES platform_users(id),
  wix_item_id TEXT NOT NULL REFERENCES headshot_leaders(wix_item_id),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),
  capabilities_json TEXT NOT NULL DEFAULT '["HEADSHOT_VIEW"]',
  updated_by_user_id TEXT NOT NULL REFERENCES platform_users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,wix_item_id)
);
CREATE TABLE headshot_operations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  wix_item_id TEXT NOT NULL REFERENCES headshot_leaders(wix_item_id),
  operation_type TEXT NOT NULL CHECK(operation_type IN ('CREATE_FOLDER','SET_PRIMARY','REMOVE_PHOTO')),
  requested_by_user_id TEXT NOT NULL REFERENCES platform_users(id),
  requested_by_email TEXT NOT NULL,
  request_json TEXT NOT NULL,
  operation_state TEXT NOT NULL CHECK(operation_state IN ('VALIDATED','DRIVE_CONFIRMED','WIX_CONFIRMED','CONFIRMED','FAILED_NEEDS_ATTENTION')),
  result_json TEXT,
  safe_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE headshot_drive_access_grants (
  user_id TEXT NOT NULL REFERENCES platform_users(id),
  wix_item_id TEXT NOT NULL REFERENCES headshot_leaders(wix_item_id),
  drive_folder_id TEXT NOT NULL,
  permission_id TEXT,
  access_role TEXT,
  verified_email TEXT NOT NULL,
  grant_origin TEXT NOT NULL CHECK(grant_origin IN ('STUDIO_MANAGED','PRE_EXISTING','INHERITED')),
  operation_state TEXT NOT NULL,
  safe_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,wix_item_id)
);
