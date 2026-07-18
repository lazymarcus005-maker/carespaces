import { describe, expect, it } from 'vitest';
import {
  createFakeBearerToken,
  FakeMapsAdapter,
  FakeNotificationAdapter,
  FakePspAdapter,
  FixedClock,
  IdempotencyRequestConflictError,
  InMemoryIdempotencyStore,
  InvalidStateTransitionError,
  parseFakeBearerToken,
  SequenceUuidGenerator,
  StateMachineFixture,
  StaleVersionError,
  assertExpectedVersion,
  assertIntegerMinorUnits,
  assertSafeEventPayload,
  assertTransitionEnvelope,
} from './index.js';

describe('deterministic test helpers', () => {
  it('keeps time explicit and repeatable', () => {
    const clock = new FixedClock('2026-07-17T00:00:00.000Z');

    expect(clock.now().toISOString()).toBe('2026-07-17T00:00:00.000Z');
    expect(clock.advanceBy(90_000).toISOString()).toBe(
      '2026-07-17T00:01:30.000Z',
    );
  });

  it('generates stable UUID-shaped identifiers', () => {
    const uuids = new SequenceUuidGenerator(15n);

    expect(uuids.next()).toBe('00000000-0000-4000-8000-00000000000f');
    expect(uuids.next()).toBe('00000000-0000-4000-8000-000000000010');
  });

  it('creates fake identity tokens that match the local auth adapter', () => {
    const token = createFakeBearerToken('customer-001');

    expect(parseFakeBearerToken(token)).toEqual({
      provider: 'fake',
      subject: 'customer-001',
    });
    expect(parseFakeBearerToken('Bearer other:customer-001')).toBeNull();
  });
});

describe('fake external adapters', () => {
  it('records notification attempts for assertions', () => {
    const adapter = new FakeNotificationAdapter(new SequenceUuidGenerator(1n));

    adapter.send({
      channel: 'sms',
      recipient: '+15555550100',
      template: 'booking-ready',
      payload: { jobId: 'job-1' },
    });

    expect(adapter.listAttempts()).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        channel: 'sms',
        recipient: '+15555550100',
        template: 'booking-ready',
        payload: { jobId: 'job-1' },
      },
    ]);
  });

  it('records PSP operations in command order', () => {
    const adapter = new FakePspAdapter(new SequenceUuidGenerator(2n));

    adapter.authorize({
      amountMinor: 12500,
      currency: 'USD',
      reference: 'job-1',
    });
    adapter.capture({
      amountMinor: 12500,
      currency: 'USD',
      reference: 'job-1',
    });

    expect(adapter.listOperations().map((operation) => operation.type)).toEqual(
      ['authorize', 'capture'],
    );
  });

  it('geocodes addresses deterministically without calling a network', () => {
    const adapter = new FakeMapsAdapter();

    expect(adapter.geocode('  Pilot Area 1  ')).toEqual(
      adapter.geocode('Pilot Area 1'),
    );
  });
});

describe('architecture invariant fixtures', () => {
  type TestState = 'DRAFT' | 'OPEN' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  const machine = new StateMachineFixture<TestState>({
    DRAFT: ['OPEN'],
    OPEN: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  } as const);

  it('enumerates allowed and denied state pairs for contract tests', () => {
    expect(machine.allowedPairs()).toContainEqual(['OPEN', 'CONFIRMED']);
    expect(machine.deniedPairs()).toContainEqual(['COMPLETED', 'OPEN']);
    expect(() => machine.assertTransition('DRAFT', 'OPEN')).not.toThrow();
    expect(() => machine.assertTransition('COMPLETED', 'OPEN')).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('rejects stale optimistic concurrency versions', () => {
    expect(() => assertExpectedVersion(3, 4)).toThrow(StaleVersionError);
    expect(() => assertExpectedVersion(4, 4)).not.toThrow();
  });

  it('replays the same command once and rejects key reuse', () => {
    const store = new InMemoryIdempotencyStore<{ assignmentId: string }>();
    let effects = 0;
    const execute = (hash: string) =>
      store.execute('confirm-1', hash, () => {
        effects += 1;
        return { assignmentId: 'assignment-1' };
      });

    expect(execute('request-a').replayed).toBe(false);
    expect(execute('request-a')).toEqual({
      replayed: true,
      result: { assignmentId: 'assignment-1' },
    });
    expect(effects).toBe(1);
    expect(store.size).toBe(1);
    expect(() => execute('request-b')).toThrow(IdempotencyRequestConflictError);
  });

  it('rejects sensitive fields anywhere in an event payload', () => {
    expect(() =>
      assertSafeEventPayload({ assignmentId: 'a-1', status: 'CONFIRMED' }),
    ).not.toThrow();
    expect(() =>
      assertSafeEventPayload({ nested: { exact_address: 'secret' } }),
    ).toThrow(/exact_address/);
  });

  it('requires one actor and complete transition evidence', () => {
    expect(() =>
      assertTransitionEnvelope(
        {
          commandId: 'command-1',
          correlationId: 'request-1',
          expectedVersion: 0,
          systemActor: 'deadline-service',
          reasonCode: 'reservation_expired',
        },
        { reasonRequired: true },
      ),
    ).not.toThrow();
    expect(() =>
      assertTransitionEnvelope({
        commandId: 'command-1',
        correlationId: 'request-1',
        expectedVersion: 0,
      }),
    ).toThrow(/Exactly one/);
  });

  it('requires money to use safe integer minor units', () => {
    expect(() => assertIntegerMinorUnits(12_500)).not.toThrow();
    expect(() => assertIntegerMinorUnits(12.5)).toThrow(/integer minor units/);
  });
});
