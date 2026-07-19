CREATE SCHEMA IF NOT EXISTS operations;

CREATE TABLE operations.ops_task (
  id uuid PRIMARY KEY,
  tenant_id uuid,
  task_type text NOT NULL CHECK (task_type ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  subject_type text NOT NULL CHECK (subject_type IN (
    'provider', 'credential', 'job', 'assignment', 'shift', 'incident',
    'replacement_request', 'dispute', 'payment', 'payout', 'reconciliation',
    'notification', 'scheduled_deadline', 'system'
  )),
  subject_id uuid NOT NULL,
  queue text NOT NULL CHECK (queue IN (
    'VERIFICATION', 'CLINICAL', 'URGENT', 'INCIDENT', 'REPLACEMENT',
    'DISPUTE', 'FINANCE', 'GENERAL'
  )),
  priority text NOT NULL CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  owner_user_id uuid REFERENCES iam.user_account(id),
  due_at timestamptz,
  escalation_level integer NOT NULL DEFAULT 0 CHECK (escalation_level >= 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLAIMED', 'RESOLVED', 'CANCELLED')),
  resolution_code text CHECK (resolution_code IS NULL OR resolution_code ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  source_dedupe_key text NOT NULL UNIQUE,
  created_by_user_id uuid REFERENCES iam.user_account(id),
  created_by_system text,
  resolved_by_user_id uuid REFERENCES iam.user_account(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  CONSTRAINT ops_task_creator_check CHECK (
    (created_by_user_id IS NOT NULL)::integer +
    (created_by_system IS NOT NULL)::integer = 1
  ),
  CONSTRAINT ops_task_owner_state_check CHECK (
    (status = 'OPEN' AND owner_user_id IS NULL) OR
    (status IN ('CLAIMED', 'RESOLVED') AND owner_user_id IS NOT NULL) OR
    status = 'CANCELLED'
  ),
  CONSTRAINT ops_task_resolution_check CHECK (
    (status = 'RESOLVED' AND resolution_code IS NOT NULL AND resolved_at IS NOT NULL) OR
    (status <> 'RESOLVED' AND resolution_code IS NULL AND resolved_at IS NULL)
  )
);

CREATE INDEX ops_task_queue_work_idx
  ON operations.ops_task(queue, priority, due_at, created_at)
  WHERE status IN ('OPEN', 'CLAIMED');
CREATE INDEX ops_task_owner_work_idx
  ON operations.ops_task(owner_user_id, status, due_at);
CREATE INDEX ops_task_subject_idx
  ON operations.ops_task(subject_type, subject_id, created_at);

GRANT USAGE ON SCHEMA operations TO carespaces_app;
GRANT SELECT, INSERT, UPDATE ON operations.ops_task TO carespaces_app;
