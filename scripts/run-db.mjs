import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const action = process.argv[2];
const directories = {
  migrate: {
    host: resolve('infra/postgres/migrations'),
    container: '/workspace/infra/postgres/migrations',
  },
  seed: {
    host: resolve('infra/postgres/seeds'),
    container: '/workspace/infra/postgres/seeds',
  },
};

if (!(action in directories)) {
  console.error('Usage: node scripts/run-db.mjs <migrate|seed>');
  process.exit(1);
}

const directory = directories[action];
const sqlFiles = readdirSync(directory.host)
  .filter((file) => file.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right));

for (const sqlFile of sqlFiles) {
  const version = sqlFile.replace(/\.sql$/, '');
  if (action === 'migrate' && sqlFile !== '001_foundation.sql' && migrationApplied(version)) {
    console.log(`Skipping applied migration ${sqlFile}`);
    continue;
  }
  console.log(`Applying ${action} file ${sqlFile}`);
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/docker-compose.yml',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      process.env.POSTGRES_USER ?? 'bus',
      '-d',
      process.env.POSTGRES_DB ?? 'bus_platform',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      `${directory.container}/${sqlFile}`,
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function migrationApplied(version) {
  if (!/^[A-Za-z0-9_]+$/.test(version)) {
    throw new Error(`Migration filename contains unsupported characters: ${version}`);
  }
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/docker-compose.yml',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      process.env.POSTGRES_USER ?? 'bus',
      '-d',
      process.env.POSTGRES_DB ?? 'bus_platform',
      '-Atc',
      `SELECT 1 FROM platform.schema_migrations WHERE version = '${version}'`,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? 'Failed to inspect migration state.\n');
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim() === '1';
}

if (sqlFiles.length === 0) {
  console.warn(`No SQL files found for ${action}.`);
}
