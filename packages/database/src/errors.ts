export class IdempotencyRequestConflictError extends Error {
  constructor(message = 'Idempotency key was reused with a different request') {
    super(message);
    this.name = 'IdempotencyRequestConflictError';
  }
}

export class StaleVersionError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
    message = `Expected version ${expectedVersion} but found ${actualVersion}`,
  ) {
    super(message);
    this.name = 'StaleVersionError';
  }
}

export class OpsTaskNotFoundError extends Error {
  constructor(message = 'Ops Task not found') {
    super(message);
    this.name = 'OpsTaskNotFoundError';
  }
}

export class OpsTaskStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpsTaskStateError';
  }
}

export class OpsTaskDedupeConflictError extends Error {
  constructor(message = 'Ops Task dedupe key was reused with different input') {
    super(message);
    this.name = 'OpsTaskDedupeConflictError';
  }
}
