import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

test('guest selects Vietnamese locations by unaccented aliases with the keyboard', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#search')).toHaveAttribute('data-ready', 'true');

  const origin = page.getByRole('combobox', { name: 'Điểm đi' });
  await origin.fill('Sai Gon');
  await expect(page.getByRole('option', { name: /TP\.HCM/ })).toBeVisible();
  await origin.press('ArrowDown');
  await origin.press('Enter');
  await expect(origin).toHaveValue('TP.HCM');

  const destination = page.getByRole('combobox', { name: 'Điểm đến' });
  await destination.fill('Da Lat');
  await expect(page.getByRole('option', { name: /Đà Lạt/ })).toBeVisible();
  await destination.press('ArrowDown');
  await destination.press('Enter');
  await expect(destination).toHaveValue('Đà Lạt');

  await page.getByLabel('Ngày đi').fill('2030-06-20');
  await expect(page.getByRole('button', { name: 'Tìm chuyến' })).toBeEnabled();
});

test('autocomplete exposes an empty state and can swap selected locations', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#search')).toHaveAttribute('data-ready', 'true');

  const origin = page.getByRole('combobox', { name: 'Điểm đi' });
  await origin.fill('khong-co-dia-diem');
  await expect(page.getByText('Không tìm thấy địa điểm phù hợp.')).toBeVisible();

  await origin.fill('Sai Gon');
  await expect(page.getByRole('option', { name: /TP\.HCM/ })).toBeVisible();
  await origin.press('ArrowDown');
  await origin.press('Enter');
  const destination = page.getByRole('combobox', { name: 'Điểm đến' });
  await destination.fill('Da Lat');
  await expect(page.getByRole('option', { name: /Đà Lạt/ })).toBeVisible();
  await destination.press('ArrowDown');
  await destination.press('Enter');

  await page.getByRole('button', { name: 'Đổi điểm đi và điểm đến' }).click();
  await expect(origin).toHaveValue('Đà Lạt');
  await expect(destination).toHaveValue('TP.HCM');
});

test('autocomplete exposes loading and dependency error states', async ({ page }) => {
  await page.route('**/graphql', async (route) => {
    const requestBody = route.request().postData() ?? '';
    if (!requestBody.includes('LocationSuggestions')) {
      await route.continue();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ errors: [{ message: 'Dịch vụ địa điểm đang tạm gián đoạn.' }] }),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#search')).toHaveAttribute('data-ready', 'true');

  await page.getByRole('combobox', { name: 'Điểm đi' }).fill('Sai Gon');
  await expect(page.getByText('Đang tìm địa điểm...')).toBeVisible();
  await expect(page.getByText('Dịch vụ địa điểm đang tạm gián đoạn.')).toBeVisible();
});

test('popular route shortcuts open the route landing page', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Chuyến gần nhất đang mở bán.' })).toBeVisible();
  await expect(page.locator('.home-trip-card')).toHaveCount(3);
  await expect(page.getByRole('link', { name: /^Chọn chuyến / }).first()).toBeVisible();

  const popularRoute = page.getByRole('link', { name: 'Xem chuyến TP.HCM → Đà Lạt' });
  await expect(popularRoute).toBeVisible();
  await popularRoute.click();

  await expect(page).toHaveURL(/\/routes\/hcm-to-dli\?date=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole('heading', { name: /TP\.HCM.*Đà Lạt/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '← Tìm tuyến khác' })).toBeVisible();
});

test('guest searches seeded trips and sees Vietnam-local times through Nginx', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#search')).toHaveAttribute('data-ready', 'true', {
    timeout: 20_000,
  });

  const origin = page.getByRole('combobox', { name: 'Điểm đi' });
  await origin.fill('Sai Gon');
  await expect(page.getByRole('option', { name: /TP\.HCM/ })).toBeVisible();
  await origin.press('ArrowDown');
  await origin.press('Enter');

  const destination = page.getByRole('combobox', { name: 'Điểm đến' });
  await destination.fill('Da Lat');
  await expect(page.getByRole('option', { name: /Đà Lạt/ })).toBeVisible();
  await destination.press('ArrowDown');
  await destination.press('Enter');
  await page.getByLabel('Ngày đi').fill('2030-06-20');
  await page.getByRole('button', { name: 'Tìm chuyến' }).click();

  await expect(page).toHaveURL(/\/trips\?/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /TP\.HCM.*Đà Lạt/ })).toBeVisible();
  await expect(page.getByText('03', { exact: true })).toBeVisible();
  await expect(page.locator('.trip-card').first()).toContainText('Phương Trang');
  await expect(page.getByText('07:00', { exact: true })).toBeVisible();
  await expect(page.getByText(/280\.000/)).toBeVisible();

  await page.getByLabel('Sắp xếp').selectOption('PRICE_LOWEST');
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  await expect(page).toHaveURL(/sort=PRICE_LOWEST/, { timeout: 20_000 });
  await expect(page.locator('.trip-card').first()).toContainText('Kumho', { timeout: 20_000 });

  await page.getByLabel('Giá tối đa').selectOption('250000');
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  await expect(page.getByText('01', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.trip-card')).toHaveCount(1);
  await expect(page.locator('.trip-card').first()).toContainText('Kumho');
});

