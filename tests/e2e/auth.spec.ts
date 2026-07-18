import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('CUSTOMER can log in and cannot open the ADMIN workspace', async ({ page }) => {
  await loginAs(page, 'customer');
  await expect(page).toHaveURL(/\/account\/bookings$/);
  await page.goto('/account', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/account\/bookings$/);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Khách hàng Demo' })).toBeVisible();
  await expect(page.getByText('Khách hàng', { exact: true })).toBeVisible();

  await page.goto('/admin/trips', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Đăng nhập quản trị' })).toBeVisible();
});

test('CUSTOMER opens a seeded ticket with QR and keeps account navigation while booking', async ({
  page,
}) => {
  await loginAs(page, 'customer');
  const bookingCard = page
    .locator('.booking-history-card')
    .filter({ hasText: 'BV-CUSTOMER-JULY-01' });
  await expect(bookingCard).toBeVisible();
  const detailsButton = bookingCard.getByRole('button', { name: 'Xem chi tiết vé' });
  await detailsButton.focus();
  await detailsButton.press('Enter');
  await expect(bookingCard.getByText('VT-CUSTOMER-JULY-01', { exact: true })).toBeVisible();
  await expect(
    bookingCard.getByRole('img', { name: 'Mã QR vé VT-CUSTOMER-JULY-01' }),
  ).toBeVisible();
  await expect(bookingCard.getByRole('link', { name: 'Tải PDF' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await Promise.all([
    page.waitForURL(/\/$/, { waitUntil: 'domcontentloaded' }),
    page.getByRole('link', { name: 'Đặt vé', exact: true }).click(),
  ]);
  await expect(page.getByRole('link', { name: 'Vé của tôi' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Đăng nhập' })).toHaveCount(0);
});

test('ADMIN can extend the session and log out', async ({ page }) => {
  await loginAs(page, 'admin');
  await expect(page).toHaveURL(/\/admin\/operations$/);
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/admin\/operations$/);
  await expect(page.getByRole('link', { name: 'Tài khoản' })).toBeVisible();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Quản trị Demo' })).toBeVisible();
  await page.getByRole('button', { name: 'Gia hạn phiên' }).click();
  await expect(page.getByText('Phiên đăng nhập đã được gia hạn.')).toBeVisible();

  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page.getByText('Bạn đã đăng xuất an toàn.')).toBeVisible();
  await expect(page.getByText('Một tài khoản, nhiều tiện ích')).toBeVisible();
});

test('STAFF is routed directly to the check-in workspace', async ({ page }) => {
  await loginAs(page, 'staff');
  await expect(page).toHaveURL(/\/staff\/check-in$/);
  await page.goto('/staff', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/staff\/check-in$/);
  await expect(
    page.getByRole('heading', { name: 'Xác nhận lên xe nhanh và chính xác.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tài khoản', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Đăng nhập tài khoản vận hành' })).toHaveCount(0);
});

test('ADMIN keeps its navigation on the shared check-in workspace and filters by a trip option', async ({
  page,
}) => {
  await loginAs(page, 'admin');
  await page.goto('/staff/check-in', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('a[href="/admin/operations"]')).toBeVisible();
  await expect(page.locator('a[href="/admin/catalog"]')).toBeVisible();

  await page.goto('/admin/operations', { waitUntil: 'domcontentloaded' });
  const tripFilter = page.locator('#operations-trip-id');
  await expect(tripFilter).toHaveRole('combobox');
  await expect(tripFilter.locator('option[value=""]')).toHaveCount(1);
  await expect.poll(() => tripFilter.locator('option').count()).toBeGreaterThan(1);
  await tripFilter.selectOption({ index: 1 });
  await page.locator('.operations-filter button').click();
  await expect(page.getByText(/valid UUID/i)).toHaveCount(0);
});

test('ADMIN workspaces expose searchable trip and Catalog management UI', async ({ page }) => {
  await loginAs(page, 'admin');

  await page.goto('/admin/trips', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Danh sách chuyến' })).toBeVisible();
  await expect(
    page.getByRole('searchbox', { name: 'Tìm tuyến, xe, trạng thái hoặc mã chuyến' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Tạo chuyến mới' })).toBeVisible();

  await page.goto('/admin/catalog', { waitUntil: 'domcontentloaded' });
  for (const tab of ['Điểm dừng', 'Tuyến xe', 'Xe', 'Sơ đồ ghế']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Tạo phiên bản sơ đồ ghế' })).toBeVisible();

  await page.getByRole('button', { name: 'Tuyến xe', exact: true }).click();
  await page.getByRole('button', { name: 'Chọn', exact: true }).first().click();
  const routeEditorMetrics = await page.locator('.admin-editor-form').evaluate((form) => ({
    clientWidth: form.clientWidth,
    scrollWidth: form.scrollWidth,
  }));
  expect(routeEditorMetrics.scrollWidth).toBeLessThanOrEqual(routeEditorMetrics.clientWidth);

  for (const tab of ['Xe', 'Sơ đồ ghế']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    const editorMetrics = await page.locator('.admin-editor-form').evaluate((form) => ({
      clientWidth: form.clientWidth,
      scrollWidth: form.scrollWidth,
    }));
    expect(editorMetrics.scrollWidth).toBeLessThanOrEqual(editorMetrics.clientWidth);
  }

  for (const viewport of [
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const tab of ['Xe', 'Sơ đồ ghế']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      const responsiveMetrics = await page.locator('.admin-editor-form').evaluate((form) => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        editorWidth: form.clientWidth,
        editorScrollWidth: form.scrollWidth,
      }));
      expect(responsiveMetrics.documentWidth).toBeLessThanOrEqual(responsiveMetrics.viewportWidth);
      expect(responsiveMetrics.editorScrollWidth).toBeLessThanOrEqual(
        responsiveMetrics.editorWidth,
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/admin/operations', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('searchbox', { name: /Tìm booking/ })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: /Tìm hành động/ })).toBeVisible();
});

test('ADMIN opens operations dashboard and blocks a seat idempotently through GraphQL', async ({
  page,
}) => {
  let createdTripId: string | undefined;
  await loginAs(page, 'admin');
  await expect(page).toHaveURL(/\/admin\/operations$/);
  await expect(
    page.getByRole('heading', { name: 'Theo dõi đặt vé và doanh thu trong một màn hình.' }),
  ).toBeVisible();
  await expect(page.getByText('Doanh thu 30 ngày')).toBeVisible();
  await expect(page.getByText('Tỷ lệ đặt vé thành công')).toBeVisible();
  await expect(page.getByText('Thanh toán thành công')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Doanh thu theo ngày' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tuyến được quan tâm nhiều' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vé bán theo tuyến' })).toBeVisible();

  await page.goto('/admin/trips', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tạm khóa ghế' })).toBeVisible();
  const scheduledRow = page.getByRole('row').filter({ hasText: 'Đã lên lịch' }).first();
  await scheduledRow.getByRole('button', { name: 'Quản lý' }).click();
  await expect(page.getByRole('heading', { name: 'Trạng thái chuyến' })).toBeVisible();
  await expect(page.locator('.admin-trip-state-track [aria-current="step"]')).toContainText(
    'Đã lên lịch',
  );
  await expect(page.locator('.admin-trip-action-button-sale')).toBeEnabled();
  const tripActionStyles = await page.locator('.admin-trip-actions').evaluate((card) => {
    const enabled = card.querySelector<HTMLButtonElement>(
      '.admin-trip-action-button:not(:disabled)',
    );
    const disabled = card.querySelector<HTMLButtonElement>('.admin-trip-action-button:disabled');
    return {
      clientWidth: card.clientWidth,
      scrollWidth: card.scrollWidth,
      enabledBackground: enabled ? getComputedStyle(enabled).backgroundColor : '',
      enabledColor: enabled ? getComputedStyle(enabled).color : '',
      disabledBackground: disabled ? getComputedStyle(disabled).backgroundColor : '',
      disabledColor: disabled ? getComputedStyle(disabled).color : '',
    };
  });
  expect(tripActionStyles.scrollWidth).toBeLessThanOrEqual(tripActionStyles.clientWidth);
  expect(tripActionStyles.enabledBackground).not.toBe(tripActionStyles.disabledBackground);
  expect(tripActionStyles.enabledColor).not.toBe(tripActionStyles.disabledColor);
  await page.getByRole('button', { name: '+ Tạo chuyến mới' }).click();

  try {
    const createTripButton = page.getByRole('button', { name: 'Tạo chuyến', exact: true });
    await expect(createTripButton).toBeEnabled();
    await createTripButton.click();
    const creationMessage = page.locator('.operations-message');
    await expect(creationMessage).toContainText('Đã tạo chuyến mới.');
    createdTripId =
      (await page.locator('[data-selected-trip-id]').getAttribute('data-selected-trip-id')) ??
      undefined;
    expect(createdTripId).toBeTruthy();
    await expect(createTripButton).toBeEnabled();

    await page.getByLabel('Mã ghế, cách nhau bằng dấu phẩy').fill('A03');
    await page.getByRole('button', { name: 'Khóa ghế' }).click();
    await expect(page.getByText(/Đã khóa.*A03/)).toBeVisible();
    await page.getByRole('button', { name: 'Mở bán lại' }).click();
    await expect(page.getByText(/Đã mở bán lại.*A03/)).toBeVisible();
  } finally {
    if (createdTripId) deleteAdminTrip(createdTripId);
  }

  await page.goto('/admin/catalog', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', {
      name: 'Quản lý tuyến, xe và điểm đón.',
    }),
  ).toBeVisible();
});

test('ADMIN manages every Catalog resource family through GraphQL', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const loginResponse = await page.request.post('/graphql', {
    data: {
      query: `mutation($input: LoginInput!) { login(input:$input) { accessToken refreshToken accessExpiresAt refreshExpiresAt user { id email displayName role } } }`,
      variables: { input: { email: 'admin.demo@benviet.vn', password: 'Admin123!' } },
    },
  });
  const loginBody = (await loginResponse.json()) as { data: { login: Record<string, unknown> } };
  const accessToken = String(loginBody.data.login.accessToken);
  expect(accessToken).toBeTruthy();
  await page.evaluate(
    (session) => sessionStorage.setItem('bus:auth-session:v1', JSON.stringify(session)),
    loginBody.data.login,
  );
  await page.goto('/admin/catalog', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toBeVisible();

  const headers = { authorization: `Bearer ${accessToken}` };
  const snapshotResponse = await page.request.post('/graphql', {
    headers,
    data: {
      query: `query { adminCatalog { locations { id kind } operators { id } vehicleTypes { id } } }`,
    },
  });
  const snapshot = (await snapshotResponse.json()) as {
    data: {
      adminCatalog: {
        locations: Array<{ id: string; kind: string }>;
        operators: Array<{ id: string }>;
        vehicleTypes: Array<{ id: string }>;
      };
    };
  };
  const cities = snapshot.data.adminCatalog.locations.filter((item) => item.kind === 'CITY');
  const ids: {
    location?: string;
    layout?: string;
    vehicle?: string;
    route?: string;
    trip?: string;
  } = {};
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const mutation = async (query: string, input: Record<string, unknown>, field: string) => {
    const response = await page.request.post('/graphql', {
      headers,
      data: {
        query,
        variables: { input: { ...input, idempotencyKey: `e2e-catalog-${randomUUID()}` } },
      },
    });
    const body = (await response.json()) as {
      data?: Record<string, { id?: string; tripId?: string }>;
      errors?: Array<{ message: string }>;
    };
    expect(body.errors, JSON.stringify(body.errors)).toBeUndefined();
    return body.data?.[field];
  };
  try {
    ids.location = (
      await mutation(
        'mutation($input: SaveAdminLocationInput!) { saveAdminLocation(input:$input) { id } }',
        {
          code: `E2E-${suffix}`,
          name: `E2E Station ${suffix}`,
          kind: 'STATION',
          parentLocationId: cities[0]!.id,
        },
        'saveAdminLocation',
      )
    )?.id;
    ids.layout = (
      await mutation(
        'mutation($input: SaveAdminSeatLayoutInput!) { saveAdminSeatLayout(input:$input) { id } }',
        {
          vehicleTypeId: snapshot.data.adminCatalog.vehicleTypes[0]!.id,
          version: 1_000 + Math.floor(Math.random() * 8_000),
          name: `E2E Layout ${suffix}`,
          deckCount: 1,
          layoutJson: JSON.stringify({
            seats: [{ id: 'A01', label: 'A01', deck: 1, row: 1, column: 1 }],
          }),
        },
        'saveAdminSeatLayout',
      )
    )?.id;
    ids.vehicle = (
      await mutation(
        'mutation($input: SaveAdminVehicleInput!) { saveAdminVehicle(input:$input) { id } }',
        {
          code: `E2E-BUS-${suffix}`,
          plate: `E2E-${suffix}`,
          operatorId: snapshot.data.adminCatalog.operators[0]!.id,
          vehicleTypeId: snapshot.data.adminCatalog.vehicleTypes[0]!.id,
          seatLayoutVersionId: ids.layout,
        },
        'saveAdminVehicle',
      )
    )?.id;
    ids.route = (
      await mutation(
        'mutation($input: SaveAdminRouteInput!) { saveAdminRoute(input:$input) { id } }',
        {
          code: `E2E-ROUTE-${suffix}`,
          originLocationId: cities[0]!.id,
          destinationLocationId: cities[1]!.id,
          durationMinutes: 420,
          stops: [
            { locationId: cities[0]!.id, stopOrder: 1, stopKind: 'PICKUP', offsetMinutes: 0 },
            { locationId: cities[1]!.id, stopOrder: 2, stopKind: 'DROPOFF', offsetMinutes: 420 },
          ],
        },
        'saveAdminRoute',
      )
    )?.id;
    const departureAt = '2031-06-20T01:00:00.000Z';
    const arrivalAt = '2031-06-20T08:00:00.000Z';
    ids.trip = (
      await mutation(
        'mutation($input: CreateTripInput!) { createTrip(input:$input) { tripId } }',
        {
          routeId: ids.route,
          vehicleId: ids.vehicle,
          seatLayoutVersionId: ids.layout,
          departureAt,
          arrivalAt,
          priceVnd: 250000,
        },
        'createTrip',
      )
    )?.tripId;
    await mutation(
      'mutation($input: UpdateAdminTripInput!) { updateAdminTrip(input:$input) { id changed } }',
      {
        id: ids.trip,
        routeId: ids.route,
        vehicleId: ids.vehicle,
        seatLayoutVersionId: ids.layout,
        departureAt,
        arrivalAt,
        priceVnd: 260000,
      },
      'updateAdminTrip',
    );
    await mutation(
      'mutation($input: SetCatalogResourceActiveInput!) { setCatalogResourceActive(input:$input) { id isActive } }',
      { resourceType: 'ROUTE', id: ids.route, isActive: false },
      'setCatalogResourceActive',
    );
    expect(Object.values(ids).every(Boolean)).toBe(true);
  } finally {
    deleteCatalogCrud(ids);
  }
});

test('CUSTOMER checkout is linked to myBookings while guest ownership stays separate', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const registeredTripId = '00000000-0000-4000-8000-000000000702';
  let bookingId: string | undefined;
  let bookingCode: string | undefined;
  let holdToken: string | undefined;
  let accessToken: string | undefined;

  try {
    await loginAs(page, 'customer');
    await expect(page).toHaveURL(/\/account\/bookings$/);

    await page.goto(`/trips/${registeredTripId}`, { waitUntil: 'domcontentloaded' });
    const seatButton = page.getByRole('button', { name: /Ghế [A-Z]\d+: còn trống/ }).first();
    const seatLabel = await seatButton.getAttribute('aria-label');
    const seatId = seatLabel?.match(/Ghế ([A-Z]\d+)/)?.[1];
    expect(seatId).toBeTruthy();
    await seatButton.click();
    await page.getByRole('button', { name: 'Giữ ghế trong 5 phút' }).click();
    await page.getByLabel('Họ tên liên hệ').fill('Registered Customer E2E');
    await page.getByLabel('Email nhận vé').fill('customer.demo@benviet.vn');
    await page.getByLabel('Số điện thoại liên hệ').fill('0901234567');
    await page.getByLabel(`Họ tên hành khách ghế ${seatId}`).fill('Registered Customer E2E');
    await page.getByRole('button', { name: 'Tiếp tục thanh toán' }).click();
    await expect(page.getByText('Chờ thanh toán', { exact: true })).toBeVisible();

    ({ bookingId, bookingCode, holdToken, accessToken } = await page.evaluate((id) => {
      const bookingRaw = sessionStorage.getItem(`bus:booking:v1:${id}`);
      const hold = sessionStorage.getItem(`bus:seat-hold:v1:${id}`) ?? undefined;
      const authRaw = sessionStorage.getItem('bus:auth-session:v1');
      const booking = bookingRaw
        ? (JSON.parse(bookingRaw) as { booking?: { id?: string; bookingCode?: string } }).booking
        : undefined;
      const auth = authRaw ? (JSON.parse(authRaw) as { accessToken?: string }) : undefined;
      return {
        bookingId: booking?.id,
        bookingCode: booking?.bookingCode,
        holdToken: hold,
        accessToken: auth?.accessToken,
      };
    }, registeredTripId));
    expect(bookingId).toBeTruthy();
    expect(bookingCode).toBeTruthy();

    await page.getByRole('button', { name: 'Thanh toán thành công' }).click();
    await expect(page.getByText('Thanh toán hoàn tất', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Mở Vé của tôi' }).click();
    await expect(page).toHaveURL(/\/account\/bookings$/);
    const bookingCard = page
      .locator('.booking-history-card')
      .filter({ hasText: bookingCode ?? '' });
    await expect(bookingCard).toContainText(seatId!);
    await bookingCard.getByRole('button', { name: 'Hủy vé' }).click();
    await expect(page.getByText('Đã hủy vé. Ghế đã được mở bán lại.')).toBeVisible();
    await expect(bookingCard).toContainText('Đã hủy');
  } finally {
    if (holdToken && accessToken && !bookingId) {
      await page.request.post('/graphql', {
        headers: { authorization: `Bearer ${accessToken}` },
        data: {
          query:
            'mutation($input: ReleaseSeatHoldInput!) { releaseSeatHold(input: $input) { released } }',
          variables: { input: { holdToken, idempotencyKey: randomUUID() } },
        },
      });
    }
    if (bookingId) deleteRegisteredBooking(bookingId);
  }
});

test('CUSTOMER manages passenger profiles and prefills checkout without coupling Booking data', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const tripId = '00000000-0000-4000-8000-000000000702';
  let accessToken: string | undefined;
  let holdToken: string | undefined;

  try {
    await loginAs(page, 'customer');
    await expect(page).toHaveURL(/\/account\/bookings$/);
    await page.goto('/account/passengers', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Khách hàng Demo' })).toBeVisible();

    await page.getByLabel('Nhãn dễ nhớ').fill('E2E Profile');
    await page.getByLabel('Họ và tên').fill('E2E Passenger');
    await page.getByLabel('Số điện thoại').fill('0907778899');
    await page.getByRole('button', { name: 'Lưu hành khách' }).click();
    const createdCard = page.locator('.profile-card').filter({ hasText: 'E2E Profile' });
    await expect(createdCard).toContainText('E2E Passenger');

    await createdCard.getByRole('button', { name: 'Sửa' }).click();
    await page.getByLabel('Nhãn dễ nhớ').fill('E2E Updated');
    await page.getByRole('button', { name: 'Cập nhật' }).click();
    await expect(page.locator('.profile-card').filter({ hasText: 'E2E Updated' })).toContainText(
      'E2E Passenger',
    );

    await page.goto(`/trips/${tripId}`, { waitUntil: 'domcontentloaded' });
    const seatButton = page.getByRole('button', { name: /Ghế [A-Z]\d+: còn trống/ }).first();
    const seatLabel = await seatButton.getAttribute('aria-label');
    const seatId = seatLabel?.match(/Ghế ([A-Z]\d+)/)?.[1];
    expect(seatId).toBeTruthy();
    await seatButton.click();
    await page.getByRole('button', { name: 'Giữ ghế trong 5 phút' }).click();
    await page.getByLabel('Điền nhanh từ hành khách thường dùng').selectOption({
      label: 'E2E Updated · E2E Passenger',
    });
    await expect(page.getByLabel('Họ tên liên hệ')).toHaveValue('E2E Passenger');
    await expect(page.getByLabel('Email nhận vé')).toHaveValue('customer.demo@benviet.vn');
    await expect(page.getByLabel('Số điện thoại liên hệ')).toHaveValue('0907778899');
    await expect(page.getByLabel(`Họ tên hành khách ghế ${seatId}`)).toHaveValue('E2E Passenger');

    ({ accessToken, holdToken } = await page.evaluate((id) => {
      const authRaw = sessionStorage.getItem('bus:auth-session:v1');
      const auth = authRaw ? (JSON.parse(authRaw) as { accessToken?: string }) : undefined;
      return {
        accessToken: auth?.accessToken,
        holdToken: sessionStorage.getItem(`bus:seat-hold:v1:${id}`) ?? undefined,
      };
    }, tripId));
  } finally {
    if (!accessToken) {
      accessToken = await page
        .evaluate(() => {
          const raw = sessionStorage.getItem('bus:auth-session:v1');
          return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : undefined;
        })
        .catch(() => undefined);
    }
    if (!holdToken) {
      holdToken = await page
        .evaluate((id) => sessionStorage.getItem(`bus:seat-hold:v1:${id}`) ?? undefined, tripId)
        .catch(() => undefined);
    }
    if (holdToken && accessToken) {
      await page.request.post('/graphql', {
        headers: { authorization: `Bearer ${accessToken}` },
        data: {
          query:
            'mutation($input: ReleaseSeatHoldInput!) { releaseSeatHold(input: $input) { released } }',
          variables: { input: { holdToken, idempotencyKey: randomUUID() } },
        },
      });
    }
    if (accessToken) await deleteProfilesByLabel(page, accessToken, 'E2E Updated');
  }
});

async function loginAs(page: Page, role: 'customer' | 'staff' | 'admin'): Promise<void> {
  const credentials =
    role === 'admin'
      ? { email: 'admin.demo@benviet.vn', password: 'Admin123!' }
      : role === 'staff'
        ? { email: 'staff.demo@benviet.vn', password: 'Staff123!' }
        : { email: 'customer.demo@benviet.vn', password: 'Customer123!' };
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.auth-grid')).toHaveAttribute('data-hydrated', 'true', {
    timeout: 20_000,
  });
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Mật khẩu').fill(credentials.password);
  const submit = page.getByRole('button', { name: 'Đăng nhập', exact: true });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await Promise.all([
    page.waitForURL(
      role === 'admin'
        ? '**/admin/operations'
        : role === 'staff'
          ? '**/staff/check-in'
          : '**/account/bookings',
      { waitUntil: 'domcontentloaded' },
    ),
    submit.click(),
  ]);
}

async function deleteProfilesByLabel(
  page: Page,
  accessToken: string,
  label: string,
): Promise<void> {
  const listed = await page.request.post('/graphql', {
    headers: { authorization: `Bearer ${accessToken}` },
    data: { query: '{ passengerProfiles { id label } }' },
  });
  const body = (await listed.json()) as {
    data?: { passengerProfiles?: Array<{ id: string; label: string }> };
  };
  for (const profile of body.data?.passengerProfiles ?? []) {
    if (profile.label !== label && profile.label !== 'E2E Profile') continue;
    await page.request.post('/graphql', {
      headers: { authorization: `Bearer ${accessToken}` },
      data: {
        query: 'mutation($id: ID!) { deletePassengerProfile(id: $id) { deleted } }',
        variables: { id: profile.id },
      },
    });
  }
}

function deleteAdminTrip(createdTripId: string): void {
  expect(createdTripId).toMatch(
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
      input: `DELETE FROM seat_inventory.seat_block_commands WHERE trip_id = '${createdTripId}'::uuid;
DELETE FROM seat_inventory.trip_seat_states WHERE trip_id = '${createdTripId}'::uuid;
DELETE FROM catalog.admin_audit WHERE target_id = '${createdTripId}'::uuid;
DELETE FROM catalog.fares WHERE trip_id = '${createdTripId}'::uuid;
DELETE FROM catalog.trips WHERE id = '${createdTripId}'::uuid;\n`,
      shell: process.platform === 'win32',
    },
  );
  expect(result.status, result.stderr).toBe(0);
}

function deleteCatalogCrud(ids: {
  location?: string;
  layout?: string;
  vehicle?: string;
  route?: string;
  trip?: string;
}): void {
  for (const value of Object.values(ids)) if (value) expect(value).toMatch(/^[0-9a-f-]{36}$/i);
  const values = Object.values(ids).filter(Boolean) as string[];
  if (values.length === 0) return;
  const quoted = values.map((value) => `'${value}'::uuid`).join(',');
  const statements = [
    `DELETE FROM catalog.admin_audit WHERE target_id IN (${quoted});`,
    ids.trip && `DELETE FROM catalog.fares WHERE trip_id = '${ids.trip}'::uuid;`,
    ids.trip && `DELETE FROM catalog.trips WHERE id = '${ids.trip}'::uuid;`,
    ids.route && `DELETE FROM catalog.route_stops WHERE route_id = '${ids.route}'::uuid;`,
    ids.route && `DELETE FROM catalog.routes WHERE id = '${ids.route}'::uuid;`,
    ids.vehicle && `DELETE FROM catalog.vehicles WHERE id = '${ids.vehicle}'::uuid;`,
    ids.layout && `DELETE FROM catalog.seat_layout_versions WHERE id = '${ids.layout}'::uuid;`,
    ids.location && `DELETE FROM catalog.locations WHERE id = '${ids.location}'::uuid;`,
  ]
    .filter(Boolean)
    .join('\n');
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
      shell: process.platform === 'win32',
      input: `${statements}\n`,
    },
  );
  expect(result.status, result.stderr).toBe(0);
}

function deleteRegisteredBooking(bookingId: string): void {
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
