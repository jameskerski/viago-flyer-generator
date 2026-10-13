-- Extend the existing Wix-keyed read model; no replacement authority or table.
ALTER TABLE headshot_leaders ADD COLUMN mapping_status TEXT NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE headshot_leaders ADD COLUMN mapping_evidence_json TEXT NOT NULL DEFAULT '{}';
