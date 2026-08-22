CREATE TABLE IF NOT EXISTS woyengi_schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS woyengi_workspace_sequences (
  workspace_id text PRIMARY KEY,
  next_sequence bigint NOT NULL CHECK (next_sequence >= 1)
);

CREATE TABLE IF NOT EXISTS woyengi_canonical_records (
  record_id text PRIMARY KEY,
  workspace_id text NOT NULL,
  kind text NOT NULL,
  ledger_sequence bigint NOT NULL CHECK (ledger_sequence >= 1),
  transaction_time timestamptz NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE (workspace_id, ledger_sequence)
);

CREATE INDEX IF NOT EXISTS woyengi_canonical_records_workspace_time
  ON woyengi_canonical_records (workspace_id, transaction_time, ledger_sequence);

CREATE INDEX IF NOT EXISTS woyengi_canonical_records_kind
  ON woyengi_canonical_records (kind, workspace_id, ledger_sequence);

CREATE TABLE IF NOT EXISTS woyengi_idempotency_results (
  idempotency_id text PRIMARY KEY,
  workspace_id text NOT NULL,
  principal_id text NOT NULL,
  family text NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  recorded_at timestamptz NOT NULL,
  UNIQUE (principal_id, family, idempotency_key)
);

INSERT INTO woyengi_schema_migrations (version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;
