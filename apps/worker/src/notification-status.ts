import { PostgresNotificationService } from '@carespaces/notifications';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://carespaces_app:carespaces_app@127.0.0.1:54329/carespaces_development',
  max: 1,
});

try {
  const rows =
    await new PostgresNotificationService(pool).readOperationalStatus();
  console.table(
    rows.map((row) => ({
      status: row.status,
      count: row.count,
      overdue: row.overdue,
      deadLettered: row.deadLettered,
      oldestNextAttemptAt: row.oldestNextAttemptAt?.toISOString() ?? '',
    })),
  );
  if (
    rows.some(
      (row) => row.overdue > 0 || row.deadLettered > 0 || row.status === 'TERMINAL_FAILED',
    )
  ) {
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}