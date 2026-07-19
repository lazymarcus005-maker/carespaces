import { createHash, randomUUID } from 'node:crypto';
import type { EventQueryRunner } from './events.js';

export const configurationEnvironments = [
  'development',
  'test',
  'staging',
  'production',
] as const;

export type ConfigurationEnvironment =
  (typeof configurationEnvironments)[number];
export type ConfigurationVersionStatus =
  'DRAFT' | 'APPROVED' | 'ACTIVE' | 'RETIRED';

export interface ConfigurationVersionRecord<T = unknown> {
  id: string;
  configKey: string;
  environment: ConfigurationEnvironment;
  version: string;
  value: T;
  valueHash: string;
  status: ConfigurationVersionStatus;
  changeReason: string;
  createdByUserId: string;
  approvedByUserId: string | null;
  activatedByUserId: string | null;
  supersedesId: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  activatedAt: Date | null;
  retiredAt: Date | null;
}

export interface CreateConfigurationVersionInput<T = unknown> {
  id?: string;
  configKey: string;
  environment: ConfigurationEnvironment;
  version: string;
  value: T;
  changeReason: string;
  createdByUserId: string;
  supersedesId?: string | null;
}

export interface ConfigurationStatusSummary {
  configKey: string;
  environment: ConfigurationEnvironment;
  version: string;
  status: ConfigurationVersionStatus;
  activatedAt: Date | null;
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected database string');
  return value;
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : asString(value);
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  throw new Error('Expected database date');
}

function asNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : asDate(value);
}

function configurationFromRow<T>(
  row: Record<string, unknown>,
): ConfigurationVersionRecord<T> {
  return {
    id: asString(row.id),
    configKey: asString(row.config_key),
    environment: asString(row.environment) as ConfigurationEnvironment,
    version: asString(row.version),
    value: row.value as T,
    valueHash: asString(row.value_hash),
    status: asString(row.status) as ConfigurationVersionStatus,
    changeReason: asString(row.change_reason),
    createdByUserId: asString(row.created_by_user_id),
    approvedByUserId: asNullableString(row.approved_by_user_id),
    activatedByUserId: asNullableString(row.activated_by_user_id),
    supersedesId: asNullableString(row.supersedes_id),
    createdAt: asDate(row.created_at),
    approvedAt: asNullableDate(row.approved_at),
    activatedAt: asNullableDate(row.activated_at),
    retiredAt: asNullableDate(row.retired_at),
  };
}

const columns = `id, config_key, environment, version, value, value_hash,
  status, change_reason, created_by_user_id, approved_by_user_id,
  activated_by_user_id, supersedes_id, created_at, approved_at,
  activated_at, retired_at`;

export function configurationValueHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error('Configuration value is not JSON serializable');
  return serialized;
}

export async function createConfigurationVersion<T>(
  client: EventQueryRunner,
  input: CreateConfigurationVersionInput<T>,
): Promise<ConfigurationVersionRecord<T>> {
  const result = await client.query(
    `INSERT INTO platform.configuration_version
     (id, config_key, environment, version, value, value_hash, change_reason,
      created_by_user_id, supersedes_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     RETURNING ${columns}`,
    [
      input.id ?? randomUUID(),
      input.configKey,
      input.environment,
      input.version,
      JSON.stringify(input.value),
      configurationValueHash(input.value),
      input.changeReason,
      input.createdByUserId,
      input.supersedesId ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Configuration insert did not return a row');
  return configurationFromRow<T>(row);
}

export async function readConfigurationVersion<T>(
  client: EventQueryRunner,
  id: string,
): Promise<ConfigurationVersionRecord<T> | null> {
  const result = await client.query(
    `SELECT ${columns} FROM platform.configuration_version WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? configurationFromRow<T>(row) : null;
}

export async function approveConfigurationVersion(
  client: EventQueryRunner,
  input: { id: string; approvedByUserId: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE platform.configuration_version
     SET status = 'APPROVED', approved_by_user_id = $2,
         approved_at = clock_timestamp()
     WHERE id = $1 AND status = 'DRAFT'
       AND (
         environment NOT IN ('staging', 'production')
         OR created_by_user_id <> $2
       )
     RETURNING id`,
    [input.id, input.approvedByUserId],
  );
  return result.rows.length > 0;
}

export async function retireActiveConfiguration(
  client: EventQueryRunner,
  input: {
    configKey: string;
    environment: ConfigurationEnvironment;
  },
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `UPDATE platform.configuration_version
     SET status = 'RETIRED', retired_at = clock_timestamp()
     WHERE config_key = $1 AND environment = $2 AND status = 'ACTIVE'
     RETURNING id`,
    [input.configKey, input.environment],
  );
  return result.rows.map((row) => row.id);
}

export async function activateConfigurationVersion(
  client: EventQueryRunner,
  input: {
    id: string;
    activatedByUserId: string;
    allowRetired?: boolean;
  },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE platform.configuration_version
     SET status = 'ACTIVE', activated_by_user_id = $2,
         activated_at = clock_timestamp(), retired_at = NULL
     WHERE id = $1
       AND (status = 'APPROVED' OR ($3::boolean AND status = 'RETIRED'))
     RETURNING id`,
    [input.id, input.activatedByUserId, input.allowRetired ?? false],
  );
  return result.rows.length > 0;
}

export async function readActiveConfiguration<T>(
  client: EventQueryRunner,
  input: { configKey: string; environment: ConfigurationEnvironment },
): Promise<ConfigurationVersionRecord<T> | null> {
  const result = await client.query(
    `SELECT ${columns} FROM platform.configuration_version
     WHERE config_key = $1 AND environment = $2 AND status = 'ACTIVE'`,
    [input.configKey, input.environment],
  );
  const row = result.rows[0];
  return row ? configurationFromRow<T>(row) : null;
}

export async function listConfigurationStatus(
  client: EventQueryRunner,
  environment?: ConfigurationEnvironment,
): Promise<ConfigurationStatusSummary[]> {
  const result = await client.query(
    `SELECT config_key, environment, version, status, activated_at
     FROM platform.configuration_version
     WHERE ($1::text IS NULL OR environment = $1)
     ORDER BY environment, config_key, created_at DESC`,
    [environment ?? null],
  );
  return result.rows.map((row) => ({
    configKey: asString(row.config_key),
    environment: asString(row.environment) as ConfigurationEnvironment,
    version: asString(row.version),
    status: asString(row.status) as ConfigurationVersionStatus,
    activatedAt: asNullableDate(row.activated_at),
  }));
}
