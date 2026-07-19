ALTER TABLE platform.outbox_event
  ADD COLUMN tenant_id uuid,
  ADD COLUMN event_version integer NOT NULL DEFAULT 1 CHECK (event_version > 0),
  ADD COLUMN status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'LEASED', 'PUBLISHED', 'DEAD_LETTER')),
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN lease_id uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN last_error text,
  ADD COLUMN dead_lettered_at timestamptz;

CREATE INDEX outbox_event_claim_idx
  ON platform.outbox_event(next_attempt_at, occurred_at)
  WHERE status IN ('PENDING', 'LEASED') AND dead_lettered_at IS NULL;
CREATE INDEX outbox_event_aggregate_idx
  ON platform.outbox_event(aggregate_type, aggregate_id, occurred_at);

CREATE TABLE platform.inbox_message (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  message_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  correlation_id text NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED', 'PROCESSING', 'APPLIED', 'DEAD_LETTER')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_id uuid,
  lease_expires_at timestamptz,
  processed_at timestamptz,
  last_error text,
  dead_lettered_at timestamptz,
  CONSTRAINT inbox_message_source_message_unique UNIQUE (source, message_id)
);

CREATE INDEX inbox_message_claim_idx
  ON platform.inbox_message(next_attempt_at, received_at)
  WHERE status IN ('RECEIVED', 'PROCESSING') AND dead_lettered_at IS NULL;
CREATE INDEX inbox_message_correlation_idx ON platform.inbox_message(correlation_id);

GRANT SELECT, INSERT, UPDATE ON platform.inbox_message TO carespaces_app;
