PRAGMA foreign_keys = ON;

CREATE TABLE photo_gallery_cover_selections (
  gallery_folder_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES photo_events(id),
  selected_file_id TEXT NOT NULL,
  selected_by_user_id TEXT NOT NULL REFERENCES platform_users(id),
  selected_by_email TEXT NOT NULL,
  selection_state TEXT NOT NULL CHECK (selection_state IN ('SYNC_PENDING', 'CONFIRMED', 'INVALID_FALLBACK')),
  selected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX photo_gallery_cover_selections_event_idx ON photo_gallery_cover_selections(event_id, selection_state);
