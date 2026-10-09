PRAGMA foreign_keys = ON;

CREATE TABLE photo_event_creation_operations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES platform_users(id),
  requested_by_email TEXT NOT NULL,
  operation_state TEXT NOT NULL CHECK (operation_state IN (
    'REQUESTED', 'VALIDATED', 'DRIVE_ROOT_CREATED', 'WIX_EVENT_REGISTERED',
    'VERIFIED', 'READY_FOR_PUBLICATION', 'FAILED_NEEDS_ATTENTION'
  )),
  event_name TEXT NOT NULL,
  event_series TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  event_year INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  location TEXT NOT NULL DEFAULT '',
  artwork_url TEXT NOT NULL DEFAULT '',
  drive_parent_key TEXT,
  drive_root_folder_id TEXT UNIQUE,
  drive_root_url TEXT,
  wix_item_id TEXT UNIQUE,
  safe_error_code TEXT,
  safe_error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT
);

CREATE INDEX photo_event_creation_state_idx
  ON photo_event_creation_operations(operation_state, updated_at);
CREATE INDEX photo_event_creation_actor_idx
  ON photo_event_creation_operations(requested_by_user_id, created_at);
