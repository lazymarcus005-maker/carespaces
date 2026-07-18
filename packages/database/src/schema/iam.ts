import { sql } from 'drizzle-orm';
import {
  index,
  pgPolicy,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const iam = pgSchema('iam');

export const tenantType = iam.enum('tenant_type', ['FAMILY', 'ORGANIZATION']);
export const tenantStatus = iam.enum('tenant_status', [
  'ACTIVE',
  'RESTRICTED',
  'ARCHIVED',
]);
export const userStatus = iam.enum('user_status', [
  'ACTIVE',
  'DISABLED',
  'ARCHIVED',
]);
export const membershipStatus = iam.enum('membership_status', [
  'INVITED',
  'ACTIVE',
  'REVOKED',
]);

export const users = iam.table(
  'user_account',
  {
    id: uuid().primaryKey(),
    identityProvider: text('identity_provider').notNull(),
    identitySubject: text('identity_subject').notNull(),
    status: userStatus().notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('user_account_identity_uidx').on(
      table.identityProvider,
      table.identitySubject,
    ),
  ],
);

export const tenants = iam
  .table(
    'tenant',
    {
      id: uuid().primaryKey(),
      type: tenantType().notNull().default('FAMILY'),
      status: tenantStatus().notNull().default('ACTIVE'),
      displayName: text('display_name').notNull(),
      createdByUserId: uuid('created_by_user_id')
        .notNull()
        .references(() => users.id),
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    () => [
      pgPolicy('tenant_isolation', {
        for: 'all',
        to: 'carespaces_app',
        using: sql`id = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
        withCheck: sql`id = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
      }),
    ],
  )
  .enableRLS();

export const tenantMemberships = iam
  .table(
    'tenant_membership',
    {
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id),
      userId: uuid('user_id')
        .notNull()
        .references(() => users.id),
      status: membershipStatus().notNull().default('INVITED'),
      relationshipLabel: text('relationship_label'),
      invitedAt: timestamp('invited_at', { withTimezone: true }),
      acceptedAt: timestamp('accepted_at', { withTimezone: true }),
      revokedAt: timestamp('revoked_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId] }),
      index('tenant_membership_user_idx').on(table.userId),
      pgPolicy('tenant_membership_isolation', {
        for: 'all',
        to: 'carespaces_app',
        using: sql`tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
        withCheck: sql`tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
      }),
    ],
  )
  .enableRLS();

export const roleAssignments = iam
  .table(
    'role_assignment',
    {
      id: uuid().primaryKey(),
      userId: uuid('user_id')
        .notNull()
        .references(() => users.id),
      tenantId: uuid('tenant_id').references(() => tenants.id),
      scopeType: text('scope_type').notNull(),
      role: text().notNull(),
      effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
      expiresAt: timestamp('expires_at', { withTimezone: true }),
      grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
      revokedAt: timestamp('revoked_at', { withTimezone: true }),
      revokedByUserId: uuid('revoked_by_user_id').references(() => users.id),
    },
    (table) => [
      index('role_assignment_user_idx').on(table.userId),
      index('role_assignment_tenant_idx').on(table.tenantId),
      pgPolicy('role_assignment_tenant_isolation', {
        for: 'all',
        to: 'carespaces_app',
        using: sql`tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
        withCheck: sql`tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
      }),
    ],
  )
  .enableRLS();
