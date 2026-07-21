CREATE SCHEMA IF NOT EXISTS notifications;

CREATE TABLE notifications.notification_template (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  notification_class text NOT NULL CHECK (notification_class IN (
    'incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed',
    'shift_reminder', 'reservation_expiry', 'payment_expiry',
    'customer_approval_reminder', 'dispute_update', 'payout_retry',
    'system'
  )),
  channel text NOT NULL CHECK (channel IN ('push', 'sms', 'email', 'in_app')),
  display_name text NOT NULL,
  body_template text NOT NULL,
  is_critical boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT template_critical_class_check CHECK (
    (is_critical = true AND notification_class IN (
      'incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed'
    )) OR is_critical = false
  )
);

CREATE TABLE notifications.notification_intent (
  id uuid PRIMARY KEY,
  tenant_id uuid,
  template_id uuid NOT NULL REFERENCES notifications.notification_template(id),
  notification_class text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('push', 'sms', 'email', 'in_app')),
  subject_type text NOT NULL CHECK (subject_type IN (
    'incident', 'shift', 'assignment', 'credential', 'replacement_request',
    'payment', 'payout', 'reconciliation', 'dispute', 'ops_task', 'system'
  )),
  subject_id uuid NOT NULL,
  recipient_user_id uuid REFERENCES iam.user_account(id),
  recipient_ref text NOT NULL,
  body_redacted text NOT NULL,
  correlation_id text NOT NULL,
  source_dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'LEASED', 'DELIVERED', 'TERMINAL_FAILED', 'CANCELLED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_id uuid,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  terminal_failed_at timestamptz,
  cancelled_at timestamptz,
  last_error text,
  acknowledged_at timestamptz,
  ops_task_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT intent_terminal_check CHECK (
    (status = 'DELIVERED' AND delivered_at IS NOT NULL) OR
    (status = 'TERMINAL_FAILED' AND terminal_failed_at IS NOT NULL) OR
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL) OR
    status IN ('PENDING', 'LEASED')
  ),
  CONSTRAINT intent_no_early_ack_check CHECK (
    acknowledged_at IS NULL
  )
);

CREATE INDEX notification_intent_claim_idx
  ON notifications.notification_intent(next_attempt_at, notifications.due_priority(notification_class))
  WHERE status IN ('PENDING', 'LEASED') AND terminal_failed_at IS NULL;
CREATE INDEX notification_intent_subject_idx
  ON notifications.notification_intent(subject_type, subject_id, created_at);
CREATE INDEX notification_intent_recipient_idx
  ON notifications.notification_intent(recipient_user_id, status);
CREATE INDEX notification_intent_class_idx
  ON notifications.notification_intent(notification_class, status);

CREATE FUNCTION notifications.due_priority(input_class text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN input_class IN ('incident_ack','sos','credential_expiry_block','replacement_failed') THEN 1
    WHEN input_class IN ('reservation_expiry','payment_expiry','payout_retry') THEN 2
    ELSE 3
  END
$$;

CREATE TABLE notifications.notification_delivery_attempt (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES notifications.notification_intent(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  channel text NOT NULL,
  adapter_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('FIRED', 'FAILED', 'DEAD_LETTER')),
  provider_message_ref text,
  error_class text,
  error_message text,
  lease_id uuid,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT attempt_completion_check CHECK (
    (status = 'FIRED' AND completed_at IS NOT NULL AND provider_message_ref IS NOT NULL) OR
    (status = 'FAILED' AND completed_at IS NOT NULL) OR
    (status = 'DEAD_LETTER' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX notification_delivery_attempt_intent_idx
  ON notifications.notification_delivery_attempt(intent_id, attempt_number);

CREATE TABLE notifications.notification_user_preference (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.user_account(id),
  notification_class text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('push', 'sms', 'email', 'in_app')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT user_preference_unique UNIQUE (user_id, notification_class, channel),
  CONSTRAINT user_preference_critical_immutable_check CHECK (
    notification_class NOT IN (
      'incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed'
    )
  )
);

CREATE INDEX notification_user_preference_user_idx
  ON notifications.notification_user_preference(user_id, notification_class);

CREATE TABLE notifications.notification_dead_letter_evidence (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES notifications.notification_intent(id),
  final_attempt_id uuid NOT NULL REFERENCES notifications.notification_delivery_attempt(id),
  reason_code text NOT NULL,
  error_class text,
  error_message text,
  ops_task_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX notification_dlq_evidence_intent_idx
  ON notifications.notification_dead_letter_evidence(intent_id);

CREATE FUNCTION notifications.is_critical_class(input_class text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT input_class IN (
    'incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed'
  )
$$;

GRANT USAGE ON SCHEMA notifications TO carespaces_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA notifications TO carespaces_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA notifications TO carespaces_app;