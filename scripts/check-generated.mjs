import { spawnSync } from 'node:child_process';

const insideGit = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (insideGit.status !== 0) {
  console.log('Generated contracts refreshed; git diff check skipped outside a git worktree.');
  process.exit(0);
}

const result = spawnSync(
  'git',
  [
    'diff',
    '--exit-code',
    '--',
    'packages/contracts-graphql/src/generated.ts',
    'packages/contracts-proto/src/generated',
    'packages/contracts-events/schema',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

if (result.status !== 0) {
  console.error('Generated contract files are stale. Run pnpm contracts:generate and commit them.');
  process.exit(result.status ?? 1);
}
