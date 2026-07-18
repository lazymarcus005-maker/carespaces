export interface Clock {
  now(): Date;
}

export * from './architecture.js';
export * from './external-contracts.js';

export class FixedClock implements Clock {
  private instant: Date;

  constructor(isoInstant = '2026-01-01T00:00:00.000Z') {
    this.instant = new Date(isoInstant);
  }

  now(): Date {
    return new Date(this.instant);
  }

  set(isoInstant: string): void {
    this.instant = new Date(isoInstant);
  }

  advanceBy(milliseconds: number): Date {
    this.instant = new Date(this.instant.getTime() + milliseconds);
    return this.now();
  }
}

export interface UuidGenerator {
  next(): string;
}

export class SequenceUuidGenerator implements UuidGenerator {
  private cursor: bigint;

  constructor(startAt = 1n) {
    this.cursor = startAt;
  }

  next(): string {
    const value = this.cursor;
    this.cursor += 1n;
    return uuidFromBigInt(value);
  }
}

export function uuidFromBigInt(value: bigint): string {
  if (value < 0n) throw new Error('UUID sequence value must be non-negative');
  const hex = value.toString(16).padStart(32, '0').slice(-32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function createFakeBearerToken(subject: string): string {
  if (!/^[a-zA-Z0-9._@+-]{1,128}$/.test(subject)) {
    throw new Error('Fake identity subject contains unsupported characters');
  }
  return `Bearer fake:${subject}`;
}

export interface FakeIdentityPrincipal {
  provider: 'fake';
  subject: string;
}

export function parseFakeBearerToken(
  authorization: string | undefined,
): FakeIdentityPrincipal | null {
  const match = authorization
    ? /^Bearer fake:([a-zA-Z0-9._@+-]{1,128})$/.exec(authorization)
    : null;
  return match?.[1] ? { provider: 'fake', subject: match[1] } : null;
}

export interface NotificationAttempt {
  id: string;
  channel: 'email' | 'push' | 'sms';
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
}

export class FakeNotificationAdapter {
  private readonly attempts: NotificationAttempt[] = [];

  constructor(private readonly uuids = new SequenceUuidGenerator()) {}

  send(input: Omit<NotificationAttempt, 'id'>): NotificationAttempt {
    const attempt = { id: this.uuids.next(), ...input };
    this.attempts.push(attempt);
    return attempt;
  }

  listAttempts(): readonly NotificationAttempt[] {
    return [...this.attempts];
  }
}

export interface PspOperation {
  id: string;
  type: 'authorize' | 'capture' | 'void' | 'refund' | 'payout';
  amountMinor: number;
  currency: string;
  reference: string;
}

export class FakePspAdapter {
  private readonly operations: PspOperation[] = [];

  constructor(private readonly uuids = new SequenceUuidGenerator()) {}

  authorize(input: Omit<PspOperation, 'id' | 'type'>): PspOperation {
    return this.record('authorize', input);
  }

  capture(input: Omit<PspOperation, 'id' | 'type'>): PspOperation {
    return this.record('capture', input);
  }

  void(input: Omit<PspOperation, 'id' | 'type'>): PspOperation {
    return this.record('void', input);
  }

  refund(input: Omit<PspOperation, 'id' | 'type'>): PspOperation {
    return this.record('refund', input);
  }

  payout(input: Omit<PspOperation, 'id' | 'type'>): PspOperation {
    return this.record('payout', input);
  }

  listOperations(): readonly PspOperation[] {
    return [...this.operations];
  }

  private record(
    type: PspOperation['type'],
    input: Omit<PspOperation, 'id' | 'type'>,
  ): PspOperation {
    const operation = { id: this.uuids.next(), type, ...input };
    this.operations.push(operation);
    return operation;
  }
}

export interface GeocodeResult {
  formattedAddress: string;
  latitude: number;
  longitude: number;
}

export class FakeMapsAdapter {
  geocode(address: string): GeocodeResult {
    const formattedAddress = address.trim();
    const seed = Array.from(formattedAddress).reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0,
    );
    return {
      formattedAddress,
      latitude: 13 + (seed % 10_000) / 10_000,
      longitude: 100 + (seed % 20_000) / 10_000,
    };
  }
}
