import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(packageRoot, 'dist', 'migrations');

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });
cpSync(join(packageRoot, 'migrations'), destination, { recursive: true });
