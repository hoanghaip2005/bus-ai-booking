import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceEnvPath = resolve(appRoot, '../..', '.env');
const environment = { ...process.env };

if (existsSync(workspaceEnvPath)) {
  const workspaceEnvironment = parseEnv(readFileSync(workspaceEnvPath, 'utf8'));
  for (const [name, value] of Object.entries(workspaceEnvironment)) {
    if (name !== 'NODE_ENV' && environment[name] === undefined) environment[name] = value;
  }
}

console.info(
  JSON.stringify({
    event: 'web_environment_loaded',
    openAiConfigured: Boolean(environment.OPENAI_API_KEY?.trim()),
    openAiModel: environment.OPENAI_MODEL?.trim() || 'gpt-5.4-mini',
  }),
);

const nextBin = resolve(appRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  cwd: appRoot,
  env: environment,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
