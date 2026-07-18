import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

const tripId = '00000000-0000-4000-8000-000000000702';

test('STAFF can look up the stable demo ticket with all three credential kinds', async ({
  page,
}) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.auth-grid')).toHaveAttribute('data-hydrated', 'true', {
    timeout: 20_000,
  });
  await page.locator('input[type="email"]').fill('staff.demo@benviet.vn');
  await page.locator('input[type="password"]').fill('Staff123!');
  const submit = page.locator('form.auth-form button[type="submit"]');
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await Promise.all([
    page.waitForURL('**/staff/check-in', { waitUntil: 'domcontentloaded' }),
    submit.click(),
  ]);
  await expect(page.locator('.operations-shell')).toHaveAttribute('data-hydrated', 'true', {
    timeout: 20_000,
  });

  const credentials = [
    { kind: 'BOOKING_CODE', value: 'BV-STAFF-DEMO-01' },
    { kind: 'TICKET_CODE', value: 'VT-DEMO-STAFF-01' },
    { kind: 'QR_PAYLOAD', value: 'BV-STAFF-DEMO-01-VT-DEMO-STAFF-01' },
  ];

  for (const credential of credentials) {
    await page.locator('.ticket-lookup select').selectOption(credential.kind);
    await page.locator('.ticket-lookup input').fill(credential.value);
    await page.locator('.ticket-lookup button[type="submit"]').click();
    await expect(page.getByText('Staff Seed Passenger', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('VT-DEMO-STAFF-01', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('A03', { exact: true })).toBeVisible({ timeout: 20_000 });
  }
});

