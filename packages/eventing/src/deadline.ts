import type {
  ClaimedScheduledDeadline,
  CreateScheduledDeadlineInput,
  DeadlineClaimOptions,
  DeadlineOperationalStatus,
  ScheduledDeadlineRecord,
  ScheduledDeadlineStatus,
} from '@carespaces/database';

export interface DeadlineStore {
  create(
    input: CreateScheduledDeadlineInput,
  ): Promise<{ deadline: ScheduledDeadlineRecord; created: boolean }>;
  cancel(input: {
    id: string;
    reasonCode: string;
    correlationId: string;
  }): Promise<boolean>;
  claimDue(options?: DeadlineClaimOptions): Promise<ClaimedScheduledDeadline[]>;
  fire(deadline: ClaimedScheduledDeadline): Promise<boolean>;
  fail(
    deadline: ClaimedScheduledDeadline,
    error: Error,
    options?: { retryAfterMs?: number; maxAttempts?: number },
  ): Promise<ScheduledDeadlineStatus | null>;
  readOperationalStatus(): Promise<DeadlineOperationalStatus[]>;
}

export interface DeadlineBatchResult {
  claimed: number;
  fired: number;
  retried: number;
  deadLettered: number;
}

export class ScheduledDeadlineScheduler {
  constructor(private readonly store: DeadlineStore) {}

  async runBatch(
    options: DeadlineClaimOptions = {},
  ): Promise<DeadlineBatchResult> {
    const deadlines = await this.store.claimDue(options);
    const result: DeadlineBatchResult = {
      claimed: deadlines.length,
      fired: 0,
      retried: 0,
      deadLettered: 0,
    };
    for (const deadline of deadlines) {
      try {
        if (!(await this.store.fire(deadline))) {
          throw new Error('Deadline lease was lost before firing');
        }
        result.fired += 1;
      } catch (cause) {
        const error =
          cause instanceof Error ? cause : new Error('Deadline firing failed');
        const status = await this.store.fail(deadline, error, options);
        if (status === 'DEAD_LETTER') result.deadLettered += 1;
        else if (status === 'SCHEDULED') result.retried += 1;
      }
    }
    return result;
  }
}

export interface DeadlineCommand {
  deadlineId: string;
  deadlineType: string;
  subjectType: string;
  subjectId: string;
  commandType: string;
  expectedState: string | null;
  expectedVersion: number | null;
  policyVersion: string;
}

export interface DeadlineSubjectSnapshot {
  state: string;
  version: number;
}

export interface DeadlineCommandHandler {
  load(command: DeadlineCommand): Promise<DeadlineSubjectSnapshot | null>;
  execute(
    command: DeadlineCommand,
    current: DeadlineSubjectSnapshot,
  ): Promise<void>;
}

export type DeadlineDispatchResult =
  | 'EXECUTED'
  | 'NOOP_SUBJECT_MISSING'
  | 'NOOP_STATE_CHANGED'
  | 'NOOP_VERSION_CHANGED';

export class DeadlineCommandDispatcher {
  private readonly handlers = new Map<string, DeadlineCommandHandler>();

  register(commandType: string, handler: DeadlineCommandHandler): this {
    this.handlers.set(commandType, handler);
    return this;
  }

  async dispatch(command: DeadlineCommand): Promise<DeadlineDispatchResult> {
    const handler = this.handlers.get(command.commandType);
    if (!handler)
      throw new Error(`No deadline handler for ${command.commandType}`);
    const current = await handler.load(command);
    if (!current) return 'NOOP_SUBJECT_MISSING';
    if (
      command.expectedState !== null &&
      command.expectedState !== current.state
    ) {
      return 'NOOP_STATE_CHANGED';
    }
    if (
      command.expectedVersion !== null &&
      command.expectedVersion !== current.version
    ) {
      return 'NOOP_VERSION_CHANGED';
    }
    await handler.execute(command, current);
    return 'EXECUTED';
  }
}

export function deadlineCommandFromPayload(payload: unknown): DeadlineCommand {
  if (!payload || typeof payload !== 'object')
    throw new Error('Deadline command payload is invalid');
  const value = payload as Record<string, unknown>;
  const required = [
    'deadlineId',
    'deadlineType',
    'subjectType',
    'subjectId',
    'commandType',
    'policyVersion',
  ] as const;
  for (const field of required) {
    if (typeof value[field] !== 'string')
      throw new Error(`Deadline command ${field} is invalid`);
  }
  if (value.expectedState !== null && typeof value.expectedState !== 'string') {
    throw new Error('Deadline command expectedState is invalid');
  }
  if (
    value.expectedVersion !== null &&
    (typeof value.expectedVersion !== 'number' ||
      !Number.isInteger(value.expectedVersion) ||
      value.expectedVersion < 0)
  ) {
    throw new Error('Deadline command expectedVersion is invalid');
  }
  return value as unknown as DeadlineCommand;
}
