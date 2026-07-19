CREATE TABLE platform.configuration_version (
  id uuid PRIMARY KEY,
  config_key text NOT NULL
    CHECK (config_key ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  environment text NOT NULL
    CHECK (environment IN ('development', 'test', 'staging', 'production')),
  version text NOT NULL
    CHECK (version ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$'),
  value jsonb NOT NULL,
  value_hash text NOT NULL CHECK (length(value_hash) = 64),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'ACTIVE', 'RETIRED')),
  change_reason text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES iam.user_account(id),
  approved_by_user_id uuid REFERENCES iam.user_account(id),
  activated_by_user_id uuid REFERENCES iam.user_account(id),
  supersedes_id uuid REFERENCES platform.configuration_version(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_at timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  CONSTRAINT configuration_version_unique
    UNIQUE (config_key, environment, version),
  CONSTRAINT configuration_four_eyes
    CHECK (
      environment NOT IN ('staging', 'production')
      OR approved_by_user_id IS NULL
      OR approved_by_user_id <> created_by_user_id
    )
);

CREATE UNIQUE INDEX configuration_active_uidx
  ON platform.configuration_version(config_key, environment)
  WHERE status = 'ACTIVE';
CREATE INDEX configuration_status_idx
  ON platform.configuration_version(environment, status, config_key);

GRANT SELECT, INSERT, UPDATE ON platform.configuration_version TO carespaces_app;
