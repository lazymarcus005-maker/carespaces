import { sql } from 'drizzle-orm';
import {
  integer,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './iam.js';

export const platform = pgSchema('platform');

export const auditEvents = platform.table(
  'audit_event',
  {
    id: uuid().primaryKey(),
    tenantId: uuid('tenant_id'),
    actorUserId: uuid('actor_user_id'),
    action: text().notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    reasonCode: text('reason_code'),
    correlationId: text('correlation_id').notNull(),
    metadata: jsonb().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_event_tenant_time_idx').on(table.tenantId, table.occurredAt),
    index('audit_event_subject_idx').on(table.subjectType, table.subjectId),
    index('audit_event_correlation_idx').on(table.correlationId),
  ],
);

export const outboxEvents = platform.table(
  'outbox_event',
  {
    id: uuid().primaryKey(),
    tenantId: uuid('tenant_id'),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull().default(1),
    payload: jsonb().notNull(),
    correlationId: text('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text().notNull().default('PENDING'),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseId: uuid('lease_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastError: text('last_error'),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    index('outbox_event_unpublished_idx').on(
      table.publishedAt,
      table.occurredAt,
    ),
    index('outbox_event_claim_idx').on(table.nextAttemptAt, table.occurredAt),
    index('outbox_event_aggregate_idx').on(
      table.aggregateType,
      table.aggregateId,
      table.occurredAt,
    ),
  ],
);

export const inboxMessages = platform.table(
  'inbox_message',
  {
    id: uuid().primaryKey(),
    source: text().notNull(),
    messageId: text('message_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb().notNull(),
    correlationId: text('correlation_id').notNull(),
    status: text().notNull().default('RECEIVED'),
    attempts: integer().notNull().default(0),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseId: uuid('lease_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastError: text('last_error'),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('inbox_message_source_message_unique').on(
      table.source,
      table.messageId,
    ),
    index('inbox_message_claim_idx').on(table.nextAttemptAt, table.receivedAt),
    index('inbox_message_correlation_idx').on(table.correlationId),
  ],
);

export const scheduledDeadlines = platform.table(
  'scheduled_deadline',
  {
    id: uuid().primaryKey(),
    eventId: uuid('event_id').notNull(),
    tenantId: uuid('tenant_id'),
    deadlineType: text('deadline_type').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    commandType: text('command_type').notNull(),
    expectedState: text('expected_state'),
    expectedVersion: integer('expected_version'),
    policyVersion: text('policy_version').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    correlationId: text('correlation_id').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: text().notNull().default('SCHEDULED'),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', {
      withTimezone: true,
    }).notNull(),
    leaseId: uuid('lease_id'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    firedAt: timestamp('fired_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    lastError: text('last_error'),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('scheduled_deadline_event_uidx').on(table.eventId),
    uniqueIndex('scheduled_deadline_dedupe_uidx').on(table.dedupeKey),
    index('scheduled_deadline_claim_idx').on(table.nextAttemptAt, table.dueAt),
    index('scheduled_deadline_subject_idx').on(
      table.subjectType,
      table.subjectId,
      table.dueAt,
    ),
    index('scheduled_deadline_operations_idx').on(table.status, table.dueAt),
  ],
);

export const configurationVersions = platform.table(
  'configuration_version',
  {
    id: uuid().primaryKey(),
    configKey: text('config_key').notNull(),
    environment: text().notNull(),
    version: text().notNull(),
    value: jsonb().notNull(),
    valueHash: text('value_hash').notNull(),
    status: text().notNull().default('DRAFT'),
    changeReason: text('change_reason').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
    activatedByUserId: uuid('activated_by_user_id').references(() => users.id),
    supersedesId: uuid('supersedes_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('configuration_version_uidx').on(
      table.configKey,
      table.environment,
      table.version,
    ),
    uniqueIndex('configuration_active_uidx')
      .on(table.configKey, table.environment)
      .where(sql`status = 'ACTIVE'`),
    index('configuration_status_idx').on(
      table.environment,
      table.status,
      table.configKey,
    ),
  ],
);

export const stateTransitions = platform.table(
  'state_transition',
  {
    id: uuid().primaryKey(),
    tenantId: uuid('tenant_id'),
    actorUserId: uuid('actor_user_id'),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    reasonCode: text('reason_code'),
    correlationId: text('correlation_id').notNull(),
    expectedVersion: integer('expected_version'),
    resultingVersion: integer('resulting_version').notNull(),
    metadata: jsonb().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('state_transition_tenant_time_idx').on(
      table.tenantId,
      table.occurredAt,
    ),
    index('state_transition_subject_idx').on(
      table.subjectType,
      table.subjectId,
      table.occurredAt,
    ),
    index('state_transition_correlation_idx').on(table.correlationId),
  ],
);

export const idempotencyRecords = platform.table(
  'idempotency_record',
  {
    scope: text().notNull(),
    key: text().notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.key] }),
    index('idempotency_record_expiry_idx').on(table.expiresAt),
  ],
);
