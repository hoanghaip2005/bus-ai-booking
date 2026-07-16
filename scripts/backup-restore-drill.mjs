import { spawnSync } from 'node:child_process';

const compose = ['compose', '-f', 'infra/docker-compose.yml', 'exec', '-T', 'postgres'];
const user = process.env.POSTGRES_USER ?? 'bus';
const database = process.env.POSTGRES_DB ?? 'bus_platform';
const restoreDatabase = 'bus_platform_restore_drill';
const dumpPath = '/tmp/bus_platform_restore_drill.dump';

let failed = false;
try {
  run(['pg_dump', '-U', user, '-d', database, '-Fc', '-f', dumpPath]);
  run(['dropdb', '-U', user, '--if-exists', restoreDatabase]);
  run(['createdb', '-U', user, restoreDatabase]);
  run(['pg_restore', '-U', user, '-d', restoreDatabase, '--exit-on-error', dumpPath]);
  const verification = run(
    [
      'psql',
      '-U',
      user,
      '-d',
      restoreDatabase,
      '-Atc',
      "SELECT to_regclass('booking.bookings') IS NOT NULL AND to_regclass('analytics.processed_events') IS NOT NULL;",
    ],
    true,
  );
  if (verification.trim() !== 't') throw new Error('Restored database is missing required tables.');
  console.log('PostgreSQL backup/restore drill passed in an isolated temporary database.');
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : 'Backup/restore drill failed.');
} finally {
  run(['dropdb', '-U', user, '--if-exists', restoreDatabase], false, true);
  run(['rm', '-f', dumpPath], false, true);
}

if (failed) process.exit(1);

function run(args, capture = false, ignoreFailure = false) {
  const result = spawnSync(
    process.platform === 'win32' ? 'docker.exe' : 'docker',
    [...compose, ...args],
    {
      encoding: capture ? 'utf8' : undefined,
      stdio: capture ? 'pipe' : 'inherit',
      shell: false,
    },
  );
  if (result.status !== 0 && !ignoreFailure) {
    const detail = capture ? String(result.stderr ?? '').trim() : '';
    throw new Error(`Command failed: ${args[0]}${detail ? ` (${detail})` : ''}`);
  }
  return capture ? String(result.stdout ?? '') : '';
}
