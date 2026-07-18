export class InvalidStateTransitionError extends Error {
  constructor(fromState: string, toState: string) {
    super(`Transition ${fromState} -> ${toState} is not allowed`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class StaleVersionError extends Error {
  constructor(expectedVersion: number, currentVersion: number) {
    super(
      `Expected aggregate version ${expectedVersion}, current version is ${currentVersion}`,
    );
    this.name = 'StaleVersionError';
  }
}

export class IdempotencyRequestConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency key ${key} was already used for another request`);
    this.name = 'IdempotencyRequestConflictError';
  }
}

export class StateMachineFixture<State extends string> {
  constructor(
    private readonly transitions: Readonly<Record<State, readonly State[]>>,
  ) {}

  canTransition(fromState: State, toState: State): boolean {
    return this.transitions[fromState].includes(toState);
  }

  assertTransition(fromState: State, toState: State): void {
    if (!this.canTransition(fromState, toState)) {
      throw new InvalidStateTransitionError(fromState, toState);
    }
  }

  allowedPairs(): ReadonlyArray<readonly [State, State]> {
    return (Object.keys(this.transitions) as State[]).flatMap((fromState) =>
      this.transitions[fromState].map(
        (toState) => [fromState, toState] as const,
      ),
    );
  }

  deniedPairs(): ReadonlyArray<readonly [State, State]> {
    const states = Object.keys(this.transitions) as State[];
    return states.flatMap((fromState) =>
      states
        .filter((toState) => !this.canTransition(fromState, toState))
        .map((toState) => [fromState, toState] as const),
    );
  }
}

export function assertExpectedVersion(
  expectedVersion: number,
  currentVersion: number,
): void {
  if (expectedVersion !== currentVersion) {
    throw new StaleVersionError(expectedVersion, currentVersion);
  }
}

interface IdempotencyRecord<Result> {
  requestHash: string;
  result: Result;
}

export class InMemoryIdempotencyStore<Result> {
  private readonly records = new Map<string, IdempotencyRecord<Result>>();

  execute(
    key: string,
    requestHash: string,
    handler: () => Result,
  ): { replayed: boolean; result: Result } {
    const existing = this.records.get(key);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyRequestConflictError(key);
      }
      return { replayed: true, result: existing.result };
    }

    const result = handler();
    this.records.set(key, { requestHash, result });
    return { replayed: false, result };
  }

  get size(): number {
    return this.records.size;
  }
}

const forbiddenEventKeys = new Set([
  'diagnosis',
  'documenttoken',
  'documenturl',
  'exactaddress',
  'medication',
  'patientname',
  'rawpsppayload',
  'token',
]);

function normalizedKey(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export function assertSafeEventPayload(payload: unknown): void {
  if (Array.isArray(payload)) {
    payload.forEach(assertSafeEventPayload);
    return;
  }
  if (!payload || typeof payload !== 'object') return;

  for (const [key, value] of Object.entries(payload)) {
    if (forbiddenEventKeys.has(normalizedKey(key))) {
      throw new Error(`Sensitive event payload field is forbidden: ${key}`);
    }
    assertSafeEventPayload(value);
  }
}

export interface TransitionEnvelopeFixture {
  commandId: string;
  correlationId: string;
  expectedVersion: number;
  actorId?: string;
  systemActor?: string;
  reasonCode?: string;
}

export function assertTransitionEnvelope(
  envelope: TransitionEnvelopeFixture,
  options: { reasonRequired?: boolean } = {},
): void {
  if (!envelope.commandId.trim()) throw new Error('commandId is required');
  if (!envelope.correlationId.trim())
    throw new Error('correlationId is required');
  if (envelope.expectedVersion < 0)
    throw new Error('expectedVersion must be non-negative');
  if (Boolean(envelope.actorId) === Boolean(envelope.systemActor)) {
    throw new Error('Exactly one actorId or systemActor is required');
  }
  if (options.reasonRequired && !envelope.reasonCode?.trim()) {
    throw new Error('reasonCode is required');
  }
}

export function assertIntegerMinorUnits(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error('Money must use safe integer minor units');
  }
}
