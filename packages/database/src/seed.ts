import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);

export async function seedSynthetic(
  pool: Pool,
  databaseUrl: string,
): Promise<void> {
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userId = '01000000-0000-4000-8000-000000000001';
    const tenantId = '02000000-0000-4000-8000-000000000001';
    await client.query(
      `INSERT INTO iam.user_account (id, identity_provider, identity_subject)
       VALUES ($1, 'synthetic', 'customer-001') ON CONFLICT DO NOTHING`,
      [userId],
    );
    await client.query(
      `INSERT INTO iam.tenant (id, type, status, display_name, created_by_user_id)
       VALUES ($1, 'FAMILY', 'ACTIVE', 'Synthetic Family', $2) ON CONFLICT DO NOTHING`,
      [tenantId, userId],
    );
    await client.query(
      `INSERT INTO iam.tenant_membership
       (tenant_id, user_id, status, relationship_label, invited_at, accepted_at)
       VALUES ($1, $2, 'ACTIVE', 'Owner', clock_timestamp(), clock_timestamp())
       ON CONFLICT DO NOTHING`,
      [tenantId, userId],
    );
    await client.query(
      `INSERT INTO platform.audit_event
       (id, tenant_id, actor_user_id, action, subject_type, subject_id, correlation_id, metadata)
       VALUES ($1, $2, $3, 'tenant.synthetic_seeded', 'tenant', $2, $4, '{"synthetic":true}')`,
      [randomUUID(), tenantId, userId, randomUUID()],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
