import './instrumentation';
import 'reflect-metadata';

import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new ConsoleLogger({ colors: false, json: true }));
  app.enableShutdownHooks();

  const port = Number(process.env.GRAPHQL_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`GraphQL Gateway listening on http://localhost:${port}/graphql`, 'Bootstrap');
}

void bootstrap();
