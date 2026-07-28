import { Pool } from 'pg';
import { migrateUp, migrationStatus, rollbackLatest } from './migrator.js';
import { seedSynthetic } from './seed.js';

const command = process.argv[2];
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5433/carespaces';
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

try {
  if (command === 'up') {
    console.log({ applied: await migrateUp(pool) });
  } else if (command === 'down') {
    console.log({ rolledBack: await rollbackLatest(pool) });
  } else if (command === 'status') {
    console.table(await migrationStatus(pool));
  } else if (command === 'seed') {
    const summary = await seedSynthetic(pool, databaseUrl);
    console.log('Synthetic data ingestion complete.', summary);
  } else {
    throw new Error('Usage: cli.ts <up|down|status|seed>');
  }
} finally {
  await pool.end();
}
