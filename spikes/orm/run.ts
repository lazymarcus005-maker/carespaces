import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import postgres from 'postgres';
import { patients, providerLocations, tenants } from './drizzle-schema';

const here = dirname(fileURLToPath(import.meta.url));
const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:5433/carespaces';
const appPassword = 'carespaces_app';
const databaseNames = ['carespaces_prisma', 'carespaces_drizzle'] as const;
const tenantA = '10000000-0000-4000-8000-000000000001';
const tenantB = '10000000-0000-4000-8000-000000000002';
const providerId = '20000000-0000-4000-8000-000000000001';

function dockerCompose(...args: string[]): void {
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      join(here, '../../infrastructure/database/compose.yaml'),
      ...args,
    ],
    { stdio: 'inherit' },
  );
}

function databaseUrl(
  database: string,
  role = 'postgres',
  password = 'postgres',
): string {
  return `postgresql://${role}:${password}@127.0.0.1:5433/${database}`;
}

async function prepareDatabases(): Promise<void> {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const probe = postgres(adminUrl, { connect_timeout: 2, max: 1 });
    try {
      await probe`SELECT 1`;
      ready = true;
      await probe.end();
      break;
    } catch {
      await probe.end({ timeout: 0 });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (!ready)
    throw new Error('PostgreSQL did not become ready within 30 seconds');

  const admin = postgres(adminUrl, { max: 1 });
  await admin.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'carespaces_app') THEN
        CREATE ROLE carespaces_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
  `);

  for (const name of databaseNames) {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${name}`);
  }
  await admin.end();
}

async function applyMigration(
  database: string,
  direction: 'up' | 'down',
): Promise<void> {
  const migration = await readFile(
    join(here, `migrations/001_val10.${direction}.sql`),
    'utf8',
  );
  const client = postgres(databaseUrl(database), { max: 1 });
  await client.unsafe(migration);
  await client.end();
}

async function seedAndTestConstraints(database: string): Promise<void> {
  const admin = postgres(databaseUrl(database), { max: 1 });
  await admin`INSERT INTO tenant (id, name) VALUES (${tenantA}, 'Tenant A'), (${tenantB}, 'Tenant B')`;

  await admin`
    INSERT INTO assignment (id, provider_id, starts_at, ends_at, status)
    VALUES ('30000000-0000-4000-8000-000000000001', ${providerId}, '2026-08-01T09:00:00+07', '2026-08-01T12:00:00+07', 'CONFIRMED')
  `;

  let overlapRejected = false;
  try {
    await admin`
      INSERT INTO assignment (id, provider_id, starts_at, ends_at, status)
      VALUES ('30000000-0000-4000-8000-000000000002', ${providerId}, '2026-08-01T11:00:00+07', '2026-08-01T13:00:00+07', 'RESERVED')
    `;
  } catch {
    overlapRejected = true;
  }
  if (!overlapRejected)
    throw new Error(`${database}: exclusion constraint allowed an overlap`);
  await admin.end();
}

async function testPrisma(): Promise<void> {
  console.log('Testing Prisma 7...');
  const url = databaseUrl('carespaces_prisma');
  process.env.PRISMA_SPIKE_DATABASE_URL = url;
  execFileSync(
    process.execPath,
    [
      join(here, '../../node_modules/prisma/build/index.js'),
      'generate',
      '--config',
      join(here, 'prisma.config.ts'),
    ],
    { cwd: here, env: process.env, stdio: 'inherit' },
  );

  const { PrismaClient } = await import('./prisma/generated/client.js');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  await prisma.$executeRaw`
    INSERT INTO provider_location (id, label, location)
    VALUES ('40000000-0000-4000-8000-000000000001', 'Bangkok', ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326))
  `;
  const distance = await prisma.$queryRaw<Array<{ meters: number }>>`
    SELECT ST_DistanceSphere(location, ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326))::float8 AS meters
    FROM provider_location
  `;
  if (distance[0]?.meters !== 0)
    throw new Error('Prisma: PostGIS raw query failed');

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.tenant.create({
        data: { id: '10000000-0000-4000-8000-000000000099', name: 'Rollback' },
      });
      throw new Error('expected rollback');
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'expected rollback')
      throw error;
  }
  if (
    await prisma.tenant.findUnique({
      where: { id: '10000000-0000-4000-8000-000000000099' },
    })
  ) {
    throw new Error('Prisma: transaction did not roll back');
  }
  await prisma.$disconnect();
  console.log('Prisma checks passed.');
}

