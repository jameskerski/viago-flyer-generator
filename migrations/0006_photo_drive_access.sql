PRAGMA foreign_keys = ON;

CREATE TABLE photo_drive_access_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES platform_users(id),
  event_id TEXT NOT NULL REFERENCES photo_events(id),
  verified_email TEXT NOT NULL,
  drive_folder_id TEXT NOT NULL,
  permission_id TEXT,
  access_role TEXT,
  grant_origin TEXT NOT NULL CHECK (grant_origin IN ('STUDIO_MANAGED','PRE_EXISTING','INHERITED')),
  operation_state TEXT NOT NULL CHECK (operation_state IN ('PENDING_GRANT','VERIFIED','PENDING_REVOCATION','REVOKED','EXTERNAL_ACCESS_REMAINS','FAILED_NEEDS_ATTENTION')),
  inherited_from TEXT,
  safe_error TEXT,
  granted_at TEXT,
  revoked_at TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, event_id)
);
CREATE INDEX photo_drive_access_user_idx ON photo_drive_access_grants(user_id, operation_state);
CREATE INDEX photo_drive_access_event_idx ON photo_drive_access_grants(event_id, operation_state);

CREATE TABLE photo_drive_access_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES platform_users(id),
  event_id TEXT REFERENCES photo_events(id),
  requested_by_user_id TEXT REFERENCES platform_users(id),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('AUDIT','GRANT','REVOKE','VERIFY')),
  operation_state TEXT NOT NULL CHECK (operation_state IN ('REQUESTED','SUCCEEDED','FAILED_NEEDS_ATTENTION')),
  permission_id TEXT,
  safe_result_json TEXT,
  safe_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX photo_drive_access_operations_user_idx ON photo_drive_access_operations(user_id, created_at);
