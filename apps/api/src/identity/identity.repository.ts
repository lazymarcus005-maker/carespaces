import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  FamilyTenantResponseSchema,
  type FamilyTenantResponse,
} from '@carespaces/api-contracts';
import { appendAuditedStateTransition } from '@carespaces/database';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { IdentityPrincipal } from './identity.types';

export class IdempotencyConflictError extends Error {}
export class MembershipNotFoundError extends Error {}

const ONBOARDING_SCOPE = 'iam.family_tenant.create';

function requestHash(
  principal: IdentityPrincipal,
  displayName: string,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        identity: {
          provider: principal.provider,
          subject: principal.subject,
        },
        displayName,
      }),
    )
    .digest('hex');
}

@Injectable()
export class IdentityRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async createFamilyTenant(input: {
    principal: IdentityPrincipal;
    displayName: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<FamilyTenantResponse> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${ONBOARDING_SCOPE}:${input.idempotencyKey}`],
      );
      const hash = requestHash(input.principal, input.displayName);
      const existing = await client.query<{
        request_hash: string;
        response: unknown;
      }>(
        `SELECT request_hash, response FROM platform.idempotency_record
         WHERE scope = $1 AND key = $2 AND expires_at > clock_timestamp()`,
        [ONBOARDING_SCOPE, input.idempotencyKey],
      );
      const replay = existing.rows[0];
      if (replay) {
        if (replay.request_hash !== hash) {
          throw new IdempotencyConflictError(
            'Idempotency key was reused with a different request',
          );
        }
        await client.query('COMMIT');
        return FamilyTenantResponseSchema.parse(replay.response);
      }

      const userId = await this.upsertUser(client, input.principal);
      const tenantId = randomUUID();
      await client.query(
        "SELECT set_config('app.current_tenant_id', $1, true)",
        [tenantId],
      );
      await client.query(
        `INSERT INTO iam.tenant (id, type, status, display_name, created_by_user_id)
         VALUES ($1, 'FAMILY', 'ACTIVE', $2, $3)`,
        [tenantId, input.displayName, userId],
      );
      await client.query(
        `INSERT INTO iam.tenant_membership
         (tenant_id, user_id, status, relationship_label, invited_at, accepted_at)
         VALUES ($1, $2, 'ACTIVE', 'Owner', clock_timestamp(), clock_timestamp())`,
        [tenantId, userId],
      );
      await client.query(
        `INSERT INTO iam.role_assignment
         (id, user_id, tenant_id, scope_type, role, effective_at, granted_by_user_id)
         VALUES ($1, $2, $3, 'TENANT', 'FAMILY_OWNER', clock_timestamp(), $2)`,
        [randomUUID(), userId, tenantId],
      );

      const response = FamilyTenantResponseSchema.parse({
        userId,
        tenant: {
          id: tenantId,
          type: 'FAMILY',
          status: 'ACTIVE',
          displayName: input.displayName,
        },
        membership: { status: 'ACTIVE', role: 'FAMILY_OWNER' },
      });
      const eventId = randomUUID();
      await appendAuditedStateTransition(
        client,
        {
          actor: { tenantId, userId },
          action: 'tenant.created',
          subject: { type: 'tenant', id: tenantId },
          toState: 'ACTIVE',
          reasonCode: 'customer_onboarding',
          correlationId: input.correlationId,
          expectedVersion: 0,
          resultingVersion: 1,
          metadata: { source: 'api' },
        },
        { nextId: () => eventId },
      );
      await client.query(
        `INSERT INTO platform.outbox_event
         (id, aggregate_type, aggregate_id, event_type, payload, correlation_id)
         VALUES ($1, 'tenant', $2, 'tenant.created.v1', $3::jsonb, $4)`,
        [
          eventId,
          tenantId,
          JSON.stringify({ tenantId, userId }),
          input.correlationId,
        ],
      );
      await client.query(
        `INSERT INTO platform.idempotency_record
         (scope, key, request_hash, response, expires_at)
         VALUES ($1, $2, $3, $4::jsonb, clock_timestamp() + interval '24 hours')`,
        [
          ONBOARDING_SCOPE,
          input.idempotencyKey,
          hash,
          JSON.stringify(response),
        ],
      );
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getMembership(
    principal: IdentityPrincipal,
    tenantId: string,
  ): Promise<FamilyTenantResponse> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.current_tenant_id', $1, true)",
        [tenantId],
      );
      const result = await client.query<{
        user_id: string;
        tenant_id: string;
        type: 'FAMILY';
        tenant_status: 'ACTIVE';
        display_name: string;
        membership_status: 'ACTIVE';
        role: 'FAMILY_OWNER';
      }>(
        `SELECT u.id AS user_id, t.id AS tenant_id, t.type, t.status AS tenant_status,
                t.display_name, m.status AS membership_status, r.role
         FROM iam.user_account u
         JOIN iam.tenant_membership m ON m.user_id = u.id AND m.status = 'ACTIVE'
         JOIN iam.tenant t ON t.id = m.tenant_id AND t.status = 'ACTIVE'
         JOIN iam.role_assignment r ON r.user_id = u.id AND r.tenant_id = t.id
           AND r.revoked_at IS NULL AND r.effective_at <= clock_timestamp()
           AND (r.expires_at IS NULL OR r.expires_at > clock_timestamp())
         WHERE u.identity_provider = $1 AND u.identity_subject = $2 AND t.id = $3`,
        [principal.provider, principal.subject, tenantId],
      );
      const row = result.rows[0];
      if (!row)
        throw new MembershipNotFoundError(
          'Active tenant membership was not found',
        );
      await client.query('COMMIT');
      return FamilyTenantResponseSchema.parse({
        userId: row.user_id,
        tenant: {
          id: row.tenant_id,
          type: row.type,
          status: row.tenant_status,
          displayName: row.display_name,
        },
        membership: { status: row.membership_status, role: row.role },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertUser(
    client: PoolClient,
    principal: IdentityPrincipal,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO iam.user_account (id, identity_provider, identity_subject)
       VALUES ($1, $2, $3)
       ON CONFLICT (identity_provider, identity_subject)
       DO UPDATE SET identity_subject = EXCLUDED.identity_subject
       RETURNING id`,
      [randomUUID(), principal.provider, principal.subject],
    );
    const userId = result.rows[0]?.id;
    if (!userId) throw new Error('Identity upsert did not return a user id');
    return userId;
  }
}
