import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { createLocalWorker } from './runtime.js';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://carespaces_app:carespaces_app@127.0.0.1:54329/carespaces_development',
  max: Number(process.env.DATABASE_POOL_SIZE ?? 4),
});
const worker = createLocalWorker(pool);
const pollIntervalMs = Number(process.env.EVENT_WORKER_POLL_MS ?? 500);
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

try {
  console.log('Event worker started.');
  while (!stopping) {
    const result = await worker.runCycle();
    if (
      result.deadlines.claimed > 0 ||
      result.publisher.claimed > 0 ||
      result.consumer.claimed > 0
    ) {
      console.log('Event worker cycle.', result);
    }
    await delay(pollIntervalMs);
  }
} finally {
  await pool.end();
  console.log('Event worker stopped.');
}
