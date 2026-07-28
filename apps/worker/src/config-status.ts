import {
  configurationEnvironmentFromRuntime,
  deadlinePolicyConfigKey,
  PostgresConfigurationRegistry,
} from '@carespaces/config';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://carespaces_app:carespaces_app@127.0.0.1:5433/carespaces_development',
  max: 1,
});

async function main(): Promise<void> {
  const environment = configurationEnvironmentFromRuntime(
    process.env.CONFIGURATION_ENVIRONMENT ?? process.env.NODE_ENV,
  );
  const registry = new PostgresConfigurationRegistry(pool);
  const rows = await registry.listStatus(environment);
  console.table(
    rows.map((row) => ({
      key: row.configKey,
      environment: row.environment,
      version: row.version,
      status: row.status,
      activatedAt: row.activatedAt?.toISOString() ?? '',
    })),
  );
  const deadlinePolicyActive = rows.some(
    (row) =>
      row.configKey === deadlinePolicyConfigKey && row.status === 'ACTIVE',
  );
  if (!deadlinePolicyActive) {
    throw new Error(`No active deadline policy for ${environment}`);
  }
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 2;
  })
  .finally(() => pool.end());
