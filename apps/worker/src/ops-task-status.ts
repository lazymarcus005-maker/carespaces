import { PostgresOpsTaskService } from '@carespaces/operations';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://carespaces_app:carespaces_app@127.0.0.1:5433/carespaces_development',
  max: 1,
});

try {
  const rows = await new PostgresOpsTaskService(pool).readOperationalStatus();
  console.table(
    rows.map((row) => ({
      queue: row.queue,
      status: row.status,
      count: row.count,
      overdue: row.overdue,
      unowned: row.unowned,
      escalation: row.highestEscalationLevel,
      oldestDueAt: row.oldestDueAt?.toISOString() ?? '',
    })),
  );
  if (
    rows.some(
      (row) =>
        row.overdue > 0 ||
        (row.status === 'OPEN' && row.highestEscalationLevel > 0) ||
        (row.status === 'CLAIMED' && row.highestEscalationLevel > 0) ||
        (row.status === 'OPEN' && row.unowned > 0),
    )
  ) {
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
