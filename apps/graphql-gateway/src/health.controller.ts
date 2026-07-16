import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Response } from 'express';

import { BookingGatewayService } from './booking.service';
import { CatalogHealthService } from './catalog-health.service';
import { IdentityGatewayService } from './identity.service';
import type { RequestWithContext } from './request-context.middleware';
import { SeatInventoryGatewayService } from './seat-inventory.service';
import { SeatStatusSubscriptionService } from './seat-status-subscription.service';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(CatalogHealthService) private readonly catalogHealthService: CatalogHealthService,
    @Inject(SeatInventoryGatewayService)
    private readonly seatInventoryService: SeatInventoryGatewayService,
    @Inject(SeatStatusSubscriptionService)
    private readonly seatStatusSubscriptionService: SeatStatusSubscriptionService,
    @Inject(BookingGatewayService)
    private readonly bookingService: BookingGatewayService,
    @Inject(IdentityGatewayService)
    private readonly identityService: IdentityGatewayService,
  ) {}

  @Get()
  getHealth() {
    return this.getLiveness();
  }

  @Get('live')
  getLiveness() {
    return {
      service: 'graphql-gateway',
      status: 'UP',
      version: '0.1.0',
      checkedAt: new Date().toISOString(),
    };
  }

  @Get('ready')
  async getReadiness(
    @Req() request: RequestWithContext,
    @Res() response: Response,
  ): Promise<Response> {
    try {
      const [catalog, seatInventory, seatEvents, booking, identity] = await Promise.all([
        this.catalogHealthService.check(request.requestId),
        this.seatInventoryService.check(request.requestId),
        this.seatStatusSubscriptionService.ping(),
        this.bookingService.check(request.requestId),
        this.identityService.check(request.requestId),
      ]);
      return response.status(200).json({
        service: 'graphql-gateway',
        status: 'UP',
        dependencies: { catalog, seatInventory, seatEvents, booking, identity },
        checkedAt: new Date().toISOString(),
      });
    } catch {
      return response.status(503).json({
        service: 'graphql-gateway',
        status: 'DOWN',
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          message: 'A required platform service is unavailable.',
          correlationId: request.requestId,
          retryable: true,
        },
        checkedAt: new Date().toISOString(),
      });
    }
  }
}
