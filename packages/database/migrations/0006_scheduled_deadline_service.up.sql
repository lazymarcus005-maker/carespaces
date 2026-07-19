CREATE TABLE platform.scheduled_deadline (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  tenant_id uuid,
  deadline_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  command_type text NOT NULL,
  expected_state text,
  expected_version integer CHECK (expected_version IS NULL OR expected_version >= 0),
  policy_version text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  correlation_id text NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED', 'LEASED', 'FIRED', 'CANCELLED', 'DEAD_LETTER')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL,
  lease_id uuid,
  lease_expires_at timestamptz,
  fired_at timestamptz,
  cancelled_at timestamptz,
  last_error text,
  dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX scheduled_deadline_claim_idx
  ON platform.scheduled_deadline(next_attempt_at, due_at)
  WHERE status IN ('SCHEDULED', 'LEASED') AND dead_lettered_at IS NULL;
CREATE INDEX scheduled_deadline_subject_idx
  ON platform.scheduled_deadline(subject_type, subject_id, due_at);
CREATE INDEX scheduled_deadline_operations_idx
  ON platform.scheduled_deadline(status, due_at);

GRANT SELECT, INSERT, UPDATE ON platform.scheduled_deadline TO carespaces_app;
