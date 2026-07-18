import './instrumentation';
import 'reflect-metadata';

import cluster, { type Worker } from 'node:cluster';

import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(port: number): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new ConsoleLogger({ colors: false, json: true }));
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  Logger.log(
    `GraphQL Gateway gateway-${port} listening on http://localhost:${port}/graphql`,
    'Bootstrap',
  );
}

function startReplicaCluster(ports: number[]): void {
  const workerPorts = new Map<number, number>();
  let shuttingDown = false;

  const forkReplica = (port: number): Worker => {
    const worker = cluster.fork({ ...process.env, GRAPHQL_PORT: String(port) });
    workerPorts.set(worker.id, port);
    return worker;
  };

  for (const port of ports) forkReplica(port);

  cluster.on('exit', (worker, code, signal) => {
    const port = workerPorts.get(worker.id);
    workerPorts.delete(worker.id);
    if (shuttingDown) {
      if (workerPorts.size === 0) process.exit(0);
      return;
    }
    if (port === undefined) return;

    Logger.error(
      `GraphQL Gateway worker for port ${port} exited (${signal ?? code}); restarting.`,
      'Bootstrap',
    );
    forkReplica(port);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      shuttingDown = true;
      for (const worker of Object.values(cluster.workers ?? {})) {
        worker?.process.kill(signal);
      }
    });
  }
}

function replicaPorts(): number[] {
  const configured = process.env.GRAPHQL_REPLICA_PORTS ?? process.env.GRAPHQL_PORT ?? '4000,4010';
  const ports = configured
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65_535);

  if (ports.length === 0 || new Set(ports).size !== ports.length) {
    throw new Error('GRAPHQL_REPLICA_PORTS must contain unique TCP ports.');
  }
  return ports;
}

if (cluster.isPrimary) {
  startReplicaCluster(replicaPorts());
} else {
  void bootstrap(Number(process.env.GRAPHQL_PORT ?? 4000));
}
