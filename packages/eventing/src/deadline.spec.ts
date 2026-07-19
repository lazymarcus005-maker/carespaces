import type {
  ClaimedScheduledDeadline,
  ScheduledDeadlineRecord,
  ScheduledDeadlineStatus,
} from '@carespaces/database';
import { describe, expect, it } from 'vitest';
import {
  DeadlineCommandDispatcher,
  ScheduledDeadlineScheduler,
  type DeadlineStore,
} from './deadline.js';

const deadline: ClaimedScheduledDeadline = {
  id: '10000000-0000-4000-8000-000000000001',
  eventId: '20000000-0000-4000-8000-000000000001',
  tenantId: null,
  deadlineType: 'PROVIDER_RESERVATION_EXPIRY',
  subjectType: 'assignment',
  subjectId: '30000000-0000-4000-8000-000000000001',
  commandType: 'ExpireReservation',
  expectedState: 'RESERVED',
  expectedVersion: 3,
  policyVersion: 'reservation-v1',
  dedupeKey: 'assignment-1:reservation-v1',
  correlationId: 'request-1',
  dueAt: new Date('2026-07-19T00:00:00.000Z'),
  status: 'LEASED',
  attempts: 1,
  leaseId: '40000000-0000-4000-8000-000000000001',
};

class MemoryDeadlineStore implements DeadlineStore {
  deadlines: ClaimedScheduledDeadline[] = [];
  fireResult = true;
  failureStatus: ScheduledDeadlineStatus = 'SCHEDULED';

  create(): Promise<{ deadline: ScheduledDeadlineRecord; created: boolean }> {
    return Promise.reject(new Error('Not used'));
  }
  cancel(): Promise<boolean> {
    return Promise.reject(new Error('Not used'));
  }
  claimDue() {
    return Promise.resolve(this.deadlines.splice(0));
  }
  fire() {
    return Promise.resolve(this.fireResult);
  }
  fail() {
    return Promise.resolve(this.failureStatus);
  }
  readOperationalStatus() {
    return Promise.resolve([]);
  }
}

describe('scheduled deadline scheduler', () => {
  it('fires claimed deadlines and records exhausted failures', async () => {
    const successful = new MemoryDeadlineStore();
    successful.deadlines.push(deadline);
    await expect(
      new ScheduledDeadlineScheduler(successful).runBatch(),
    ).resolves.toEqual({
      claimed: 1,
      fired: 1,
      retried: 0,
      deadLettered: 0,
    });

    const failed = new MemoryDeadlineStore();
    failed.deadlines.push(deadline);
    failed.fireResult = false;
    failed.failureStatus = 'DEAD_LETTER';
    await expect(
      new ScheduledDeadlineScheduler(failed).runBatch(),
    ).resolves.toMatchObject({ deadLettered: 1, fired: 0 });
  });
});

describe('deadline command dispatcher', () => {
  const command = {
    deadlineId: deadline.id,
    deadlineType: deadline.deadlineType,
    subjectType: deadline.subjectType,
    subjectId: deadline.subjectId,
    commandType: deadline.commandType,
    expectedState: deadline.expectedState,
    expectedVersion: deadline.expectedVersion,
    policyVersion: deadline.policyVersion,
  };

  it('executes only after current state and version are rechecked', async () => {
    let effects = 0;
    const dispatcher = new DeadlineCommandDispatcher().register(
      command.commandType,
      {
        load: () => Promise.resolve({ state: 'RESERVED', version: 3 }),
        execute: () => {
          effects += 1;
          return Promise.resolve();
        },
      },
    );
    await expect(dispatcher.dispatch(command)).resolves.toBe('EXECUTED');
    expect(effects).toBe(1);
  });

  it('no-ops when subject state or version has changed', async () => {
    const forSnapshot = (snapshot: { state: string; version: number }) =>
      new DeadlineCommandDispatcher().register(command.commandType, {
        load: () => Promise.resolve(snapshot),
        execute: () => Promise.reject(new Error('must not execute')),
      });
    await expect(
      forSnapshot({ state: 'CONFIRMED', version: 3 }).dispatch(command),
    ).resolves.toBe('NOOP_STATE_CHANGED');
    await expect(
      forSnapshot({ state: 'RESERVED', version: 4 }).dispatch(command),
    ).resolves.toBe('NOOP_VERSION_CHANGED');
  });
});
