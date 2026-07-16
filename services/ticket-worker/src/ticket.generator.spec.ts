import { describe, expect, it } from 'vitest';

import { TicketGenerator } from './ticket.generator';
import type { FulfillmentSnapshot } from './ticket.types';

describe('TicketGenerator', () => {
  it('creates deterministic HTML and PDF tickets with Vietnamese content and QR payload', async () => {
    const generator = new TicketGenerator();
    const first = await generator.generate(snapshot, '2030-06-19T18:00:00.000Z');
    const replay = await generator.generate(snapshot, '2030-06-19T18:00:00.000Z');

    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBe(replay[0]?.id);
    expect(first[0]?.qrPayload).toBe(`BV-2030-DEMO-${first[0]?.id}`);
    expect(first[0]?.htmlContent).toContain('Nguyễn Văn An');
    expect(first[0]?.htmlContent).toContain('Bến xe Miền Đông');
    expect(first[0]?.pdfDocument.subarray(0, 5).toString()).toBe('%PDF-');
    expect(first[0]?.pdfDocument.byteLength).toBeGreaterThan(5_000);
  });
});

const snapshot: FulfillmentSnapshot = {
  bookingId: '00000000-0000-4000-8000-000000001101',
  bookingCode: 'BV-2030-DEMO',
  status: 'PAID',
  owner: { type: 'GUEST_SESSION', id: '00000000-0000-4000-8000-000000001102' },
  contactEmail: 'ticket@example.com',
  trip: {
    routeCode: 'HCM-DLI',
    originName: 'TP.HCM',
    destinationName: 'Đà Lạt',
    pickupName: 'Bến xe Miền Đông',
    dropoffName: 'Bến xe Liên tỉnh Đà Lạt',
    departureAt: '2030-06-20T01:00:00.000Z',
    timezone: 'Asia/Ho_Chi_Minh',
    vehicleCode: 'PT-L22-01',
    vehiclePlate: '51B-220.01',
  },
  passengers: [
    {
      id: '00000000-0000-4000-8000-000000001103',
      seatId: 'A01',
      fullName: 'Nguyễn Văn An',
    },
  ],
  totalPriceVnd: 350_000,
  paidAt: '2030-06-19T17:59:00.000Z',
};
