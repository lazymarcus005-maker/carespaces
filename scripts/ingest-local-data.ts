import { spawnSync } from 'node:child_process';

const composeArgs = ['-f', 'infrastructure/database/compose.yaml'];
const databaseName = 'carespaces_development';
const ownerDatabaseUrl = `postgresql://postgres:postgres@127.0.0.1:5433/${databaseName}`;

function run(command: string, args: string[], environment = process.env): void {
  const result = spawnSync(command, args, {
    env: environment,
    shell: process.platform === 'win32' && command === 'pnpm',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

run('docker', ['compose', ...composeArgs, 'up', '-d', '--wait']);

const databaseExists = spawnSync(
  'docker',
  [
    'compose',
    ...composeArgs,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-tAc',
    `SELECT 1 FROM pg_database WHERE datname = '${databaseName}'`,
  ],
  {
    encoding: 'utf8',
  },
);
if (databaseExists.status !== 0) {
  throw new Error('Could not inspect the local PostgreSQL databases');
}
if (databaseExists.stdout.trim() !== '1') {
  run('docker', [
    'compose',
    ...composeArgs,
    'exec',
    '-T',
    'postgres',
    'createdb',
    '-U',
    'postgres',
    databaseName,
  ]);
}

const databaseEnvironment = {
  ...process.env,
  DATABASE_URL: ownerDatabaseUrl,
};
run('pnpm', ['db:migrate'], databaseEnvironment);
run('pnpm', ['db:seed'], {
  ...databaseEnvironment,
  ALLOW_SYNTHETIC_SEED: 'true',
});

console.log(`Local data is ready in ${databaseName}.`);
