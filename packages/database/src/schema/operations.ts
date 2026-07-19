import {
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  integer,
} from 'drizzle-orm/pg-core';
import { users } from './iam.js';

export const operations = pgSchema('operations');

export const opsTasks = operations.table(
  'ops_task',
  {
    id: uuid().primaryKey(),
    tenantId: uuid('tenant_id'),
    taskType: text('task_type').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    queue: text().notNull(),
    priority: text().notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    dueAt: timestamp('due_at', { withTimezone: true }),
    escalationLevel: integer('escalation_level').notNull().default(0),
    status: text().notNull().default('OPEN'),
    resolutionCode: text('resolution_code'),
    sourceDedupeKey: text('source_dedupe_key').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdBySystem: text('created_by_system'),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
    version: integer().notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ops_task_source_dedupe_uidx').on(table.sourceDedupeKey),
    index('ops_task_queue_work_idx').on(
      table.queue,
      table.priority,
      table.dueAt,
      table.createdAt,
    ),
    index('ops_task_owner_work_idx').on(
      table.ownerUserId,
      table.status,
      table.dueAt,
    ),
    index('ops_task_subject_idx').on(
      table.subjectType,
      table.subjectId,
      table.createdAt,
    ),
  ],
);

export const opsQueueMemberships = operations.table(
  'ops_queue_membership',
  {
    id: uuid().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    queue: text().notNull(),
    status: text().notNull().default('ACTIVE'),
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ops_queue_membership_uidx').on(table.userId, table.queue),
    index('ops_queue_membership_queue_idx').on(
      table.queue,
      table.status,
      table.userId,
    ),
  ],
);
