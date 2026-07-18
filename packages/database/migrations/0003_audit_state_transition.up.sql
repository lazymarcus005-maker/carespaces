CREATE TABLE platform.state_transition (
  id uuid PRIMARY KEY,
  tenant_id uuid,
  actor_user_id uuid,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  from_state text,
  to_state text NOT NULL,
  reason_code text,
  correlation_id text NOT NULL,
  expected_version integer,
  resulting_version integer NOT NULL CHECK (resulting_version > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX state_transition_tenant_time_idx ON platform.state_transition(tenant_id, occurred_at);
CREATE INDEX state_transition_subject_idx ON platform.state_transition(subject_type, subject_id, occurred_at);
CREATE INDEX state_transition_correlation_idx ON platform.state_transition(correlation_id);

GRANT INSERT ON platform.state_transition TO carespaces_app;
REVOKE SELECT, UPDATE, DELETE ON platform.state_transition FROM carespaces_app;
