CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE tenant (
  id uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE patient (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  display_name text NOT NULL
);

ALTER TABLE patient ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient FORCE ROW LEVEL SECURITY;

CREATE POLICY patient_tenant_isolation ON patient
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TABLE provider_location (
  id uuid PRIMARY KEY,
  label text NOT NULL,
  location geometry(Point, 4326) NOT NULL
);

CREATE INDEX provider_location_gix ON provider_location USING gist (location);

CREATE TABLE assignment (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('RESERVED', 'CONFIRMED', 'CANCELLED')),
  CHECK (starts_at < ends_at)
);

ALTER TABLE assignment ADD CONSTRAINT assignment_provider_active_time_excl
  EXCLUDE USING gist (
    provider_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('RESERVED', 'CONFIRMED'));

GRANT USAGE ON SCHEMA public TO carespaces_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant, patient, provider_location, assignment TO carespaces_app;
