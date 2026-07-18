CREATE TABLE platform.idempotency_record (
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX idempotency_record_expiry_idx ON platform.idempotency_record(expires_at);

GRANT SELECT, INSERT ON platform.idempotency_record TO carespaces_app;
