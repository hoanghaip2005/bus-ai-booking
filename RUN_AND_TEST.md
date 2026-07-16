# Hướng dẫn chạy và kiểm thử dự án

Tài liệu này mô tả cách dựng, chạy và kiểm thử toàn bộ hệ thống đặt vé xe khách
liên tỉnh tích hợp AI. Hệ thống chạy local bằng Docker Compose và được truy cập
qua Nginx ở cổng `8080`.

## 1. Kiến trúc chạy local

- `apps/web`: Next.js UI và route AI SDK.
- `apps/graphql-gateway`: GraphQL boundary duy nhất cho browser.
- `apps/mcp-server`: MCP Streamable HTTP cho AI client bên ngoài.
- `services/catalog-service`: địa điểm, tuyến, xe, layout và chuyến.
- `services/seat-inventory-service`: trạng thái ghế và Redis hold.
- `services/booking-service`: booking, passenger snapshot và state machine.
- `services/payment-service`: thanh toán mô phỏng.
- `services/identity-service`: user, role, access/refresh token.
- `services/analytics-service`: Kafka projection và báo cáo.
- `services/ticket-worker`: HTML/PDF/QR ticket.
- `services/notification-worker`: email delivery log mô phỏng.
- `infra`: PostgreSQL, Redis, RabbitMQ, Kafka và Nginx.

Browser chỉ gọi GraphQL Gateway. Các service gọi nhau bằng gRPC; RabbitMQ dùng
cho workflow và Kafka dùng cho analytics. MCP không đọc database trực tiếp.

## 2. Yêu cầu máy local

| Thành phần     | Yêu cầu                      |
| -------------- | ---------------------------- |
| Node.js        | `22+`                        |
| pnpm           | `11+`                        |
| Docker Desktop | đang chạy, hỗ trợ Compose v2 |
| RAM            | khuyến nghị từ 8 GB          |
| E2E browser    | Chromium                     |

Kiểm tra nhanh:

```bash
node --version
pnpm --version
docker --version
docker compose version
```

## 3. Clone và cài dependency

```bash
git clone https://github.com/hoanghaip2005/bus-ai-booking.git
cd bus-ai-booking
pnpm install
```

`pnpm-lock.yaml` đã được commit. Không nên xóa lockfile hoặc dùng npm/yarn để
cài dependency cho workspace này.

## 4. Cấu hình môi trường

Local demo có default trong code và Docker Compose nên có thể chạy ngay. Khi
muốn thay đổi port/password/URL, tạo `.env` từ template.

PowerShell:

```powershell
Copy-Item .env.example .env
```

Linux/macOS:

```bash
cp .env.example .env
```

Nhóm biến quan trọng:

- `POSTGRES_*`: PostgreSQL local.
- `REDIS_URL`: Redis cho hold, cache và rate limit.
- `KAFKA_BROKERS`: Kafka analytics.
- `RABBITMQ_URL`: RabbitMQ workflow.
- `IDENTITY_ACCESS_TOKEN_SECRET`: secret HMAC local.
- `NGINX_PORT`: edge port, mặc định `8080`.
- `E2E_BASE_URL`: URL E2E, mặc định `http://127.0.0.1:8080`.

Chỉ `.env.example` được commit. Không commit `.env`, access token, refresh token
hoặc credential thật.

## 5. Dựng infrastructure

Khởi động PostgreSQL, Redis, RabbitMQ, Kafka và Nginx:

```bash
pnpm env:up
pnpm env:wait
```

Kiểm tra trạng thái:

```bash
docker compose -f infra/docker-compose.yml ps
```

Tất cả 5 service phải có trạng thái `healthy`.

Chạy migration và seed:

```bash
pnpm db:migrate
pnpm db:seed
```

Migration được áp dụng theo thứ tự `001` đến `027`; seed có tính idempotent.
Không sửa migration đã được áp dụng.

Reset hoàn toàn dữ liệu local:

```bash
pnpm env:clean
pnpm env:up
pnpm env:wait
pnpm db:migrate
pnpm db:seed
```

`pnpm env:clean` xóa Docker volume của database/broker. Chỉ dùng cho local.

## 6. Chạy application stack

Mở terminal riêng:

```bash
pnpm dev
```

Lệnh này chạy web, GraphQL Gateway, MCP, toàn bộ service và worker qua
Turborepo. Giữ terminal này mở.

Ở terminal thứ hai, chờ readiness:

```bash
node scripts/wait-for-apps.mjs
```

Các readiness route được kiểm tra qua Nginx:

