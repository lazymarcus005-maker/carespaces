import { describe, expect, it } from 'vitest';
import {
  appendAuditedStateTransition,
  appendAuditEvent,
  appendStateTransition,
} from './audit.js';

interface QueryCall {
  sql: string;
  values: unknown[];
}

function createRecordingClient() {
  const calls: QueryCall[] = [];
  return {
    calls,
    client: {
      query: (sql: string, values: unknown[]) => {
        calls.push({ sql, values });
        return Promise.resolve({ rows: [] });
      },
    },
  };
}

describe('audit writer', () => {
  it('appends an audit event with actor, reason and correlation evidence', async () => {
    const { calls, client } = createRecordingClient();

    const id = await appendAuditEvent(
      client,
      {
        actor: { tenantId: 'tenant-1', userId: 'user-1' },
        action: 'tenant.created',
        subject: { type: 'tenant', id: 'tenant-1' },
        reasonCode: 'customer_onboarding',
        correlationId: 'request-1',
        metadata: { source: 'api' },
      },
      { nextId: () => 'audit-1' },
    );

    expect(id).toBe('audit-1');
    expect(calls[0]?.sql).toContain('INSERT INTO platform.audit_event');
    expect(calls[0]?.values).toEqual([
      'audit-1',
      'tenant-1',
      'user-1',
      'tenant.created',
      'tenant',
      'tenant-1',
      'customer_onboarding',
      'request-1',
      '{"source":"api"}',
    ]);
  });

  it('appends state transitions with expected and resulting versions', async () => {
    const { calls, client } = createRecordingClient();

    await appendStateTransition(
      client,
      {
        actor: { tenantId: 'tenant-1', userId: 'user-1' },
        subject: { type: 'tenant', id: 'tenant-1' },
        fromState: null,
        toState: 'ACTIVE',
        reasonCode: 'customer_onboarding',
        correlationId: 'request-1',
        expectedVersion: 0,
        resultingVersion: 1,
      },
      { nextId: () => 'transition-1' },
    );

    expect(calls[0]?.sql).toContain('INSERT INTO platform.state_transition');
    expect(calls[0]?.values).toEqual([
      'transition-1',
      'tenant-1',
      'user-1',
      'tenant',
      'tenant-1',
      null,
      'ACTIVE',
      'customer_onboarding',
      'request-1',
      0,
      1,
      '{}',
    ]);
  });

  it('writes audit and transition rows as one reusable operation', async () => {
    const { calls, client } = createRecordingClient();
    const ids = ['audit-1', 'transition-1'];

    const result = await appendAuditedStateTransition(
      client,
      {
        actor: { tenantId: 'tenant-1', userId: 'user-1' },
        action: 'tenant.activated',
        subject: { type: 'tenant', id: 'tenant-1' },
        toState: 'ACTIVE',
        correlationId: 'request-1',
        resultingVersion: 1,
      },
      { nextId: () => ids.shift() ?? 'unexpected' },
    );

    expect(result).toEqual({
      auditEventId: 'audit-1',
      stateTransitionId: 'transition-1',
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.values[8]).toBe(
      '{"fromState":null,"toState":"ACTIVE","expectedVersion":null,"resultingVersion":1}',
    );
  });
});