test('STAFF looks up an issued ticket and checks in its passenger once', async ({ page }) => {
  test.setTimeout(120_000);
  let bookingId: string | undefined;
  let checkoutSessionId: string | undefined;
  let holdToken: string | undefined;
  let seatId: string | undefined;

  try {
    await page.goto(`/trips/${tripId}`, { waitUntil: 'domcontentloaded' });
    const availableSeat = page
      .locator('button[data-seat][data-status="AVAILABLE"]:not(:disabled)')
      .first();
    seatId = (await availableSeat.textContent())?.trim();
    expect(seatId).toMatch(/^A\d+$/);
    await availableSeat.click();
    await page.getByRole('button', { name: 'Giữ ghế trong 5 phút' }).click();
    await page.getByLabel('Họ tên liên hệ').fill('Check-in E2E Guest');
    await page.getByLabel('Email nhận vé').fill('checkin.e2e@example.com');
    await page.getByLabel('Số điện thoại liên hệ').fill('0901234567');
    await page.locator(`input[name="passengerName:${seatId}"]`).fill('Check-in E2E Guest');
    await page.getByRole('button', { name: 'Tiếp tục thanh toán' }).click();
    await page.getByRole('button', { name: 'Thanh toán thành công' }).click();
    await expect(page.getByText(/vé điện tử sẵn sàng/)).toBeVisible({ timeout: 45_000 });

    ({ bookingId, checkoutSessionId, holdToken } = await page.evaluate((id) => {
      const bookingRaw = sessionStorage.getItem(`bus:booking:v1:${id}`);
      const booking = bookingRaw
        ? (JSON.parse(bookingRaw) as { booking?: { id?: string } }).booking
        : undefined;
      return {
        bookingId: booking?.id,
        checkoutSessionId: sessionStorage.getItem('bus:checkout-session:v1') ?? undefined,
        holdToken: sessionStorage.getItem(`bus:seat-hold:v1:${id}`) ?? undefined,
      };
    }, tripId));
    expect(bookingId).toBeTruthy();
    expect(checkoutSessionId).toBeTruthy();

    const ticketResponse = await page.request.post('/graphql', {
      headers: { 'x-checkout-session-id': checkoutSessionId! },
      data: {
        query:
          'query($bookingId: ID!) { bookingTickets(bookingId: $bookingId) { tickets { ticketCode } } }',
        variables: { bookingId },
      },
    });
    const ticketBody = (await ticketResponse.json()) as {
      data?: { bookingTickets?: { tickets?: Array<{ ticketCode: string }> } };
    };
    const ticketCode = ticketBody.data?.bookingTickets?.tickets?.[0]?.ticketCode;
    expect(ticketCode).toMatch(/^VT-/);

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.auth-grid')).toHaveAttribute('data-hydrated', 'true', {
      timeout: 20_000,
    });
    await page.getByLabel('Email').fill('staff.demo@benviet.vn');
    await page.getByLabel('Mật khẩu').fill('Staff123!');
    const staffLogin = page.getByRole('button', { name: 'Đăng nhập', exact: true });
    await expect(staffLogin).toBeEnabled({ timeout: 20_000 });
    await Promise.all([
      page.waitForURL('**/staff/check-in', { waitUntil: 'domcontentloaded' }),
      staffLogin.click(),
    ]);
    await expect(page.getByText('Nhân viên Demo', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    const accessToken = await page.evaluate(() => {
      const raw = sessionStorage.getItem('bus:auth-session:v1');
      return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : undefined;
    });
    await expect
      .poll(async () => {
        const response = await page.request.post('/graphql', {
          headers: { authorization: `Bearer ${accessToken}` },
          data: {
            query:
              'query($input: StaffTicketLookupInput!) { staffTicketLookup(input: $input) { ticketCode } }',
            variables: { input: { kind: 'TICKET_CODE', credential: ticketCode } },
          },
        });
        const body = (await response.json()) as {
          data?: { staffTicketLookup?: Array<{ ticketCode: string }> };
        };
        return body.data?.staffTicketLookup?.length ?? 0;
      })
      .toBe(1);
    await page.goto('/staff/check-in', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.operations-shell')).toHaveAttribute('data-hydrated', 'true', {
      timeout: 20_000,
    });
    await page.getByLabel('Loại mã').selectOption('TICKET_CODE');
    await page.getByLabel('Mã cần tra cứu').fill(ticketCode!);
    await expect(page.getByRole('button', { name: 'Tra cứu vé' })).toBeEnabled({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Tra cứu vé' }).click();
    await expect(page.getByText('Check-in E2E Guest', { exact: true })).toBeVisible();
    await expect(page.getByText(seatId!, { exact: true })).toBeVisible();

    const wrongTrip = await page.request.post('/graphql', {
      headers: { authorization: `Bearer ${accessToken}` },
      data: {
        query:
          'mutation($input: CheckInTicketInput!) { checkInTicket(input: $input) { transitioned } }',
        variables: {
          input: {
            kind: 'TICKET_CODE',
            credential: ticketCode,
            tripId: '00000000-0000-4000-8000-000000000701',
            idempotencyKey: `ticket-check-in-wrong-trip-${randomUUID()}`,
          },
        },
      },
    });
    await expect(wrongTrip.json()).resolves.toMatchObject({
      errors: [{ extensions: { code: 'WRONG_TRIP' } }],
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Xác nhận lên xe' })).toBeVisible();
    await page.getByRole('button', { name: 'Xác nhận lên xe' }).click();
    await expect(page.getByText(new RegExp(`Đã check-in ghế ${seatId}`))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đã check-in' })).toBeDisabled();
  } finally {
    if (holdToken && checkoutSessionId) {
      await page.request.post('/graphql', {
        headers: { 'x-checkout-session-id': checkoutSessionId },
        data: {
          query:
            'mutation($input: ReleaseSeatHoldInput!) { releaseSeatHold(input: $input) { released } }',
          variables: { input: { holdToken, idempotencyKey: randomUUID() } },
        },
      });
    }
    if (bookingId) deleteE2eBooking(bookingId);
  }
});

function deleteE2eBooking(bookingId: string): void {
  expect(bookingId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/docker-compose.yml',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      process.env.POSTGRES_USER ?? 'bus',
      '-d',
      process.env.POSTGRES_DB ?? 'bus_platform',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      encoding: 'utf8',
      input: `DELETE FROM booking.operational_audit WHERE target_id = '${bookingId}'::uuid OR target_id IN (SELECT ticket_id FROM booking.issued_ticket_refs WHERE booking_id = '${bookingId}'::uuid);
DELETE FROM ticket.inbox_events WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM ticket.tickets WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM notification.inbox_events WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM notification.email_delivery_logs WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM booking.outbox_events WHERE aggregate_id = '${bookingId}'::uuid;
DELETE FROM payment.outbox_events WHERE aggregate_id = '${bookingId}'::uuid;
DELETE FROM seat_inventory.release_requests WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM seat_inventory.trip_seat_states WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM seat_inventory.confirmation_requests WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM payment.attempts WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM booking.bookings WHERE id = '${bookingId}'::uuid;\n`,
      shell: process.platform === 'win32',
    },
  );
  expect(result.status, result.stderr).toBe(0);
}
