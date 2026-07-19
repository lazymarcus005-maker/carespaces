CREATE TABLE operations.ops_queue_membership (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.user_account(id),
  queue text NOT NULL CHECK (queue IN (
    'VERIFICATION', 'CLINICAL', 'URGENT', 'INCIDENT', 'REPLACEMENT',
    'DISPUTE', 'FINANCE', 'GENERAL'
  )),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  assigned_by_user_id uuid REFERENCES iam.user_account(id),
  assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CONSTRAINT ops_queue_membership_unique UNIQUE (user_id, queue),
  CONSTRAINT ops_queue_membership_revocation_check CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL) OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);
CREATE INDEX ops_queue_membership_queue_idx
  ON operations.ops_queue_membership(queue, status, user_id);

CREATE FUNCTION operations.resolve_actor_access(
  identity_provider_input text,
  identity_subject_input text
)
RETURNS TABLE (user_id uuid, role text, queue text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT account.id, assignment.role, membership.queue
  FROM iam.user_account account
  JOIN iam.role_assignment assignment
    ON assignment.user_id = account.id
   AND assignment.scope_type = 'PLATFORM'
   AND assignment.tenant_id IS NULL
   AND assignment.effective_at <= clock_timestamp()
   AND (assignment.expires_at IS NULL OR assignment.expires_at > clock_timestamp())
   AND assignment.revoked_at IS NULL
  JOIN operations.ops_queue_membership membership
    ON membership.user_id = account.id
   AND membership.status = 'ACTIVE'
  WHERE account.identity_provider = identity_provider_input
    AND account.identity_subject = identity_subject_input
    AND account.status = 'ACTIVE'
$$;

REVOKE ALL ON FUNCTION operations.resolve_actor_access(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operations.resolve_actor_access(text, text) TO carespaces_app;