test('expanded July seed covers active routes from 18 to 30 July 2026', async ({ page }) => {
  const parameters = new URLSearchParams({
    originId: '00000000-0000-4000-8000-000000000001',
    destinationId: '00000000-0000-4000-8000-000000000003',
    date: '2026-07-24',
    origin: 'TP.HCM',
    destination: 'Nha Trang',
  });
  await page.goto(`/trips?${parameters.toString()}`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: /TP\.HCM.*Nha Trang/ })).toBeVisible();
  await expect(page.locator('.trip-card')).toHaveCount(2);
  await expect(page.getByText('06:30', { exact: true })).toBeVisible();
  await expect(page.getByText('20:00', { exact: true })).toBeVisible();
  await expect(page.locator('.trip-card').filter({ hasText: '300.000' })).toHaveCount(1);
  await expect(page.locator('.trip-card').filter({ hasText: '320.000' })).toHaveCount(1);
});

test('no-result search suggests the nearest dates with matching trips', async ({ page }) => {
  const parameters = new URLSearchParams({
    originId: '00000000-0000-4000-8000-000000000001',
    destinationId: '00000000-0000-4000-8000-000000000002',
    date: '2030-06-19',
    origin: 'TP.HCM',
    destination: 'Đà Lạt',
  });
  await page.goto(`/trips?${parameters.toString()}`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Ngày này chưa có chuyến phù hợp')).toBeVisible();
  await expect(page.getByRole('link', { name: '20/06/2030' })).toBeVisible();
  await expect(page.getByRole('link', { name: '21/06/2030' })).toBeVisible();
});

test('guest opens trip detail with schedule, policies and authoritative seat layout', async ({
  page,
}) => {
  await page.goto('/trips/00000000-0000-4000-8000-000000000701', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: /TP\.HCM.*Đà Lạt/ })).toBeVisible();
  await expect(page.getByText('Bến xe Miền Đông')).toBeVisible();
  await expect(page.getByText('Bến xe Liên tỉnh Đà Lạt')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Sơ đồ giường nằm 34 chỗ/ })).toBeVisible();
  await expect(page.locator('.seat-grid [data-seat]')).toHaveCount(34);
  await expect(page.getByLabel('Ghế A01: đã bán')).toBeVisible();
  await expect(page.getByLabel('Ghế A02: tạm khóa')).toBeVisible();
  await expect(page.getByText(/^Còn trống · \d+$/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chính sách đổi, hủy vé' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hướng dẫn check-in' })).toBeVisible();
});

test('route landing page server-renders canonical SEO metadata and seeded trips', async ({
  page,
}) => {
  await page.goto('/routes/hcm-to-dli?date=2030-06-20', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle('Vé xe TP.HCM đi Đà Lạt ngày 20/06/2030 | Bến Việt');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'http://localhost:8080/routes/hcm-to-dli?date=2030-06-20',
  );
  await expect(page.getByRole('heading', { name: /TP\.HCM.*Đà Lạt/ })).toBeVisible();
  await expect(page.locator('.trip-card')).toHaveCount(3);
});

test('trip detail remains usable at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/trips/00000000-0000-4000-8000-000000000701', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.getByRole('heading', { name: /TP\.HCM.*Đà Lạt/ })).toBeVisible();
  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fitsViewport).toBe(true);
});

