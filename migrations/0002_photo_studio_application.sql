PRAGMA foreign_keys = ON;

CREATE TABLE photo_events (
  id TEXT PRIMARY KEY,
  wix_item_id TEXT NOT NULL UNIQUE,
  public_name TEXT NOT NULL,
  series TEXT NOT NULL,
  region TEXT NOT NULL,
  event_year INTEGER NOT NULL,
  artwork_url TEXT,
  gallery_count INTEGER NOT NULL DEFAULT 0,
  photo_count INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL CHECK (sync_status IN ('CONFIRMED', 'AWAITING_RECONCILIATION', 'FAILED')),
  source_fingerprint TEXT,
  source_system TEXT NOT NULL DEFAULT 'WIX_PHOTO_EVENT_YEARS',
  active INTEGER NOT NULL DEFAULT 1,
  last_reconciled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE photo_galleries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES photo_events(id),
  drive_folder_id TEXT NOT NULL UNIQUE,
  public_name TEXT NOT NULL,
  cover_url TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL CHECK (sync_status IN ('CONFIRMED', 'AWAITING_RECONCILIATION', 'FAILED')),
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX photo_galleries_event_idx ON photo_galleries(event_id, active);
