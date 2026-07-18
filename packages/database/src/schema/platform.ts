import {
  integer,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

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
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb().notNull(),
    correlationId: text('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    index('outbox_event_unpublished_idx').on(
      table.publishedAt,
      table.occurredAt,
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
