import type { Pool } from 'pg';
import { configurationValueHash } from './configurations.js';

const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);

export const syntheticFixture = {
  tenant: {
    id: '02000000-0000-4000-8000-000000000001',
    displayName: 'Synthetic Family',
  },
  users: {
    customer: {
      id: '01000000-0000-4000-8000-000000000001',
      subject: 'customer-001',
    },
    provider: {
      id: '01000000-0000-4000-8000-000000000002',
      subject: 'provider-001',
    },
    admin: {
      id: '01000000-0000-4000-8000-000000000003',
      subject: 'admin-001',
    },
  },
} as const;

export const syntheticDeadlinePolicy = {
  timezone: 'Asia/Bangkok',
  deadlines: {
    PROVIDER_RESERVATION_EXPIRY: {
      enabled: true,
      durationMs: 5 * 60_000,
      commandType: 'ExpireReservation',
    },
    PAYMENT_EXPIRY: {
      enabled: true,
      durationMs: 15 * 60_000,
      commandType: 'ExpirePaymentAttempt',
    },
    SHIFT_REMINDER: {
      enabled: true,
      durationMs: 60 * 60_000,
      commandType: 'SendShiftReminder',
    },
    PRE_SHIFT_CREDENTIAL_RECHECK: {
      enabled: true,
      durationMs: 24 * 60 * 60_000,
      commandType: 'RevalidateAssignmentProvider',
    },
    INCIDENT_ACK_DEADLINE: {
      enabled: true,
      durationMs: 5 * 60_000,
      commandType: 'EscalateIncident',
    },
    REPLACEMENT_DEADLINE: {
      enabled: true,
      durationMs: 30 * 60_000,
      commandType: 'EscalateOrFailReplacement',
    },
    CUSTOMER_APPROVAL_DEADLINE: {
      enabled: true,
      durationMs: 24 * 60 * 60_000,
      commandType: 'AutoCompleteJob',
    },
    DISPUTE_EVIDENCE_DEADLINE: {
      enabled: true,
      durationMs: 7 * 24 * 60 * 60_000,
      commandType: 'AdvanceDisputeReview',
    },
    CREDENTIAL_EXPIRY: {
      enabled: true,
      durationMs: 30 * 24 * 60 * 60_000,
      commandType: 'ExpireCredential',
    },
    PAYOUT_RETRY: {
      enabled: true,
      durationMs: 15 * 60_000,
      commandType: 'RetryPayoutSubmission',
    },
  },
} as const;

export interface SyntheticSeedSummary {
  tenantId: string;
  identitySubjects: string[];
}

function assertSyntheticSeedTarget(databaseUrl: string): void {
  const target = new URL(databaseUrl);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Synthetic seed is disabled when NODE_ENV=production');
  }
  if (
    process.env.ALLOW_SYNTHETIC_SEED !== 'true' ||
    !localHosts.has(target.hostname)
  ) {
    throw new Error(
      'Synthetic seed requires ALLOW_SYNTHETIC_SEED=true and a loopback database host',
    );
  }
}

