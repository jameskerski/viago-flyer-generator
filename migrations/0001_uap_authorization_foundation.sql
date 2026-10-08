PRAGMA foreign_keys = ON;

CREATE TABLE platform_users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('INVITED', 'ACTIVE', 'INACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE identity_bindings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES platform_users(id),
  provider TEXT NOT NULL,
  issuer TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  verified_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_authenticated_at TEXT,
  UNIQUE(provider, issuer, provider_subject)
);
CREATE INDEX identity_bindings_email_idx ON identity_bindings(verified_email);

CREATE TABLE module_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES platform_users(id),
  module_key TEXT NOT NULL CHECK (module_key IN ('TEMPLATE_STUDIO', 'PHOTO_STUDIO')),
  role_key TEXT NOT NULL CHECK (role_key IN ('TEMPLATE_ADMIN', 'PHOTO_ADMIN', 'PHOTOGRAPHER')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, module_key)
);

CREATE TABLE event_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES platform_users(id),
  event_id TEXT NOT NULL,
  permission_key TEXT NOT NULL CHECK (permission_key IN ('PHOTO_READ', 'PHOTO_UPLOAD', 'PHOTO_MANAGE')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, event_id, permission_key)
);
CREATE INDEX event_assignments_event_idx ON event_assignments(event_id, status);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  normalized_email TEXT NOT NULL,
  module_key TEXT NOT NULL,
  role_key TEXT NOT NULL,
  event_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CLAIMED', 'EXPIRED', 'REVOKED')),
  expires_at TEXT NOT NULL,
  claimed_by_user_id TEXT REFERENCES platform_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT
);
CREATE INDEX invitations_claim_idx ON invitations(normalized_email, status, expires_at);

CREATE TABLE audit_records (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id TEXT REFERENCES platform_users(id),
  actor_email TEXT,
  module_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  event_id TEXT,
  authorization_outcome TEXT NOT NULL CHECK (authorization_outcome IN ('ALLOWED', 'DENIED')),
  operation_outcome TEXT NOT NULL CHECK (operation_outcome IN ('STARTED', 'SUCCEEDED', 'FAILED')),
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT,
  safe_metadata_json TEXT
);
CREATE INDEX audit_records_actor_idx ON audit_records(actor_user_id, occurred_at);
CREATE INDEX audit_records_event_idx ON audit_records(event_id, occurred_at);

CREATE TABLE operation_state (
  idempotency_key TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES platform_users(id),
  module_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  target_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED')),
  result_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
