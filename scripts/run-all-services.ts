import { spawn, spawnSync } from 'node:child_process';

const ingestion = spawnSync('pnpm', ['data:ingest'], {
  shell: process.platform === 'win32',
  stdio: 'inherit',
});
if (ingestion.status !== 0) {
  process.exitCode = ingestion.status ?? 1;
} else {
  console.log('\nServices:');
  console.log('  Customer web  http://localhost:3000');
  console.log('  Admin web     http://localhost:3001');
  console.log('  API docs      http://127.0.0.1:4000/docs\n');

  const services = spawn('pnpm', ['dev'], {
    env: {
      ...process.env,
      DATABASE_URL:
        'postgresql://carespaces_app:carespaces_app@127.0.0.1:5433/carespaces_development',
    },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  services.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}
