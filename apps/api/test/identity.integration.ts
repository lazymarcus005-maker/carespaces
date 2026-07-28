import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { migrateUp } from '@carespaces/database';
import {
  createFakeBearerToken,
  SequenceUuidGenerator,
} from '@carespaces/testing';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';

const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:5433/carespaces';
const databaseName = 'carespaces_identity_test';
const ownerUrl = `postgresql://postgres:postgres@127.0.0.1:5433/${databaseName}`;
const appUrl = `postgresql://carespaces_app:carespaces_app@127.0.0.1:5433/${databaseName}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function recreateDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${databaseName}`);
  await admin.end();
  const owner = new Pool({ connectionString: ownerUrl, max: 1 });
  await migrateUp(owner);
  await owner.end();
}

async function createApplication(): Promise<INestApplication> {
  process.env.DATABASE_URL = appUrl;
  process.env.DATABASE_POOL_SIZE = '2';
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApplication(app);
  await app.init();
  return app;
}

async function main(): Promise<void> {
  await recreateDatabase();
  const app = await createApplication();
  const server = app.getHttpServer();
  const uuids = new SequenceUuidGenerator(1n);
  const auth = createFakeBearerToken('customer-001');
  const idempotencyKey = 'family-onboarding-001';

  await request(server)
    .post('/v1/tenants/family')
    .send({ displayName: 'Family One' })
    .expect(401);

  const created = await request(server)
    .post('/v1/tenants/family')
    .set('authorization', auth)
    .set('idempotency-key', idempotencyKey)
    .set('x-request-id', uuids.next())
    .send({ displayName: 'Family One' })
    .expect(201);
  const tenantId = created.body.tenant?.id as string | undefined;
  assert(tenantId, 'tenant onboarding did not return an id');

  const replay = await request(server)
    .post('/v1/tenants/family')
    .set('authorization', auth)
    .set('idempotency-key', idempotencyKey)
    .send({ displayName: 'Family One' })
    .expect(201);
  assert(
    replay.body.tenant?.id === tenantId,
    'idempotent retry created another tenant',
  );

  await request(server)
    .post('/v1/tenants/family')
    .set('authorization', auth)
    .set('idempotency-key', idempotencyKey)
    .send({ displayName: 'Different Family' })
    .expect(409);

  await request(server)
    .get('/v1/identity/me')
    .set('authorization', auth)
    .set('x-tenant-id', tenantId)
    .expect(200);
  await request(server)
    .get('/v1/identity/me')
    .set('authorization', auth)
    .set('x-tenant-id', uuids.next())
    .expect(403);

  process.env.NODE_ENV = 'production';
  await request(server)
    .get('/v1/identity/me')
    .set('authorization', auth)
    .set('x-tenant-id', tenantId)
    .expect(503);
  delete process.env.NODE_ENV;

  const owner = new Pool({ connectionString: ownerUrl, max: 1 });
  const evidence = await owner.query<{
    tenants: string;
    audits: string;
    transitions: string;
    outbox: string;
    idempotency: string;
  }>(`
    SELECT
      (SELECT count(*) FROM iam.tenant)::text AS tenants,
      (SELECT count(*) FROM platform.audit_event)::text AS audits,
      (SELECT count(*) FROM platform.state_transition)::text AS transitions,
      (SELECT count(*) FROM platform.outbox_event)::text AS outbox,
      (SELECT count(*) FROM platform.idempotency_record)::text AS idempotency
  `);
  assert(
    evidence.rows[0]?.tenants === '1',
    'onboarding created an unexpected tenant count',
  );
  assert(
    evidence.rows[0]?.audits === '1',
    'onboarding audit event was not atomic',
  );
  assert(
    evidence.rows[0]?.transitions === '1',
    'onboarding state transition was not atomic',
  );
  assert(
    evidence.rows[0]?.outbox === '1',
    'onboarding outbox event was not atomic',
  );
  assert(
    evidence.rows[0]?.idempotency === '1',
    'idempotency result was not persisted once',
  );
  await owner.end();

  await app.close();
  const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
  await cleanup.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await cleanup.end();
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_POOL_SIZE;
  console.log(
    'IAM walking skeleton passed: auth, tenant, membership, RLS, audit, outbox and retry.',
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
