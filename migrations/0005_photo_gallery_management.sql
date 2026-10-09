PRAGMA foreign_keys = ON;

CREATE TABLE photo_gallery_operations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES platform_users(id),
  requested_by_email TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES photo_events(id),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('CREATE', 'RENAME', 'SET_COVER')),
  operation_state TEXT NOT NULL CHECK (operation_state IN ('VALIDATED', 'DRIVE_CONFIRMED', 'SYNC_PENDING', 'CONFIRMED', 'FAILED_NEEDS_ATTENTION')),
  gallery_folder_id TEXT,
  requested_name TEXT,
  cover_file_id TEXT,
  drive_folder_url TEXT,
  safe_error_code TEXT,
  safe_error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TEXT
);
CREATE INDEX photo_gallery_operations_event_idx ON photo_gallery_operations(event_id, created_at);
CREATE INDEX photo_gallery_operations_state_idx ON photo_gallery_operations(operation_state, updated_at);

