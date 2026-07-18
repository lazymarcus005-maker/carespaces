import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';

const MIGRATION_LOCK_ID = 1_128_888_211;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const builtMigrationsDirectory = join(moduleDirectory, 'migrations');
const migrationsDirectory = existsSync(builtMigrationsDirectory)
  ? builtMigrationsDirectory
  : join(moduleDirectory, '../migrations');
const migrationPattern = /^(\d{4}_[a-z0-9_]+)\.up\.sql$/;

export interface MigrationStatus {
  id: string;
  checksum: string;
  appliedAt: Date | null;
}

interface MigrationFile {
  id: string;
  checksum: string;
  upSql: string;
  downSql: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const files = await readdir(migrationsDirectory);
  return Promise.all(
    files
      .map((name) => migrationPattern.exec(name)?.[1])
      .filter((id): id is string => Boolean(id))
      .sort()
      .map(async (id) => {
        const upSql = await readFile(
          join(migrationsDirectory, `${id}.up.sql`),
          'utf8',
        );
        const downSql = await readFile(
          join(migrationsDirectory, `${id}.down.sql`),
          'utf8',
        );
        return {
          id,
          checksum: createHash('sha256').update(upSql).digest('hex'),
          upSql,
          downSql,
        };
      }),
  );
}

async function ensureLedger(client: PoolClient): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS platform');
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform.schema_migration (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
}

async function withMigrationLock<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await ensureLedger(client);
    return await operation(client);
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID])
      .catch(() => undefined);
    client.release();
  }
}

export async function migrateUp(pool: Pool): Promise<string[]> {
  const migrations = await loadMigrations();
  return withMigrationLock(pool, async (client) => {
    const result = await client.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM platform.schema_migration ORDER BY id',
    );
    const applied = new Map(result.rows.map((row) => [row.id, row.checksum]));
    const completed: string[] = [];

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.id);
      if (existingChecksum && existingChecksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.id} checksum changed after application`,
        );
      }
      if (existingChecksum) continue;

      await client.query('BEGIN');
      try {
        await client.query(migration.upSql);
        await client.query(
          'INSERT INTO platform.schema_migration (id, checksum) VALUES ($1, $2)',
          [migration.id, migration.checksum],
        );
        await client.query('COMMIT');
        completed.push(migration.id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return completed;
  });
}

export async function rollbackLatest(pool: Pool): Promise<string | null> {
  const migrations = await loadMigrations();
  return withMigrationLock(pool, async (client) => {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM platform.schema_migration ORDER BY id DESC LIMIT 1',
    );
    const id = result.rows[0]?.id;
    if (!id) return null;
    const migration = migrations.find((candidate) => candidate.id === id);
    if (!migration)
      throw new Error(`Applied migration ${id} has no local down migration`);

    await client.query('BEGIN');
    try {
      await client.query(migration.downSql);
      await client.query(
        'DELETE FROM platform.schema_migration WHERE id = $1',
        [id],
      );
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function migrationStatus(pool: Pool): Promise<MigrationStatus[]> {
  const migrations = await loadMigrations();
  return withMigrationLock(pool, async (client) => {
    const result = await client.query<{
      id: string;
      checksum: string;
      applied_at: Date;
    }>(
      'SELECT id, checksum, applied_at FROM platform.schema_migration ORDER BY id',
    );
    const applied = new Map(result.rows.map((row) => [row.id, row]));
    return migrations.map((migration) => ({
      id: migration.id,
      checksum: migration.checksum,
      appliedAt: applied.get(migration.id)?.applied_at ?? null,
    }));
  });
}
