import { createRequestId } from '@bus/observability';
import { Controller, Get, Inject, Req, ServiceUnavailableException } from '@nestjs/common';

import { NotificationRabbitConsumer } from './notification-rabbit.consumer';
import { NotificationService } from './notification.service';

interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
}

@Controller()
export class NotificationController {
  constructor(
    @Inject(NotificationService) private readonly service: NotificationService,
    @Inject(NotificationRabbitConsumer)
    private readonly consumer: NotificationRabbitConsumer,
  ) {}

  @Get('health')
  live(@Req() request: HttpRequest) {
    return health(createRequestId(request.headers['x-request-id']));
  }

  @Get('health/live')
  liveness(@Req() request: HttpRequest) {
    return health(createRequestId(request.headers['x-request-id']));
  }

  @Get('health/ready')
  async readiness(@Req() request: HttpRequest) {
    try {
      await this.service.readiness();
      if (!this.consumer.isReady()) throw new Error('RabbitMQ consumer is not ready.');
      return health(createRequestId(request.headers['x-request-id']));
    } catch {
      throw new ServiceUnavailableException({ code: 'DEPENDENCY_UNAVAILABLE' });
    }
  }
}

function health(requestId: string) {
  return {
    service: 'notification-worker',
    status: 'UP',
    version: '0.1.0',
    requestId,
    checkedAt: new Date().toISOString(),
  };
}
