import { randomUUID } from 'node:crypto';
import { migrateUp, seedSynthetic } from '@carespaces/database';
import {
  InboxConsumer,
  InMemoryEventQueue,
  OutboxPublisher,
  PostgresEventStore,
  type EventEnvelope,
} from '@carespaces/eventing';
import { Pool } from 'pg';

const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:54329/carespaces';
const databaseName = 'carespaces_eventing_test';
const ownerUrl = `postgresql://postgres:postgres@127.0.0.1:54329/${databaseName}`;
const appUrl = `postgresql://carespaces_app:carespaces_app@127.0.0.1:54329/${databaseName}`;

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
  delete process.env.ALLOW_SYNTHETIC_SEED;

  const app = new Pool({ connectionString: appUrl, max: 2 });
  const store = new PostgresEventStore(app);
  const queue = new InMemoryEventQueue();
  const publisher = new OutboxPublisher(store, queue);
  const consumer = new InboxConsumer('integration', store, queue).register(
    'tenant.synthetic-seeded.v1',
    () => Promise.resolve(),
  );
  await publisher.runBatch();
  await consumer.runBatch();

  const poison: EventEnvelope = {
    event_id: randomUUID(),
    event_type: 'integration.poison.v1',
    aggregate_type: 'tenant',
    aggregate_id: '02000000-0000-4000-8000-000000000001',
    aggregate_version: 1,
    occurred_at: new Date().toISOString(),
    tenant_id: '02000000-0000-4000-8000-000000000001',
    correlation_id: 'eventing-poison-verification',
    payload: { safeReference: 'integration-test' },
  };
  await queue.send(poison);
  const deadLetter = await consumer.runBatch({ maxAttempts: 1 });
  assert(deadLetter.deadLettered === 1, 'poison message did not dead-letter');

  const poisonRow = await owner.query<{ id: string }>(
    `SELECT id FROM platform.inbox_message
     WHERE message_id = $1 AND status = 'DEAD_LETTER'`,
    [poison.event_id],
  );
  const poisonId = poisonRow.rows[0]?.id;
  assert(poisonId, 'dead-letter inbox evidence was not persisted');
  assert(
    await store.replayDeadLetter({
      kind: 'inbox',
      id: poisonId,
      reasonCode: 'integration_recovery',
      correlationId: 'eventing-replay-verification',
    }),
    'dead-letter replay was rejected',
  );
  consumer.register('integration.poison.v1', () => Promise.resolve());
  await consumer.runBatch();

  const evidence = await owner.query<{
    outbox_published: string;
    inbox_applied: string;
    dlq_audits: string;
    replay_audits: string;
  }>(`SELECT
    (SELECT count(*) FROM platform.outbox_event WHERE status = 'PUBLISHED')::text AS outbox_published,
    (SELECT count(*) FROM platform.inbox_message WHERE status = 'APPLIED')::text AS inbox_applied,
    (SELECT count(*) FROM platform.audit_event WHERE action = 'event.inbox.dead_lettered')::text AS dlq_audits,
    (SELECT count(*) FROM platform.audit_event WHERE action = 'event.inbox.replayed')::text AS replay_audits`);
  assert(
    evidence.rows[0]?.outbox_published === '1',
    'outbox was not published',
  );
  assert(
    evidence.rows[0]?.inbox_applied === '2',
    'inbox events were not applied',
  );
  assert(evidence.rows[0]?.dlq_audits === '1', 'DLQ action was not audited');
  assert(
    evidence.rows[0]?.replay_audits === '1',
    'replay action was not audited',
  );

  await app.end();
  await owner.end();
  const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
  await cleanup.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await cleanup.end();
  console.log('PLT-01 passed: publish, consume, dedupe, DLQ audit and replay.');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
