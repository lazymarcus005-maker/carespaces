import {
  activateConfigurationVersion,
  appendAuditEvent,
  approveConfigurationVersion,
  configurationValueHash,
  createConfigurationVersion,
  listConfigurationStatus,
  readActiveConfiguration,
  readConfigurationVersion,
  retireActiveConfiguration,
  type ConfigurationEnvironment,
  type ConfigurationStatusSummary,
  type ConfigurationVersionRecord,
  type CreateConfigurationVersionInput,
} from '@carespaces/database';
import type { Pool, PoolClient } from 'pg';

export class ConfigurationApprovalError extends Error {}
export class ConfigurationActivationError extends Error {}
export class ConfigurationIntegrityError extends Error {}
export class UnsafeConfigurationValueError extends Error {}

const unsafeKey =
  /^(?:password|secret|token|private.?key|api.?key|client.?secret|access.?token|refresh.?token|credential)$/i;

function assertSafeConfigurationValue(value: unknown, path = 'value'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSafeConfigurationValue(item, `${path}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (unsafeKey.test(key)) {
      throw new UnsafeConfigurationValueError(
        `Secrets are not allowed in configuration values: ${path}.${key}`,
      );
    }
    assertSafeConfigurationValue(item, `${path}.${key}`);
  }
}

function assertIntegrity(record: ConfigurationVersionRecord): void {
  if (configurationValueHash(record.value) !== record.valueHash) {
    throw new ConfigurationIntegrityError(
      `Configuration ${record.configKey}@${record.version} failed integrity validation`,
    );
  }
}

export class PostgresConfigurationRegistry {
  constructor(private readonly pool: Pool) {}

  createDraft<T>(
    input: CreateConfigurationVersionInput<T> & { correlationId: string },
  ) {
    assertSafeConfigurationValue(input.value);
    return this.withClient(async (client) => {
      const record = await createConfigurationVersion(client, input);
      await appendAuditEvent(client, {
        actor: { userId: input.createdByUserId },
        action: 'configuration.drafted',
        subject: { type: 'configuration_version', id: record.id },
        reasonCode: input.changeReason,
        correlationId: input.correlationId,
        metadata: {
          configKey: record.configKey,
          environment: record.environment,
          version: record.version,
          valueHash: record.valueHash,
        },
      });
      return record;
    });
  }

  approve(input: {
    id: string;
    approvedByUserId: string;
    reasonCode: string;
    correlationId: string;
  }): Promise<boolean> {
    return this.withClient(async (client) => {
      const record = await readConfigurationVersion(client, input.id);
      if (!record)
        throw new ConfigurationApprovalError('Configuration not found');
      if (
        (record.environment === 'staging' ||
          record.environment === 'production') &&
        record.createdByUserId === input.approvedByUserId
      ) {
        throw new ConfigurationApprovalError(
          'Staging and production configuration require a different approver',
        );
      }
      const approved = await approveConfigurationVersion(client, input);
      if (!approved)
        throw new ConfigurationApprovalError(
          'Only a draft configuration can be approved',
        );
      await appendAuditEvent(client, {
        actor: { userId: input.approvedByUserId },
        action: 'configuration.approved',
        subject: { type: 'configuration_version', id: input.id },
        reasonCode: input.reasonCode,
        correlationId: input.correlationId,
        metadata: {
          configKey: record.configKey,
          environment: record.environment,
          version: record.version,
        },
      });
      return true;
    });
  }

  activate(input: {
    id: string;
    activatedByUserId: string;
    reasonCode: string;
    correlationId: string;
  }): Promise<boolean> {
    return this.withClient(async (client) => {
      const target = await this.lockTarget(client, input.id);
      if (target.status !== 'APPROVED') {
        throw new ConfigurationActivationError(
          'Only an approved configuration can be activated',
        );
      }
      const retiredIds = await retireActiveConfiguration(client, target);
      const activated = await activateConfigurationVersion(client, {
        id: target.id,
        activatedByUserId: input.activatedByUserId,
      });
      if (!activated)
        throw new ConfigurationActivationError(
          'Configuration activation failed',
        );
      await this.appendActivationAudit(client, {
        ...input,
        target,
        retiredIds,
        action: 'configuration.activated',
      });
      return true;
    });
  }

  rollback(input: {
    targetId: string;
    activatedByUserId: string;
    reasonCode: string;
    correlationId: string;
  }): Promise<boolean> {
    return this.withClient(async (client) => {
      const target = await this.lockTarget(client, input.targetId);
      if (target.status !== 'RETIRED') {
        throw new ConfigurationActivationError(
          'Rollback target must be a retired configuration',
        );
      }
      const retiredIds = await retireActiveConfiguration(client, target);
      const activated = await activateConfigurationVersion(client, {
        id: target.id,
        activatedByUserId: input.activatedByUserId,
        allowRetired: true,
      });
      if (!activated)
        throw new ConfigurationActivationError('Configuration rollback failed');
      await this.appendActivationAudit(client, {
        id: target.id,
        activatedByUserId: input.activatedByUserId,
        reasonCode: input.reasonCode,
        correlationId: input.correlationId,
        target,
        retiredIds,
        action: 'configuration.rolled_back',
      });
      return true;
    });
  }

  async readActive<T>(input: {
    configKey: string;
    environment: ConfigurationEnvironment;
  }): Promise<ConfigurationVersionRecord<T> | null> {
    const record = await readActiveConfiguration<T>(this.pool, input);
    if (record) assertIntegrity(record);
    return record;
  }

  listStatus(
    environment?: ConfigurationEnvironment,
  ): Promise<ConfigurationStatusSummary[]> {
    return listConfigurationStatus(this.pool, environment);
  }

  private async lockTarget(
    client: PoolClient,
    id: string,
  ): Promise<ConfigurationVersionRecord> {
    const target = await readConfigurationVersion(client, id);
    if (!target)
      throw new ConfigurationActivationError('Configuration not found');
    assertIntegrity(target);
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`configuration:${target.environment}:${target.configKey}`],
    );
    return target;
  }

  private appendActivationAudit(
    client: PoolClient,
    input: {
      id: string;
      activatedByUserId: string;
      reasonCode: string;
      correlationId: string;
      target: ConfigurationVersionRecord;
      retiredIds: string[];
      action: 'configuration.activated' | 'configuration.rolled_back';
    },
  ): Promise<string> {
    return appendAuditEvent(client, {
      actor: { userId: input.activatedByUserId },
      action: input.action,
      subject: { type: 'configuration_version', id: input.id },
      reasonCode: input.reasonCode,
      correlationId: input.correlationId,
      metadata: {
        configKey: input.target.configKey,
        environment: input.target.environment,
        version: input.target.version,
        valueHash: input.target.valueHash,
        retiredVersionIds: input.retiredIds,
      },
    });
  }

  private async withClient<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
