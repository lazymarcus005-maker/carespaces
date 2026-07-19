DROP TABLE IF EXISTS platform.inbox_message;

DROP INDEX IF EXISTS platform.outbox_event_aggregate_idx;
DROP INDEX IF EXISTS platform.outbox_event_claim_idx;

ALTER TABLE platform.outbox_event
  DROP COLUMN IF EXISTS dead_lettered_at,
  DROP COLUMN IF EXISTS last_error,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS lease_id,
  DROP COLUMN IF EXISTS next_attempt_at,
  DROP COLUMN IF EXISTS attempts,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS event_version,
  DROP COLUMN IF EXISTS tenant_id;
