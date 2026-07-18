CREATE VIEW platform.audit_timeline AS
SELECT
  'AUDIT_EVENT'::text AS record_type,
  id,
  tenant_id,
  actor_user_id,
  action,
  subject_type,
  subject_id,
  NULL::text AS from_state,
  NULL::text AS to_state,
  reason_code,
  correlation_id,
  NULL::integer AS expected_version,
  NULL::integer AS resulting_version,
  metadata,
  occurred_at
FROM platform.audit_event
UNION ALL
SELECT
  'STATE_TRANSITION'::text AS record_type,
  id,
  tenant_id,
  actor_user_id,
  NULL::text AS action,
  subject_type,
  subject_id,
  from_state,
  to_state,
  reason_code,
  correlation_id,
  expected_version,
  resulting_version,
  metadata,
  occurred_at
FROM platform.state_transition;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'carespaces_audit_reader') THEN
    GRANT USAGE ON SCHEMA platform TO carespaces_audit_reader;
    GRANT SELECT ON platform.audit_timeline TO carespaces_audit_reader;
    REVOKE INSERT, UPDATE, DELETE ON platform.audit_event, platform.state_transition FROM carespaces_audit_reader;
  END IF;
END
$$;
