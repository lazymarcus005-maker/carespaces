-- Local development roles only. Production credentials are provisioned by infrastructure.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'carespaces_app') THEN
    CREATE ROLE carespaces_app LOGIN PASSWORD 'carespaces_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'carespaces_audit_reader') THEN
    CREATE ROLE carespaces_audit_reader LOGIN PASSWORD 'carespaces_audit_reader' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