export async function seedSynthetic(
  pool: Pool,
  databaseUrl: string,
): Promise<SyntheticSeedSummary> {
  assertSyntheticSeedTarget(databaseUrl);

  const { tenant, users } = syntheticFixture;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('carespaces.synthetic-seed.v1', 0))",
    );
    const userIds: Record<keyof typeof users, string> = {
      customer: users.customer.id,
      provider: users.provider.id,
      admin: users.admin.id,
    };
    for (const [kind, user] of Object.entries(users) as Array<
      [keyof typeof users, (typeof users)[keyof typeof users]]
    >) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM iam.user_account
         WHERE identity_provider = 'fake' AND identity_subject = $1`,
        [user.subject],
      );
      const existingId = existing.rows[0]?.id;
      if (existingId) {
        userIds[kind] = existingId;
        await client.query(
          `UPDATE iam.user_account SET status = 'ACTIVE' WHERE id = $1`,
          [existingId],
        );
        continue;
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO iam.user_account (id, identity_provider, identity_subject)
         VALUES ($1, 'fake', $2)
         ON CONFLICT (id) DO UPDATE
         SET identity_provider = 'fake', identity_subject = EXCLUDED.identity_subject,
             status = 'ACTIVE'
         RETURNING id`,
        [user.id, user.subject],
      );
      userIds[kind] = inserted.rows[0]?.id ?? user.id;
    }
    await client.query(
      `INSERT INTO iam.tenant (id, type, status, display_name, created_by_user_id)
       VALUES ($1, 'FAMILY', 'ACTIVE', $2, $3)
       ON CONFLICT (id) DO UPDATE
       SET status = 'ACTIVE', display_name = EXCLUDED.display_name`,
      [tenant.id, tenant.displayName, userIds.customer],
    );
    await client.query(
      `INSERT INTO iam.tenant_membership
       (tenant_id, user_id, status, relationship_label, invited_at, accepted_at)
       VALUES ($1, $2, 'ACTIVE', 'Owner', clock_timestamp(), clock_timestamp())
       ON CONFLICT (tenant_id, user_id) DO UPDATE
       SET status = 'ACTIVE', relationship_label = 'Owner', revoked_at = NULL`,
      [tenant.id, userIds.customer],
    );

    const roles = [
      {
        id: '04000000-0000-4000-8000-000000000001',
        userId: userIds.customer,
        tenantId: tenant.id,
        scopeType: 'TENANT',
        role: 'FAMILY_OWNER',
      },
      {
        id: '04000000-0000-4000-8000-000000000002',
        userId: userIds.provider,
        tenantId: null,
        scopeType: 'PLATFORM',
        role: 'PROVIDER_APPLICANT',
      },
      {
        id: '04000000-0000-4000-8000-000000000003',
        userId: userIds.admin,
        tenantId: null,
        scopeType: 'PLATFORM',
        role: 'CARE_COORDINATOR',
      },
    ] as const;
    for (const role of roles) {
      await client.query(
        `INSERT INTO iam.role_assignment
         (id, user_id, tenant_id, scope_type, role, effective_at, granted_by_user_id)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp(), $6)
         ON CONFLICT (id) DO UPDATE
         SET role = EXCLUDED.role, revoked_at = NULL, revoked_by_user_id = NULL`,
        [
          role.id,
          role.userId,
          role.tenantId,
          role.scopeType,
          role.role,
          userIds.admin,
        ],
      );
    }

    for (const [index, queue] of [
      'URGENT',
      'INCIDENT',
      'REPLACEMENT',
      'GENERAL',
    ].entries()) {
      await client.query(
        `INSERT INTO operations.ops_queue_membership
         (id, user_id, queue, status, assigned_by_user_id)
         VALUES ($1, $2, $3, 'ACTIVE', $2)
         ON CONFLICT (user_id, queue) DO UPDATE
         SET status = 'ACTIVE', revoked_at = NULL`,
        [
          `09000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          userIds.admin,
          queue,
        ],
      );
    }

    const deadlinePolicyValue = JSON.stringify(syntheticDeadlinePolicy);
    await client.query(
      `INSERT INTO platform.configuration_version
       (id, config_key, environment, version, value, value_hash, status,
        change_reason, created_by_user_id, approved_by_user_id,
        activated_by_user_id, approved_at, activated_at)
       SELECT $1, 'platform.deadlines', 'development', 'deadline-policy-local-v1',
              $2::jsonb, $3, 'ACTIVE', 'synthetic_local_baseline', $4, $4, $4,
              clock_timestamp(), clock_timestamp()
       WHERE NOT EXISTS (
         SELECT 1 FROM platform.configuration_version
         WHERE config_key = 'platform.deadlines' AND environment = 'development'
       )`,
      [
        '07000000-0000-4000-8000-000000000001',
        deadlinePolicyValue,
        configurationValueHash(syntheticDeadlinePolicy),
        userIds.admin,
      ],
    );

    await client.query(
      `INSERT INTO platform.audit_event
       (id, tenant_id, actor_user_id, action, subject_type, subject_id, correlation_id, metadata)
       VALUES ($1, $2, $3, 'tenant.synthetic_seeded', 'tenant', $2, $4, '{"synthetic":true}')
       ON CONFLICT (id) DO NOTHING`,
      [
        '05000000-0000-4000-8000-000000000001',
        tenant.id,
        userIds.admin,
        'synthetic-seed-v1',
      ],
    );
    await client.query(
      `INSERT INTO platform.audit_event
       (id, actor_user_id, action, subject_type, subject_id, reason_code,
        correlation_id, metadata)
       SELECT $1, $2, 'configuration.synthetic_activated',
        'configuration_version', $3, 'synthetic_local_baseline', $4, $5::jsonb
       FROM platform.configuration_version WHERE id = $3
       ON CONFLICT (id) DO NOTHING`,
      [
        '05000000-0000-4000-8000-000000000002',
        userIds.admin,
        '07000000-0000-4000-8000-000000000001',
        'synthetic-seed-v1',
        JSON.stringify({
          configKey: 'platform.deadlines',
          environment: 'development',
          version: 'deadline-policy-local-v1',
          valueHash: configurationValueHash(syntheticDeadlinePolicy),
        }),
      ],
    );
    await client.query(
      `INSERT INTO platform.outbox_event
       (id, tenant_id, aggregate_type, aggregate_id, event_type, event_version,
        payload, correlation_id)
       VALUES ($1, $2, 'tenant', $2, 'tenant.synthetic-seeded.v1', 1,
               $3::jsonb, $4)
       ON CONFLICT (id) DO NOTHING`,
      [
        '06000000-0000-4000-8000-000000000001',
        tenant.id,
        JSON.stringify({ tenantId: tenant.id }),
        'synthetic-seed-v1',
      ],
    );
    await client.query('COMMIT');
    return {
      tenantId: tenant.id,
      identitySubjects: Object.values(users).map((user) => user.subject),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
