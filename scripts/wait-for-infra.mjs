import { spawnSync } from 'node:child_process';

const expectedServices = ['postgres', 'redis', 'rabbitmq', 'kafka', 'nginx'];

const deadline = Date.now() + 90_000;

function readServices() {
  const result = spawnSync(
    'docker',
    ['compose', '-f', 'infra/docker-compose.yml', 'ps', '--format', 'json'],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || 'Unable to inspect Docker Compose services.');
  }

  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

while (Date.now() < deadline) {
  const services = readServices();
  const pending = expectedServices.filter((expected) => {
    const service = services.find((candidate) => candidate.Service === expected);
    return !service || service.State !== 'running' || service.Health !== 'healthy';
  });

  if (pending.length === 0) {
    console.log('All infrastructure services are healthy.');
    process.exit(0);
  }

  console.log(`Waiting for: ${pending.join(', ')}`);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

console.error('Infrastructure did not become ready within 90 seconds.');
process.exit(1);
