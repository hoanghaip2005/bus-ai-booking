import './instrumentation';
import 'reflect-metadata';

import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new ConsoleLogger({ colors: false, json: true }));
  app.enableShutdownHooks();
  const port = Number(process.env.NOTIFICATION_HTTP_PORT ?? 3007);
  await app.listen(port, '0.0.0.0');
  Logger.log(
    `Notification Worker HTTP health listening on http://localhost:${port}/health`,
    'Bootstrap',
  );
}

void bootstrap();
