-- Local development roles only. Production credentials are provisioned by infrastructure.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'carespaces_app') THEN
    CREATE ROLE carespaces_app LOGIN PASSWORD 'carespaces_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
