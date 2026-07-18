import { randomUUID } from 'node:crypto';

import { createRequestId, logEvent, withRequestContext } from '@bus/observability';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithContext extends Request {
  requestId?: string;
  searchSessionId?: string;
  checkoutSessionId?: string;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const requestId = createRequestId(request.headers['x-request-id']);
    const inboundSearchSessionId = request.headers['x-search-session-id'];
    const searchSessionId =
      typeof inboundSearchSessionId === 'string' && isUuid(inboundSearchSessionId)
        ? inboundSearchSessionId
        : randomUUID();
    const inboundCheckoutSessionId = request.headers['x-checkout-session-id'];
    const checkoutSessionId =
      typeof inboundCheckoutSessionId === 'string' && isUuid(inboundCheckoutSessionId)
        ? inboundCheckoutSessionId
        : randomUUID();
    request.requestId = requestId;
    request.searchSessionId = searchSessionId;
    request.checkoutSessionId = checkoutSessionId;
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-search-session-id', searchSessionId);
    response.setHeader('x-checkout-session-id', checkoutSessionId);
    const localPort = request.socket?.localPort ?? Number(process.env.GRAPHQL_PORT ?? 4000);
    response.setHeader('x-gateway-instance', `gateway-${localPort}`);
    const startedAt = performance.now();

    withRequestContext(requestId, () => {
      response.once('finish', () => {
        logEvent({
          service: 'graphql-gateway',
          event: 'http.request.completed',
          message: `${request.method} ${request.originalUrl}`,
          requestId,
          fields: {
            method: request.method,
            path: request.originalUrl,
            statusCode: response.statusCode,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          },
        });
      });
      next();
    });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
