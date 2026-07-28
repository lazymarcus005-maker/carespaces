import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://carespaces_app:carespaces_app@127.0.0.1:5433/carespaces',
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    connectionTimeoutMillis: 5_000,
  });

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
