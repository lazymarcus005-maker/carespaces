import { PostgresDeadlineStore } from '@carespaces/eventing';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://carespaces_app:carespaces_app@127.0.0.1:54329/carespaces_development',
  max: 1,
});
try {
  const rows = await new PostgresDeadlineStore(pool).readOperationalStatus();
  console.table(rows);
  if (rows.some((row) => row.overdue > 0 || row.status === 'DEAD_LETTER')) {
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