| Route                    | Thành phần          |
| ------------------------ | ------------------- |
| `/health`                | Nginx               |
| `/gateway-health`        | GraphQL Gateway     |
| `/catalog-health`        | Catalog             |
| `/seat-inventory-health` | Seat Inventory      |
| `/booking-health`        | Booking             |
| `/payment-health`        | Payment             |
| `/ticket-health`         | Ticket Worker       |
| `/notification-health`   | Notification Worker |
| `/identity-health`       | Identity            |
| `/analytics-health`      | Analytics           |
| `/mcp-health`            | MCP                 |

## 7. URL và cổng local

| URL/cổng                        | Mục đích            |
| ------------------------------- | ------------------- |
| `http://localhost:8080`         | web qua Nginx       |
| `http://localhost:8080/graphql` | GraphQL qua Nginx   |
| `http://localhost:8080/mcp`     | MCP qua Nginx       |
| `http://localhost:3000`         | Next.js trực tiếp   |
| `http://localhost:4000/graphql` | Gateway trực tiếp   |
| `http://localhost:3002/mcp`     | MCP trực tiếp       |
| `http://localhost:15672`        | RabbitMQ management |
| `localhost:5432`                | PostgreSQL          |
| `localhost:6379`                | Redis               |
| `localhost:5672`                | RabbitMQ AMQP       |
| `localhost:9092`                | Kafka               |

Nên demo và E2E qua `8080` để test đúng Nginx boundary.

## 8. Tài khoản demo

| Role     | Email                      | Password       |
| -------- | -------------------------- | -------------- |
| CUSTOMER | `customer.demo@benviet.vn` | `Customer123!` |
| STAFF    | `staff.demo@benviet.vn`    | `Staff123!`    |
| ADMIN    | `admin.demo@benviet.vn`    | `Admin123!`    |

Đây là credential local/test:

- CUSTOMER: booking history, passenger profile và cancellation.
- STAFF: ticket lookup và check-in.
- ADMIN: Catalog, trip, seat block, operations và analytics.
- Guest: search, hold, checkout và booking lookup bằng code + email.

## 9. Demo nhanh toàn hệ thống

Khi `pnpm dev` đang chạy:

```bash
pnpm demo:verify
```

Flow kiểm tra:

1. HTTP/Nginx, GraphQL, gRPC và WebSocket.
2. Location alias và tìm chuyến.
3. Redis seat hold với TTL.
4. Booking `PENDING_PAYMENT`.
5. Payment success/failure mô phỏng.
6. Durable seat confirmation.
7. Ticket HTML/PDF/QR.
8. Notification delivery log.
9. Analytics projection.
10. AI tool grounding và privacy.
11. MCP tools/resources/admin authorization.
12. MCP bounded load.

Smoke độc lập:

```bash
pnpm test:smoke
```

## 10. GraphQL thử nhanh

Endpoint: `http://localhost:8080/graphql`.

Location autocomplete:

```graphql
query LocationSuggestions($query: String!) {
  locationSuggestions(query: $query) {
    id
    code
    name
    kind
    parentLocationId
  }
}
```

Variables:

```json
{ "query": "Sai Gon" }
```

Search trips:

```graphql
query SearchTrips($input: SearchTripsInput!) {
  searchTrips(input: $input) {
    timezone
    origin {
      code
      name
    }
    destination {
      code
      name
    }
    trips {
      id
      operatorName
      vehicleTypeName
      departureAt
      arrivalAt
      priceVnd
      remainingSeats
    }
    nearestTravelDates
  }
}
```

Variables:

```json
{
  "input": {
    "origin": "TP.HCM",
    "destination": "Đà Lạt",
    "travelDate": "2030-06-20",
    "sort": "DEPARTURE_EARLIEST"
  }
}
```

Authentication dùng HTTP Authorization/session ở Gateway. Không truyền access
token thành GraphQL argument.

## 11. MCP thử nhanh

Liệt kê tools:

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Liệt kê resources:

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"resources/list"}'
```

Public search tool:

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_trips","arguments":{"origin":"TP.HCM","destination":"Đà Lạt","travelDate":"2030-06-20"}}}'
```

Admin analytics tool cần access token ADMIN lấy từ GraphQL login:

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_revenue_summary","arguments":{"fromDate":"2030-06-20","toDate":"2030-06-20"}}}'
```

Không ghi access token vào log hoặc commit. Resources chính:

- `bus://policy/cancellation`
- `bus://policy/checkin`
- `bus://routes/popular`
- `bus://system/health`

Booking lookup bắt buộc cả booking code và normalized email; sai credential trả
denial trung tính và không lộ PII.

## 12. Các nhóm test

