import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import {
  ErrorResponseSchema,
  OpsTaskListResponseSchema,
  OpsTaskSchema,
} from '@carespaces/api-contracts';
import { migrateUp, seedSynthetic } from '@carespaces/database';
import { PostgresOpsTaskService } from '@carespaces/operations';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';

const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:54329/carespaces';
const databaseName = 'carespaces_ops_api_test';
const ownerUrl = `postgresql://postgres:postgres@127.0.0.1:54329/${databaseName}`;
const appUrl = `postgresql://carespaces_app:carespaces_app@127.0.0.1:54329/${databaseName}`;
const incidentTaskId = '81000000-0000-4000-8000-000000000001';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${databaseName}`);
  await admin.end();

  const owner = new Pool({ connectionString: ownerUrl, max: 2 });
  await migrateUp(owner);
  process.env.ALLOW_SYNTHETIC_SEED = 'true';
  await seedSynthetic(owner, ownerUrl);

  const appPool = new Pool({ connectionString: appUrl, max: 3 });
  const tasks = new PostgresOpsTaskService(appPool);
  await tasks.create({
    id: incidentTaskId,
    taskType: 'incident.active_triage',
    subjectType: 'incident',
    subjectId: '31000000-0000-4000-8000-000000000001',
    queue: 'INCIDENT',
    priority: 'CRITICAL',
    dueAt: new Date(Date.now() + 15 * 60_000),
    sourceDedupeKey: 'ops-api:incident-1',
    actor: { systemActor: 'incident-service' },
    commandId: 'ops-api-create-incident',
    correlationId: 'ops-api-setup',
    reasonCode: 'incident_reported',
  });
  await tasks.create({
    id: '81000000-0000-4000-8000-000000000002',
    taskType: 'reconciliation.mismatch',
    subjectType: 'reconciliation',
    subjectId: '31000000-0000-4000-8000-000000000002',
    queue: 'FINANCE',
    priority: 'HIGH',
    sourceDedupeKey: 'ops-api:finance-1',
    actor: { systemActor: 'finance-service' },
    commandId: 'ops-api-create-finance',
    correlationId: 'ops-api-setup',
    reasonCode: 'settlement_mismatch',
  });

  process.env.DATABASE_URL = appUrl;
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const application = moduleRef.createNestApplication();
  configureApplication(application);
  await application.init();

  const listResponse = await request(application.getHttpServer())
    .get('/v1/ops/tasks?status=OPEN')
    .set('authorization', 'Bearer fake:admin-001')
    .set('x-request-id', 'ops-list')
    .expect(200);
  const projection = OpsTaskListResponseSchema.parse(listResponse.body);
  assert(
    projection.tasks.length === 1 && projection.tasks[0]?.id === incidentTaskId,
    'queue projection exposed an unassigned finance task',
  );
  assert(
    projection.actor.queues.join(',') === 'GENERAL,INCIDENT,REPLACEMENT,URGENT',
    'actor queue membership projection is incorrect',
  );

  await request(application.getHttpServer())
    .get('/v1/ops/tasks?queue=FINANCE')
    .set('authorization', 'Bearer fake:admin-001')
    .expect(403);
  await request(application.getHttpServer())
    .get('/v1/ops/tasks')
    .set('authorization', 'Bearer fake:customer-001')
    .expect(403);

  const claimBody = { expectedVersion: 1, reasonCode: 'queue_claim' };
  const claim = await request(application.getHttpServer())
    .post(`/v1/ops/tasks/${incidentTaskId}/claim`)
    .set('authorization', 'Bearer fake:admin-001')
    .set('idempotency-key', 'ops-api-claim-1')
    .set('x-request-id', 'ops-claim')
    .send(claimBody)
    .expect(200);
  const claimed = OpsTaskSchema.parse(claim.body);
  assert(
    claimed.status === 'CLAIMED' && claimed.version === 2,
    'task claim failed',
  );

  const replay = await request(application.getHttpServer())
    .post(`/v1/ops/tasks/${incidentTaskId}/claim`)
    .set('authorization', 'Bearer fake:admin-001')
    .set('idempotency-key', 'ops-api-claim-1')
    .set('x-request-id', 'ops-claim')
    .send(claimBody)
    .expect(200);
  assert(
    OpsTaskSchema.parse(replay.body).version === 2,
    'claim replay changed the result',
  );

  const stale = await request(application.getHttpServer())
    .post(`/v1/ops/tasks/${incidentTaskId}/escalate`)
    .set('authorization', 'Bearer fake:admin-001')
    .set('idempotency-key', 'ops-api-stale-escalate')
    .set('x-request-id', 'ops-stale')
    .send({
      expectedVersion: 1,
      reasonCode: 'stale_attempt',
      priority: 'CRITICAL',
    })
    .expect(409);
  assert(
    ErrorResponseSchema.parse(stale.body).error.code === 'STALE_VERSION',
    'stale API command did not preserve its stable conflict code',
  );

  const resolved = await request(application.getHttpServer())
    .post(`/v1/ops/tasks/${incidentTaskId}/resolve`)
    .set('authorization', 'Bearer fake:admin-001')
    .set('idempotency-key', 'ops-api-resolve-1')
    .set('x-request-id', 'ops-resolve')
    .send({
      expectedVersion: 2,
      reasonCode: 'triage_complete',
      resolutionCode: 'incident_routed',
    })
    .expect(200);
  assert(
    OpsTaskSchema.parse(resolved.body).status === 'RESOLVED',
    'task resolution failed',
  );

  const evidence = await owner.query<{ claim_events: string }>(
    `SELECT count(*)::text AS claim_events FROM platform.outbox_event
     WHERE aggregate_id = $1 AND event_type = 'ops_task.claimed.v1'`,
    [incidentTaskId],
  );
  assert(
    evidence.rows[0]?.claim_events === '1',
    'API replay duplicated the claim event',
  );

  await application.close();
  await appPool.end();
  await owner.end();
  delete process.env.DATABASE_URL;
  delete process.env.ALLOW_SYNTHETIC_SEED;
  const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
  await cleanup.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await cleanup.end();
  console.log(
    'OPS-01 API passed: membership-scoped list, denied cross-queue access, atomic claim replay, stable stale conflict and owner resolution.',
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