async function testDrizzle(): Promise<void> {
  console.log('Testing Drizzle...');
  const adminPool = new Pool({
    connectionString: databaseUrl('carespaces_drizzle'),
    max: 1,
  });
  const db = drizzle(adminPool);
  const insertedLocations = await db
    .insert(providerLocations)
    .values({
      id: '40000000-0000-4000-8000-000000000001',
      label: 'Bangkok',
      location: { x: 100.5018, y: 13.7563 },
    })
    .returning({ id: providerLocations.id });
  if (insertedLocations.length !== 1)
    throw new Error('Drizzle: typed PostGIS insert failed');
  const distance = await db
    .select({
      meters: drizzleSql<number>`ST_DistanceSphere(${providerLocations.location}, ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326))::float8`,
    })
    .from(providerLocations);
  if (distance[0]?.meters !== 0)
    throw new Error('Drizzle: typed PostGIS insert/query failed');

  try {
    await db.transaction(async (transaction) => {
      await transaction
        .insert(tenants)
        .values({
          id: '10000000-0000-4000-8000-000000000099',
          name: 'Rollback',
        })
        .returning({ id: tenants.id });
      throw new Error('expected rollback');
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'expected rollback')
      throw error;
  }
  const rolledBack = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, '10000000-0000-4000-8000-000000000099'));
  if (rolledBack.length)
    throw new Error('Drizzle: transaction did not roll back');
  await adminPool.end();

  const appPool = new Pool({
    connectionString: databaseUrl(
      'carespaces_drizzle',
      'carespaces_app',
      appPassword,
    ),
    max: 1,
  });
  const appDb = drizzle(appPool);
  await appDb.transaction(async (transaction) => {
    await transaction.execute(
      drizzleSql`SELECT set_config('app.current_tenant_id', ${tenantA}, true)`,
    );
    await transaction
      .insert(patients)
      .values({
        id: '50000000-0000-4000-8000-000000000001',
        tenantId: tenantA,
        displayName: 'Visible Patient',
      })
      .returning({ id: patients.id });
    const visible = await transaction.select().from(patients);
    if (visible.length !== 1)
      throw new Error('Drizzle: tenant A cannot read its patient');
  });
  await appDb.transaction(async (transaction) => {
    await transaction.execute(
      drizzleSql`SELECT set_config('app.current_tenant_id', ${tenantB}, true)`,
    );
    const hidden = await transaction.select().from(patients);
    if (hidden.length !== 0)
      throw new Error('Drizzle: RLS leaked cross-tenant patient');
  });
  await appPool.end();
  console.log('Drizzle checks passed.');
}

async function verifyRollback(database: string): Promise<void> {
  await applyMigration(database, 'down');
  const client = postgres(databaseUrl(database), { max: 1 });
  const rows = await client<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('tenant', 'patient', 'provider_location', 'assignment')
  `;
  await client.end();
  if (rows.length)
    throw new Error(
      `${database}: down migration left application tables behind`,
    );
}

async function main(): Promise<void> {
  dockerCompose('up', '-d', '--wait');
  console.log('Preparing isolated spike databases...');
  await prepareDatabases();
  for (const database of databaseNames) {
    console.log(`Applying and testing migration on ${database}...`);
    await applyMigration(database, 'up');
    await seedAndTestConstraints(database);
  }
  await testPrisma();
  await testDrizzle();
  for (const database of databaseNames) await verifyRollback(database);
  console.log(
    'VAL-10 passed: PostGIS, RLS, exclusion constraint, raw SQL, transaction and rollback.',
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
