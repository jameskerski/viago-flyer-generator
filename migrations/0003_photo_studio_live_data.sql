PRAGMA foreign_keys = ON;

ALTER TABLE photo_events ADD COLUMN all_photos_url TEXT;
ALTER TABLE photo_events ADD COLUMN sync_error TEXT;
ALTER TABLE photo_events ADD COLUMN source_reconciled_at TEXT;

ALTER TABLE photo_galleries ADD COLUMN destination_url TEXT;
ALTER TABLE photo_galleries ADD COLUMN cover_file_id TEXT;
ALTER TABLE photo_galleries ADD COLUMN cover_source TEXT;
ALTER TABLE photo_galleries ADD COLUMN source_folder_name TEXT;
ALTER TABLE photo_galleries ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE photo_galleries ADD COLUMN last_reconciled_at TEXT;

CREATE TABLE photo_permission_profiles (
  user_id TEXT PRIMARY KEY REFERENCES platform_users(id),
  preset_key TEXT NOT NULL CHECK (preset_key IN ('ASSIGNED', 'GENERAL', 'LEAD')),
  event_scope TEXT NOT NULL CHECK (event_scope IN ('ASSIGNED_ONLY', 'ALL_CURRENT', 'ALL_CURRENT_FUTURE')),
  capabilities_json TEXT NOT NULL,
  updated_by_user_id TEXT REFERENCES platform_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE media_asset_collections (
  id TEXT PRIMARY KEY,
  source_collection_id TEXT NOT NULL UNIQUE,
  public_name TEXT NOT NULL,
  public_destination TEXT,
  source_system TEXT NOT NULL,
  sync_status TEXT NOT NULL CHECK (sync_status IN ('CONFIRMED', 'SOURCE_UNAVAILABLE', 'FAILED')),
  item_count INTEGER NOT NULL DEFAULT 0,
  last_reconciled_at TEXT,
  safe_metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO media_asset_collections
  (id, source_collection_id, public_name, public_destination, source_system, sync_status, safe_metadata_json)
VALUES
  ('leader-headshots', 'LEADER_HEADSHOTS', 'Leader Headshots', '/blank-2-1-1', 'WIX_CMS', 'SOURCE_UNAVAILABLE',
   '{"authority":"LEADER_HEADSHOTS","fields":["leaderName","headshotImage","downloadUrl","active"],"driveRootVerified":false}');

CREATE TABLE source_sync_receipts (
  idempotency_key TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  operation_outcome TEXT NOT NULL CHECK (operation_outcome IN ('SUCCEEDED', 'FAILED')),
  gallery_count INTEGER NOT NULL DEFAULT 0,
  photo_count INTEGER NOT NULL DEFAULT 0,
  safe_error TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX source_sync_receipts_event_idx ON source_sync_receipts(source_event_id, received_at);