### Static, contracts và build

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm check
pnpm test:contract
pnpm build
pnpm verify
```

`pnpm verify` chạy format/lint/typecheck, contract generation/check, unit test
và production build.

### Unit

```bash
pnpm test:unit
```

Bao phủ domain validation, state transition, token, event mapping, AI privacy và
logic không cần Docker.

### Integration

Infrastructure phải healthy:

```bash
pnpm test:integration
```

Bao phủ PostgreSQL, Redis Lua/TTL, gRPC handler, Kafka projection, RabbitMQ
outbox/worker và Identity session lifecycle.

### Race, workers và MCP

```bash
pnpm test:seat-race
pnpm test:workers
pnpm test:mcp
```

- `test:seat-race`: nhiều owner tranh cùng một ghế, chỉ một hold thành công.
- `test:workers`: retry, dedupe, outbox và dead-letter.
- `test:mcp`: schema, authz, privacy, rate limit, resources và Redis cache.

### AI evaluation

Ứng dụng phải đang chạy:

```bash
pnpm test:ai-eval
```

Bao phủ grounded search, policy citation, booking privacy và prompt injection.

### Browser E2E

```bash
pnpm test:e2e
```

Playwright chạy Chromium với một worker để tránh flow dùng chung trip/seat seed
tranh chấp. Nếu chưa có browser:

```bash
pnpm exec playwright install chromium
```

Artifact lỗi nằm trong `test-results/` hoặc `playwright-report/`.

### Smoke, load, restore và dashboard

```bash
pnpm test:smoke
pnpm test:mcp-load
pnpm test:backup-restore
pnpm test:release-dashboard
```

- `test:smoke`: full journey qua Nginx.
- `test:mcp-load`: 20 request, concurrency 4, kiểm tra p95 regression.
- `test:backup-restore`: restore PostgreSQL vào database tạm rồi cleanup.
- `test:release-dashboard`: dashboard chỉ tham chiếu metric được code phát ra.

## 13. Thứ tự kiểm thử khuyến nghị

Kiểm tra nhanh trước commit:

```bash
pnpm check
pnpm test:unit
pnpm test:release-dashboard
```

Gate không cần browser app:

```bash
pnpm verify
pnpm test:integration
pnpm test:seat-race
pnpm test:workers
pnpm test:mcp
pnpm test:backup-restore
```

Gate cần app stack, terminal A:

```bash
pnpm dev
```

Terminal B:

```bash
node scripts/wait-for-apps.mjs
pnpm test:ai-eval
pnpm test:e2e
pnpm demo:verify
```

## 14. Cleanup

Dừng app bằng `Ctrl+C` trong terminal `pnpm dev`.

Dừng container nhưng giữ volume:

```bash
pnpm env:down
```

Xóa cả volume/database local:

```bash
pnpm env:clean
```

Kiểm tra RabbitMQ queue:

```bash
docker compose -f infra/docker-compose.yml exec -T rabbitmq rabbitmqctl list_queues name messages
```

Redis temporary namespaces:

- `seat-inventory:hold:v1:*`
- `ai:rate-limit:v1:*`
- `mcp:rate-limit:v1:*`
- `mcp:resource:v1:*`

Không xóa namespace khác nếu chưa xác định owner service.

## 15. Xử lý lỗi thường gặp

### Readiness trả 502/503

```bash
pnpm env:wait
docker compose -f infra/docker-compose.yml ps
node scripts/wait-for-apps.mjs
```

Xem log terminal `pnpm dev`; lần compile đầu có thể mất thêm thời gian.

### Migration hoặc seed lỗi

```bash
pnpm env:clean
pnpm env:up
pnpm env:wait
pnpm db:migrate
pnpm db:seed
```

Không sửa trực tiếp migration đã commit.

### Port đã được sử dụng

App dùng `3000-3009`, `4000`, `50051-50057`; edge dùng `8080`. Docker dùng
`5432`, `6379`, `5672`, `9092`, `15672`. Dừng process/container giữ port trước
khi chạy lại.

### MCP trả `RATE_LIMITED`

Đây là hành vi đúng. Chờ hết cửa sổ 60 giây hoặc dùng client khác trong local
test. Không tắt rate limit để ép test pass.

### MCP admin trả `401` hoặc `403`

- `401`: thiếu, sai, hết hạn hoặc access token đã bị logout/revoke.
- `403`: token hợp lệ nhưng role không phải `ADMIN`.

Analytics kiểm tra lại quyền ADMIN tại service-side.

### Playwright thiếu browser

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

### Docker thiếu RAM

Đóng container không liên quan, tăng Docker Desktop memory rồi chạy lại
`pnpm env:up` và `pnpm env:wait`.

## 16. An toàn khi chia sẻ repo public

- Chỉ commit `.env.example`, không commit `.env`.
- Không đưa access/refresh token vào issue, README hoặc log.
- Không commit PostgreSQL dump, PDF ticket cá nhân hoặc log có booking/email.
- Password trong seed chỉ dùng local và phải thay khi deploy thật.
- Payment, email/SMS và AI provider hiện là mô phỏng/local theo scope dự án.
