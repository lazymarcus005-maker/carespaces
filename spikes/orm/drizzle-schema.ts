import { sql } from 'drizzle-orm';
import {
  check,
  geometry,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenant', {
  id: uuid().primaryKey(),
  name: text().notNull(),
});

export const patients = pgTable(
  'patient',
  {
    id: uuid().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    displayName: text('display_name').notNull(),
  },
  () => [
    pgPolicy('patient_tenant_isolation', {
      for: 'all',
      to: 'carespaces_app',
      using: sql`tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
      withCheck: sql`tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid`,
    }),
  ],
).enableRLS();

export const providerLocations = pgTable(
  'provider_location',
  {
    id: uuid().primaryKey(),
    label: text().notNull(),
    location: geometry({ type: 'point', mode: 'xy', srid: 4326 }).notNull(),
  },
  (table) => [index('provider_location_gix').using('gist', table.location)],
);

export const assignments = pgTable(
  'assignment',
  {
    id: uuid().primaryKey(),
    providerId: uuid('provider_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text().notNull(),
  },
  (table) => [
    check('assignment_time_order', sql`${table.startsAt} < ${table.endsAt}`),
  ],
);
