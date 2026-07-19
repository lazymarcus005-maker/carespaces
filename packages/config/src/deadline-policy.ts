import {
  deadlineTypes,
  type ConfigurationEnvironment,
  type ConfigurationVersionRecord,
  type CreateScheduledDeadlineInput,
  type DeadlineType,
} from '@carespaces/database';
import type { DeadlineStore } from '@carespaces/eventing';

export const deadlinePolicyConfigKey = 'platform.deadlines';

export function configurationEnvironmentFromRuntime(
  value: string | undefined,
): ConfigurationEnvironment {
  if (value === undefined || value === 'development') return 'development';
  if (value === 'test' || value === 'staging' || value === 'production') {
    return value;
  }
  throw new DeadlinePolicyError(
    `Unsupported configuration environment: ${value}`,
  );
}

export interface DeadlinePolicyEntry {
  enabled: boolean;
  durationMs: number;
  commandType: string;
}

export interface DeadlinePolicyDocument {
  timezone: 'Asia/Bangkok';
  deadlines: Record<DeadlineType, DeadlinePolicyEntry>;
}

export interface ActiveConfigurationReader {
  readActive<T>(input: {
    configKey: string;
    environment: ConfigurationEnvironment;
  }): Promise<ConfigurationVersionRecord<T> | null>;
}

export class DeadlinePolicyError extends Error {}

function parseDeadlinePolicy(value: unknown): DeadlinePolicyDocument {
  if (!value || typeof value !== 'object')
    throw new DeadlinePolicyError('Deadline policy must be an object');
  const document = value as Partial<DeadlinePolicyDocument>;
  if (document.timezone !== 'Asia/Bangkok')
    throw new DeadlinePolicyError(
      'Deadline policy timezone must be Asia/Bangkok',
    );
  if (!document.deadlines || typeof document.deadlines !== 'object') {
    throw new DeadlinePolicyError('Deadline policy entries are required');
  }
  for (const type of deadlineTypes) {
    const entry = document.deadlines[type];
    if (
      !entry ||
      typeof entry.enabled !== 'boolean' ||
      !Number.isSafeInteger(entry.durationMs) ||
      entry.durationMs < 0 ||
      entry.durationMs > 365 * 24 * 60 * 60 * 1000 ||
      typeof entry.commandType !== 'string' ||
      !/^[A-Z][a-zA-Z0-9]{2,99}$/.test(entry.commandType)
    ) {
      throw new DeadlinePolicyError(`Invalid deadline policy entry: ${type}`);
    }
  }
  return document as DeadlinePolicyDocument;
}

export class DeadlinePolicyResolver {
  constructor(
    private readonly configurations: ActiveConfigurationReader,
    private readonly environment: ConfigurationEnvironment,
  ) {}

  async resolve(deadlineType: DeadlineType): Promise<{
    policyVersion: string;
    entry: DeadlinePolicyEntry;
  }> {
    const active = await this.configurations.readActive<unknown>({
      configKey: deadlinePolicyConfigKey,
      environment: this.environment,
    });
    if (!active)
      throw new DeadlinePolicyError(
        `No active deadline policy for ${this.environment}`,
      );
    const document = parseDeadlinePolicy(active.value);
    const entry = document.deadlines[deadlineType];
    if (!entry)
      throw new DeadlinePolicyError(
        `Deadline policy entry is missing: ${deadlineType}`,
      );
    if (!entry.enabled)
      throw new DeadlinePolicyError(`${deadlineType} is disabled by policy`);
    return { policyVersion: active.version, entry };
  }
}

export type ConfiguredDeadlineInput = Omit<
  CreateScheduledDeadlineInput,
  'commandType' | 'policyVersion' | 'dueAt'
> & {
  now?: Date;
};

export class ConfiguredDeadlineService {
  constructor(
    private readonly deadlines: DeadlineStore,
    private readonly policy: DeadlinePolicyResolver,
  ) {}

  async schedule(input: ConfiguredDeadlineInput) {
    const resolved = await this.policy.resolve(input.deadlineType);
    const { now, ...deadlineInput } = input;
    const referenceTime = now ?? new Date();
    return this.deadlines.create({
      ...deadlineInput,
      commandType: resolved.entry.commandType,
      policyVersion: resolved.policyVersion,
      dueAt: new Date(referenceTime.getTime() + resolved.entry.durationMs),
    });
  }
}
