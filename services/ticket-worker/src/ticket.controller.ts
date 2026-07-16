import { currentTraceContext, createRequestId } from '@bus/observability';
import type { Metadata } from '@grpc/grpc-js';
import { status } from '@grpc/grpc-js';
import { Controller, Get, Inject, Req, ServiceUnavailableException } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';

import { TicketRabbitConsumer } from './ticket-rabbit.consumer';
import { TicketService } from './ticket.service';

interface ListRequest {
  bookingId?: string;
  owner?: { type?: number | string; id?: string };
  requestId?: string;
}

interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
}

@Controller()
export class TicketController {
  constructor(
    @Inject(TicketService) private readonly ticketService: TicketService,
    @Inject(TicketRabbitConsumer) private readonly rabbitConsumer: TicketRabbitConsumer,
  ) {}

  @Get('health')
  liveness(@Req() request: HttpRequest) {
    return healthResponse(createRequestId(request.headers['x-request-id']));
  }

  @Get('health/live')
  live(@Req() request: HttpRequest) {
    return healthResponse(createRequestId(request.headers['x-request-id']));
  }

  @Get('health/ready')
  async ready(@Req() request: HttpRequest) {
    try {
      await this.ticketService.readiness();
      if (!this.rabbitConsumer.isReady()) throw new Error('RabbitMQ consumer is not ready.');
      return healthResponse(createRequestId(request.headers['x-request-id']));
    } catch {
      throw new ServiceUnavailableException({ code: 'DEPENDENCY_UNAVAILABLE' });
    }
  }

  @GrpcMethod('TicketService', 'Health')
  async grpcHealth(request: { requestId?: string }, metadata: Metadata) {
    const requestId = grpcRequestId(request.requestId, metadata);
    try {
      await this.ticketService.readiness();
      if (!this.rabbitConsumer.isReady()) throw new Error('RabbitMQ consumer is not ready.');
      return healthResponse(requestId);
    } catch {
      throw new RpcException({ code: status.UNAVAILABLE, message: 'Ticket worker unavailable.' });
    }
  }

  @GrpcMethod('TicketService', 'ListBookingTickets')
  async listBookingTickets(request: ListRequest, metadata: Metadata) {
    const requestId = grpcRequestId(request.requestId, metadata);
    const owner = mapOwner(request.owner);
    if (!owner || !isUuid(request.bookingId ?? '')) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Ticket lookup is invalid.',
      });
    }
    assertCustomerOwner(metadata, owner);
    const tickets = await this.ticketService.listBookingTickets(request.bookingId ?? '', owner);
    return {
      bookingId: request.bookingId,
      ready: tickets.length > 0,
      tickets: tickets.map((ticket) => ({
        ...ticket,
        pdfDocument: ticket.pdfDocument,
      })),
      requestId,
    };
  }
}

function healthResponse(requestId: string) {
  return {
    service: 'ticket-worker',
    status: 'UP',
    version: '0.1.0',
    requestId,
    checkedAt: new Date().toISOString(),
    traceId: currentTraceContext().traceId ?? 'unavailable',
  };
}

function grpcRequestId(requestId: string | undefined, metadata: Metadata): string {
  const metadataRequestId = metadata.get('x-request-id')[0];
  return createRequestId(typeof metadataRequestId === 'string' ? metadataRequestId : requestId);
}

function mapOwner(owner: ListRequest['owner']) {
  if (!owner || !isUuid(owner.id ?? '')) return undefined;
  if (owner.type === 1 || owner.type === 'TICKET_OWNER_TYPE_GUEST_SESSION') {
    return { type: 'GUEST_SESSION' as const, id: owner.id ?? '' };
  }
  if (owner.type === 2 || owner.type === 'TICKET_OWNER_TYPE_CUSTOMER') {
    return { type: 'CUSTOMER' as const, id: owner.id ?? '' };
  }
  return undefined;
}

function assertCustomerOwner(
  metadata: Metadata,
  owner: { type: 'GUEST_SESSION' | 'CUSTOMER'; id: string },
): void {
  if (owner.type !== 'CUSTOMER') return;
  const actorId = metadata.get('x-actor-id')[0];
  const actorRole = metadata.get('x-actor-role')[0];
  const tokenId = metadata.get('x-actor-token-id')[0];
  if (
    actorRole !== 'CUSTOMER' ||
    actorId !== owner.id ||
    typeof tokenId !== 'string' ||
    !isUuid(tokenId)
  ) {
    throw new RpcException({ code: status.PERMISSION_DENIED, message: 'Customer actor required.' });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
