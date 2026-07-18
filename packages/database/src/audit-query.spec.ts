import { describe, expect, it } from 'vitest';
import {
  exportAuditTimelineCsv,
  readAuditTimeline,
  redactAuditMetadata,
} from './audit-query.js';

interface QueryCall {
  sql: string;
  values: unknown[];
}

function createDependencies() {
  const writerCalls: QueryCall[] = [];
  const readerCalls: QueryCall[] = [];
  return {
    writerCalls,
    readerCalls,
    dependencies: {
      nextId: () => '00000000-0000-4000-8000-000000000099',
      writer: {
        query: (sql: string, values: unknown[]) => {
          writerCalls.push({ sql, values });
          return Promise.resolve({ rows: [] });
        },
      },
      reader: {
        query: (sql: string, values: unknown[]) => {
          readerCalls.push({ sql, values });
          return Promise.resolve({
            rows: [
              {
                record_type: 'STATE_TRANSITION',
                id: '00000000-0000-4000-8000-000000000010',
                tenant_id: '00000000-0000-4000-8000-000000000001',
                actor_user_id: '00000000-0000-4000-8000-000000000002',
                action: null,
                subject_type: 'tenant',
                subject_id: '00000000-0000-4000-8000-000000000001',
                from_state: null,
                to_state: 'ACTIVE',
                reason_code: 'customer_onboarding',
                correlation_id: 'request-1',
                expected_version: 0,
                resulting_version: 1,
                metadata: {
                  safe: 'visible',
                  nested: { access_token: 'secret' },
                },
                occurred_at: new Date('2026-07-18T00:00:00.000Z'),
              },
            ],
          });
        },
      },
    },
  };
}

const request = {
  actor: {
    tenantId: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
  },
  reasonCode: 'support_case_review',
  correlationId: 'audit-request-1',
  filter: {
    tenantId: '00000000-0000-4000-8000-000000000001',
    limit: 50,
  },
};

describe('privileged audit query', () => {
  it('traces the read before issuing a bounded parameterized query', async () => {
    const { dependencies, readerCalls, writerCalls } = createDependencies();

    const rows = await readAuditTimeline(dependencies, request);

    expect(writerCalls).toHaveLength(1);
    expect(writerCalls[0]?.values).toContain('audit.timeline.read');
    expect(readerCalls[0]?.sql).toContain('tenant_id = $1');
    expect(readerCalls[0]?.sql).toContain('LIMIT $2');
    expect(readerCalls[0]?.values).toEqual([
      '00000000-0000-4000-8000-000000000001',
      50,
    ]);
    expect(rows[0]?.metadata).toEqual({
      safe: 'visible',
      nested: { access_token: '[REDACTED]' },
    });
  });

  it('rejects unbounded queries and missing privileged evidence', async () => {
    const { dependencies } = createDependencies();

    await expect(
      readAuditTimeline(dependencies, {
        ...request,
        filter: {},
      }),
    ).rejects.toThrow(/bounded/);
    await expect(
      readAuditTimeline(dependencies, {
        ...request,
        reasonCode: '',
      }),
    ).rejects.toThrow(/reasonCode/);
  });

  it('traces exports and emits a metadata-free CSV projection', async () => {
    const { dependencies, writerCalls } = createDependencies();

    const csv = await exportAuditTimelineCsv(dependencies, request);

    expect(writerCalls[0]?.values).toContain('audit.timeline.export');
    expect(csv).toContain('"STATE_TRANSITION"');
    expect(csv).toContain('"2026-07-18T00:00:00.000Z"');
    expect(csv).not.toContain('secret');
    expect(csv).not.toContain('metadata');
  });

  it('redacts sensitive keys recursively without dropping safe context', () => {
    expect(
      redactAuditMetadata({
        patientName: 'secret',
        items: [{ exact_address: 'secret', result: 'ok' }],
      }),
    ).toEqual({
      patientName: '[REDACTED]',
      items: [{ exact_address: '[REDACTED]', result: 'ok' }],
    });
  });
});
