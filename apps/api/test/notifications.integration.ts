import { Test } from '@nestjs/testing';
import { NotificationIntentListResponseSchema } from '@carespaces/api-contracts';
import { migrateUp, seedSynthetic } from '@carespaces/database';
import { PostgresNotificationService } from '@carespaces/notifications';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';

const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:54329/carespaces';
const databaseName = 'carespaces_notifications_api_test';
const ownerUrl = `postgresql://postgres:postgres@127.0.0.1:54329/${databaseName}`;
const appUrl = `postgresql://carespaces_app:carespaces_app@127.0.0.1:54329/${databaseName}`;
const templateId = '91000000-0000-4000-8000-000000000001';
const incidentIntentId = '90000000-0000-4000-8000-000000000001';
const incidentSubjectId = '31000000-0000-4000-8000-000000000001';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function seedNotificationFixture(owner: Pool): Promise<void> {
  await owner.query(
    `INSERT INTO notifications.notification_template
     (id, key, notification_class, channel, display_name, body_template, is_critical)
     VALUES ($1, 'incident.ack_required', 'incident_ack', 'push',
             'Incident acknowledgement required',
             'Incident {{incidentId}} requires acknowledgement', true)`,
    [templateId],
  );
  await owner.query(
    `INSERT INTO notifications.notification_intent
     (id, template_id, notification_class, channel, subject_type, subject_id,
      recipient_ref, body_redacted, correlation_id, source_dedupe_key, status)
     VALUES ($1, $2, 'incident_ack', 'push', 'incident', $3,
             'admin-001', 'Incident ACK required', 'incident-1',
             'incident-1:ack-notification', 'PENDING')`,
    [incidentIntentId, templateId, incidentSubjectId],
  );
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
  await seedNotificationFixture(owner);

  process.env.DATABASE_URL = appUrl;
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const application = moduleRef.createNestApplication();
  configureApplication(application);
  await application.init();

  const listResponse = await request(application.getHttpServer())
    .get('/v1/notifications/intents?limit=100')
    .set('authorization', 'Bearer fake:admin-001')
    .set('x-request-id', 'notifications-list')
    .expect(200);
  const projection = NotificationIntentListResponseSchema.parse(listResponse.body);
  assert(
    projection.intents.some((intent) => intent.id === incidentIntentId),
    'notification intent projection did not return the seeded incident intent',
  );
  assert(
    projection.intents.every((intent) => intent.acknowledgedAt === null),
    'notification intent exposed an acknowledgement timestamp (delivery ≠ ack)',
  );

  await request(application.getHttpServer())
    .get('/v1/notifications/intents')
    .set('authorization', 'Bearer fake:customer-001')
    .expect(403);

  const attempts = await request(application.getHttpServer())
    .get(`/v1/notifications/intents/${incidentIntentId}/attempts`)
    .set('authorization', 'Bearer fake:admin-001')
    .set('x-request-id', 'notifications-attempts')
    .expect(200);
  assert(
    Array.isArray(attempts.body.attempts) &&
      attempts.body.intentId === incidentIntentId,
    'attempt list projection is malformed',
  );

  await request(application.getHttpServer())
    .get('/v1/notifications/intents/not-a-uuid')
    .set('authorization', 'Bearer fake:admin-001')
    .expect(400);

  await request(application.getHttpServer())
    .get('/v1/notifications/intents/80000000-0000-4000-8000-000000000999')
    .set('authorization', 'Bearer fake:admin-001')
    .expect(404);

  const service = new PostgresNotificationService(
    new Pool({ connectionString: appUrl, max: 1 }),
  );
  await service.ensureTemplate({
    id: '91000000-0000-4000-8000-000000000002',
    key: 'shift.upcoming_reminder',
    notificationClass: 'shift_reminder',
    channel: 'in_app',
    displayName: 'Shift reminder',
    bodyTemplate: 'Shift {{shiftId}} starts soon',
  });
  await service.createIntent({
    templateId: '91000000-0000-4000-8000-000000000002',
    notificationClass: 'shift_reminder',
    channel: 'in_app',
    subjectType: 'shift',
    subjectId: '32000000-0000-4000-8000-000000000001',
    recipientRef: 'provider-001',
    bodyRedacted: 'Shift starts in 1 hour',
    correlationId: 'shift-reminder-1',
    sourceDedupeKey: 'shift-1:reminder',
    commandId: 'notification-api-create-shift-reminder',
    reasonCode: 'shift_reminder_scheduled',
    actor: { systemActor: 'shift-service' },
  });
  const updated = await request(application.getHttpServer())
    .get('/v1/notifications/intents?class=shift_reminder')
    .set('authorization', 'Bearer fake:admin-001')
    .set('x-request-id', 'notifications-shift')
    .expect(200);
  assert(
    NotificationIntentListResponseSchema.parse(updated.body).intents.length === 1,
    'class filter did not isolate shift_reminder intents',
  );

  await application.close();
  await owner.end();
  delete process.env.DATABASE_URL;
  delete process.env.ALLOW_SYNTHETIC_SEED;
  const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
  await cleanup.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await cleanup.end();
  console.log(
    'OPS-02 API passed: intent list, denied tenant actor, attempt timeline, 404/400 handling and class filter.',
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});