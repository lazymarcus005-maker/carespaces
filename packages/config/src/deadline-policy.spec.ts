import {
  syntheticDeadlinePolicy,
  type ConfigurationVersionRecord,
  type CreateScheduledDeadlineInput,
  type ScheduledDeadlineRecord,
} from '@carespaces/database';
import type { DeadlineStore } from '@carespaces/eventing';
import { describe, expect, it, vi } from 'vitest';
import {
  ConfiguredDeadlineService,
  DeadlinePolicyError,
  DeadlinePolicyResolver,
  type ActiveConfigurationReader,
} from './deadline-policy.js';
import {
  PostgresConfigurationRegistry,
  UnsafeConfigurationValueError,
} from './registry.js';

function activeConfiguration(
  value: unknown = syntheticDeadlinePolicy,
): ConfigurationVersionRecord {
  return {
    id: '70000000-0000-4000-8000-000000000001',
    configKey: 'platform.deadlines',
    environment: 'development',
    version: 'deadline-policy-v3',
    value,
    valueHash: 'hash',
    status: 'ACTIVE',
    changeReason: 'test',
    createdByUserId: '10000000-0000-4000-8000-000000000001',
    approvedByUserId: '10000000-0000-4000-8000-000000000002',
    activatedByUserId: '10000000-0000-4000-8000-000000000002',
    supersedesId: null,
    createdAt: new Date(),
    approvedAt: new Date(),
    activatedAt: new Date(),
    retiredAt: null,
  };
}

function reader(
  value: ConfigurationVersionRecord | null,
): ActiveConfigurationReader {
  return {
    readActive: <T>() =>
      Promise.resolve(value as ConfigurationVersionRecord<T> | null),
  };
}

describe('configured deadline policy', () => {
  it('derives command, due time, and policy version from the active snapshot', async () => {
    const create = vi.fn((input: CreateScheduledDeadlineInput) =>
      Promise.resolve({
        created: true,
        deadline: {
          ...input,
          id: 'deadline-id',
          eventId: 'event-id',
          status: 'SCHEDULED',
        } as ScheduledDeadlineRecord,
      }),
    );
    const store = { create } as unknown as DeadlineStore;
    const service = new ConfiguredDeadlineService(
      store,
      new DeadlinePolicyResolver(reader(activeConfiguration()), 'development'),
    );
    const now = new Date('2026-07-19T00:00:00.000Z');

    await service.schedule({
      deadlineType: 'PAYMENT_EXPIRY',
      subjectType: 'payment_attempt',
      subjectId: '30000000-0000-4000-8000-000000000001',
      dedupeKey: 'payment-1:expiry',
      correlationId: 'request-1',
      now,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: 'ExpirePaymentAttempt',
        policyVersion: 'deadline-policy-v3',
        dueAt: new Date(now.getTime() + 15 * 60_000),
      }),
    );
  });

  it('fails closed when no active or valid policy exists', async () => {
    await expect(
      new DeadlinePolicyResolver(reader(null), 'production').resolve(
        'PAYMENT_EXPIRY',
      ),
    ).rejects.toBeInstanceOf(DeadlinePolicyError);

    await expect(
      new DeadlinePolicyResolver(
        reader(activeConfiguration({ timezone: 'UTC', deadlines: {} })),
        'development',
      ).resolve('PAYMENT_EXPIRY'),
    ).rejects.toThrow('timezone must be Asia/Bangkok');
  });

  it('rejects secret fields without blocking domain credential names', () => {
    const registry = new PostgresConfigurationRegistry({} as never);
    expect(() =>
      registry.createDraft({
        configKey: 'platform.test',
        environment: 'development',
        version: 'v1',
        value: { apiKey: 'must-not-be-stored' },
        changeReason: 'test',
        createdByUserId: '10000000-0000-4000-8000-000000000001',
        correlationId: 'test',
      }),
    ).toThrow(UnsafeConfigurationValueError);
  });
});
