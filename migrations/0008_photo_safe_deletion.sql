PRAGMA foreign_keys = ON;

CREATE TABLE photo_removal_operations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES platform_users(id),
  requested_by_email TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES photo_events(id),
  gallery_folder_id TEXT NOT NULL,
  canonical_file_id TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  operation_state TEXT NOT NULL CHECK (operation_state IN ('VALIDATED','DRIVE_TRASHED','SYNC_PENDING','FAILED_NEEDS_ATTENTION')),
  safe_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX photo_removal_event_idx ON photo_removal_operations(event_id, created_at);

CREATE TABLE photo_gallery_deletion_operations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES platform_users(id),
  requested_by_email TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES photo_events(id),
  gallery_folder_id TEXT NOT NULL,
  gallery_name TEXT NOT NULL,
  confirmed_photo_count INTEGER NOT NULL,
  creator_user_id TEXT,
  operation_state TEXT NOT NULL CHECK (operation_state IN ('VALIDATED','DRIVE_TRASHED','SYNC_PENDING','FAILED_NEEDS_ATTENTION')),
  safe_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX photo_gallery_deletion_event_idx ON photo_gallery_deletion_operations(event_id, created_at);
