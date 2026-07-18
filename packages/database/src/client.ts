import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index.js';

export interface DatabaseClient {
  db: NodePgDatabase<typeof schema>;
  pool: Pool;
  close(): Promise<void>;
}

export function createDatabaseClient(config: PoolConfig): DatabaseClient {
  const pool = new Pool(config);
  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
}
