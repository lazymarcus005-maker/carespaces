import { PostgresEventStore } from '@carespaces/eventing';
import { Pool } from 'pg';

const [kind, id, reasonCode, correlationId] = process.argv.slice(2);
if (
  (kind !== 'inbox' && kind !== 'outbox') ||
  !id ||
  !reasonCode ||
  !correlationId
) {
  throw new Error(
    'Usage: replay.ts <inbox|outbox> <uuid> <reason-code> <correlation-id>',
  );
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://carespaces_app:carespaces_app@127.0.0.1:54329/carespaces_development',
  max: 1,
});
try {
  const replayed = await new PostgresEventStore(pool).replayDeadLetter({
    kind,
    id,
    reasonCode,
    correlationId,
  });
  if (!replayed) throw new Error('Dead-letter event was not found');
  console.log('Dead-letter event queued for replay.', {
    kind,
    id,
    correlationId,
  });
} finally {
  await pool.end();
}
