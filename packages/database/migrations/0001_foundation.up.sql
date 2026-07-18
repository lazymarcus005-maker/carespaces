CREATE SCHEMA IF NOT EXISTS iam;

CREATE TYPE iam.tenant_type AS ENUM ('FAMILY', 'ORGANIZATION');
CREATE TYPE iam.tenant_status AS ENUM ('ACTIVE', 'RESTRICTED', 'ARCHIVED');
CREATE TYPE iam.user_status AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');
CREATE TYPE iam.membership_status AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');

CREATE TABLE iam.user_account (
  id uuid PRIMARY KEY,
  identity_provider text NOT NULL,
  identity_subject text NOT NULL,
  status iam.user_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT user_account_identity_unique UNIQUE (identity_provider, identity_subject)
);

CREATE TABLE iam.tenant (
  id uuid PRIMARY KEY,
  type iam.tenant_type NOT NULL DEFAULT 'FAMILY',
  status iam.tenant_status NOT NULL DEFAULT 'ACTIVE',
  display_name text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES iam.user_account(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE iam.tenant_membership (
  tenant_id uuid NOT NULL REFERENCES iam.tenant(id),
  user_id uuid NOT NULL REFERENCES iam.user_account(id),
  status iam.membership_status NOT NULL DEFAULT 'INVITED',
  relationship_label text,
  invited_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX tenant_membership_user_idx ON iam.tenant_membership(user_id);

CREATE TABLE iam.role_assignment (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.user_account(id),
  tenant_id uuid REFERENCES iam.tenant(id),
  scope_type text NOT NULL CHECK (scope_type IN ('PLATFORM', 'TENANT', 'RESOURCE')),
  role text NOT NULL,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  granted_by_user_id uuid REFERENCES iam.user_account(id),
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES iam.user_account(id),
  CHECK ((scope_type = 'PLATFORM' AND tenant_id IS NULL) OR scope_type <> 'PLATFORM')
);
CREATE INDEX role_assignment_user_idx ON iam.role_assignment(user_id);
CREATE INDEX role_assignment_tenant_idx ON iam.role_assignment(tenant_id);

CREATE TABLE platform.audit_event (
  id uuid PRIMARY KEY,
  tenant_id uuid,
  actor_user_id uuid,
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  reason_code text,
  correlation_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_event_tenant_time_idx ON platform.audit_event(tenant_id, occurred_at);
CREATE INDEX audit_event_subject_idx ON platform.audit_event(subject_type, subject_id);
CREATE INDEX audit_event_correlation_idx ON platform.audit_event(correlation_id);

CREATE TABLE platform.outbox_event (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz
);
CREATE INDEX outbox_event_unpublished_idx
  ON platform.outbox_event(published_at, occurred_at) WHERE published_at IS NULL;

ALTER TABLE iam.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON iam.tenant TO carespaces_app
  USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE iam.tenant_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.tenant_membership FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_membership_isolation ON iam.tenant_membership TO carespaces_app
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE iam.role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.role_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY role_assignment_tenant_isolation ON iam.role_assignment TO carespaces_app
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT USAGE ON SCHEMA iam, platform TO carespaces_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  iam.user_account, iam.tenant, iam.tenant_membership, iam.role_assignment,
  platform.audit_event, platform.outbox_event
TO carespaces_app;
REVOKE SELECT, UPDATE, DELETE ON platform.audit_event FROM carespaces_app;
