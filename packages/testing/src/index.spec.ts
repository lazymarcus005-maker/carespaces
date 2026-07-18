import { describe, expect, it } from 'vitest';
import {
  createFakeBearerToken,
  FakeMapsAdapter,
  FakeNotificationAdapter,
  FakePspAdapter,
  FixedClock,
  parseFakeBearerToken,
  SequenceUuidGenerator,
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