test('guest holds a seat, restores it after refresh and releases it', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const tripId = '00000000-0000-4000-8000-000000000702';

  try {
    await page.goto(`/trips/${tripId}`, { waitUntil: 'domcontentloaded' });

    const seat = page.getByRole('button', { name: 'Ghế A01: còn trống' });
    await expect(seat).toBeEnabled({ timeout: 20_000 });
    await seat.focus();
    await seat.press('Enter');
    await expect(seat).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('A01', { exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: 'Giữ ghế trong 5 phút' }).click();

    await expect(page.getByRole('button', { name: 'Ghế A01: bạn đang giữ' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Bỏ giữ ghế' })).toBeVisible();
    await expect(page.locator('.hold-countdown strong')).toContainText(/0[45]:[0-5][0-9]/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Ghế A01: bạn đang giữ' })).toBeDisabled();
    await page.getByRole('button', { name: 'Bỏ giữ ghế' }).click();
    await expect(page.getByRole('button', { name: 'Ghế A01: còn trống' })).toBeEnabled();
    expect(consoleErrors).toEqual([]);
  } finally {
    await releaseStoredHold(page, tripId);
  }
});

test('connected guests refetch authoritative seat state after realtime notifications', async ({
  browser,
}) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstGuest = await firstContext.newPage();
  const secondGuest = await secondContext.newPage();

  try {
    await Promise.all([
      firstGuest.goto('/trips/00000000-0000-4000-8000-000000000702', {
        waitUntil: 'domcontentloaded',
      }),
      secondGuest.goto('/trips/00000000-0000-4000-8000-000000000702', {
        waitUntil: 'domcontentloaded',
      }),
    ]);

    await firstGuest.getByRole('button', { name: 'Ghế A02: còn trống' }).click();
    await firstGuest.getByRole('button', { name: 'Giữ ghế trong 5 phút' }).click();

    await expect(firstGuest.getByRole('button', { name: 'Ghế A02: bạn đang giữ' })).toBeDisabled();
    await expect(
      secondGuest.getByRole('button', { name: 'Ghế A02: đang được giữ' }),
    ).toBeDisabled();

    await firstGuest.getByRole('button', { name: 'Bỏ giữ ghế' }).click();
    await expect(secondGuest.getByRole('button', { name: 'Ghế A02: còn trống' })).toBeEnabled();
  } finally {
    await releaseStoredHold(firstGuest, '00000000-0000-4000-8000-000000000702');
    await firstContext.close();
    await secondContext.close();
  }
});

test('guest creates a PENDING_PAYMENT booking from the active hold', async ({ page }) => {
  const tripId = '00000000-0000-4000-8000-000000000702';
  let holdToken: string | null = null;
  let checkoutSessionId: string | null = null;
  let bookingId: string | null = null;

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/trips/${tripId}`, { waitUntil: 'domcontentloaded' });
    const seat = page.getByRole('button', { name: 'Ghế A03: còn trống' });
    await seat.click();
    await expect(seat).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Giữ ghế trong 5 phút' }).click();
    await expect(page.getByRole('heading', { name: 'Thông tin đặt vé' })).toBeVisible();
    ({ holdToken, checkoutSessionId } = await page.evaluate(
      ({ holdKey, checkoutKey }) => ({
        holdToken: sessionStorage.getItem(holdKey),
        checkoutSessionId: sessionStorage.getItem(checkoutKey),
      }),
      {
        holdKey: `bus:seat-hold:v1:${tripId}`,
        checkoutKey: 'bus:checkout-session:v1',
      },
    ));

    await page.getByLabel('Họ tên liên hệ').fill('Nguyen Van An');
    await page.getByLabel('Email nhận vé').fill('an.e2e@example.com');
    await page.getByLabel('Số điện thoại liên hệ').fill('0901234567');
    await page.getByLabel('Họ tên hành khách ghế A03').fill('Nguyen Van An');
    await page.getByLabel('Số giấy tờ (tùy chọn)').fill('ABC123456');
    await page.getByRole('button', { name: 'Tiếp tục thanh toán' }).click();

    const bookingCode = page.getByRole('heading', { name: /^BV-\d{4}-[A-F0-9]{10}$/ });
    await expect(bookingCode).toBeVisible();
    const createdCode = await bookingCode.textContent();
    await expect(page.getByText('Chờ thanh toán', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đơn đặt vé đã tạo' })).toBeDisabled();
    bookingId = await page.evaluate((storageKey) => {
      const serialized = sessionStorage.getItem(storageKey);
      if (!serialized) return null;
      return (JSON.parse(serialized) as { booking?: { id?: string } }).booking?.id ?? null;
    }, `bus:booking:v1:${tripId}`);
    expect(bookingId).not.toBeNull();

    await page.reload();
    await expect(page.getByRole('heading', { name: createdCode ?? '' })).toBeVisible();
  } finally {
    if (holdToken && checkoutSessionId) {
      await page.request.post(new URL('/graphql', page.url()).toString(), {
        headers: {
          'content-type': 'application/json',
          'x-checkout-session-id': checkoutSessionId,
        },
        data: {
          query:
            'mutation($input: ReleaseSeatHoldInput!) { releaseSeatHold(input: $input) { released } }',
          variables: {
            input: { holdToken, idempotencyKey: randomUUID() },
          },
        },
      });
    }
    if (bookingId) deleteE2eBooking(bookingId);
  }
});

test('guest retries after simulated failure and pays only after durable seat confirmation', async ({
  context,
  page,
}) => {
  const tripId = '00000000-0000-4000-8000-000000000702';
  let holdToken: string | null = null;
  let checkoutSessionId: string | null = null;
  let bookingId: string | null = null;
  let observer: Page | undefined;

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/trips/${tripId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Ghế A04: còn trống' }).click();
    await page.getByRole('button', { name: 'Giữ ghế trong 5 phút' }).click();
    ({ holdToken, checkoutSessionId } = await page.evaluate(
      ({ holdKey, checkoutKey }) => ({
        holdToken: sessionStorage.getItem(holdKey),
        checkoutSessionId: sessionStorage.getItem(checkoutKey),
      }),
      {
        holdKey: `bus:seat-hold:v1:${tripId}`,
        checkoutKey: 'bus:checkout-session:v1',
      },
    ));
    await page.getByLabel('Họ tên liên hệ').fill('Payment E2E Guest');
    await page.getByLabel('Email nhận vé').fill('payment.e2e@example.com');
    await page.getByLabel('Số điện thoại liên hệ').fill('0901234567');
    await page.getByLabel('Họ tên hành khách ghế A04').fill('Payment E2E Guest');
    await page.getByRole('button', { name: 'Tiếp tục thanh toán' }).click();
    await expect(page.getByRole('button', { name: 'Thanh toán thất bại' })).toBeVisible();
    bookingId = await page.evaluate((storageKey) => {
      const serialized = sessionStorage.getItem(storageKey);
      if (!serialized) return null;
      return (JSON.parse(serialized) as { booking?: { id?: string } }).booking?.id ?? null;
    }, `bus:booking:v1:${tripId}`);
    expect(bookingId).not.toBeNull();

    await page.getByRole('button', { name: 'Thanh toán thất bại' }).click();
    await expect(page.getByText(/Thanh toán mô phỏng thất bại/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ghế A04: bạn đang giữ' })).toBeDisabled();

    observer = await context.newPage();
    await observer.goto(`/trips/${tripId}`, { waitUntil: 'domcontentloaded' });
    await expect(observer.getByRole('button', { name: 'Ghế A04: đang được giữ' })).toBeDisabled();

    await page.getByRole('button', { name: 'Thanh toán thành công' }).click();
    await expect(page.getByText('Thanh toán hoàn tất', { exact: true })).toBeVisible();
    await expect(page.getByText(/vé điện tử sẵn sàng/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Tải PDF' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mở vé HTML' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ghế A04: đã bán' })).toBeDisabled();
    await expect(observer.getByRole('button', { name: 'Ghế A04: đã bán' })).toBeDisabled();

    await page.reload();
    await expect(page.getByText('Thanh toán hoàn tất', { exact: true })).toBeVisible();
  } finally {
    await observer?.close();
    if (holdToken && checkoutSessionId) {
      await page.request.post(new URL('/graphql', page.url()).toString(), {
        headers: {
          'content-type': 'application/json',
          'x-checkout-session-id': checkoutSessionId,
        },
        data: {
          query:
            'mutation($input: ReleaseSeatHoldInput!) { releaseSeatHold(input: $input) { released } }',
          variables: {
            input: { holdToken, idempotencyKey: randomUUID() },
          },
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
DELETE FROM seat_inventory.trip_seat_states WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM seat_inventory.confirmation_requests WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM payment.attempts WHERE booking_id = '${bookingId}'::uuid;
DELETE FROM booking.bookings WHERE id = '${bookingId}'::uuid;\n`,
      shell: process.platform === 'win32',
    },
  );
  expect(result.status, result.stderr).toBe(0);
}

async function releaseStoredHold(page: Page, tripId: string): Promise<void> {
  if (page.isClosed()) return;
  const stored = await page
    .evaluate(
      ({ holdKey, checkoutKey }) => ({
        holdToken: sessionStorage.getItem(holdKey),
        checkoutSessionId: sessionStorage.getItem(checkoutKey),
      }),
      {
        holdKey: `bus:seat-hold:v1:${tripId}`,
        checkoutKey: 'bus:checkout-session:v1',
      },
    )
    .catch(() => null);
  if (!stored?.holdToken || !stored.checkoutSessionId) return;
  await page.request
    .post(new URL('/graphql', page.url()).toString(), {
      headers: {
        'content-type': 'application/json',
        'x-checkout-session-id': stored.checkoutSessionId,
      },
      data: {
        query:
          'mutation($input: ReleaseSeatHoldInput!) { releaseSeatHold(input: $input) { released } }',
        variables: {
          input: { holdToken: stored.holdToken, idempotencyKey: randomUUID() },
        },
      },
    })
    .catch(() => undefined);
}
