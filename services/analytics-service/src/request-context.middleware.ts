import { createRequestId, logEvent, withRequestContext } from '@bus/observability';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithContext extends Request {
  requestId?: string;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const requestId = createRequestId(request.headers['x-request-id']);
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    const startedAt = performance.now();
    withRequestContext(requestId, () => {
      response.once('finish', () => {
        logEvent({
          service: 'analytics-service',
          event: 'http.request.completed',
          message: `${request.method} ${request.originalUrl}`,
          requestId,
          fields: {
            method: request.method,
            path: request.originalUrl,
            statusCode: response.statusCode,
            durationMs: Math.round(performance.now() - startedAt),
          },
        });
      });
      next();
    });
  }
}
