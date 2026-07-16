# ADR-002: Redis lease plus durable seat uniqueness

## Status

Accepted

## Date

2026-07-13

## Context

Seat selection cần phản hồi nhanh, TTL 5 phút và không double-book khi có concurrent request. Redis TTL đơn lẻ nhanh nhưng không đủ làm nguồn sự thật sau payment/restart.

## Decision

- Hold là Redis lease atomic theo trip, được tạo bằng Lua/transaction all-or-nothing.
- Hold gắn opaque token, owner và server expiry; release/confirm dùng compare-token.
- Seat Service là owner duy nhất của inventory.
- Confirmed seat được bảo vệ thêm bằng unique constraint trong PostgreSQL và idempotency theo booking ID.
- Subscription chỉ là notification; client refetch snapshot khi reconnect.
- Expiry business event do sweeper/delayed work phát, không phụ thuộc Redis keyspace notification.

## Alternatives considered

- Chỉ database row lock: đúng nhưng khó giữ lock xuyên 5 phút và giảm throughput.
- Chỉ Redis SET NX: không có durable protection cho BOOKED và multi-seat atomicity chưa đủ rõ.
- Distributed transaction giữa Booking DB và Seat DB: chi phí quá lớn; dùng idempotent commands và retry/reconciliation.

## Consequences

- Cần concurrency/integration test với Redis và PostgreSQL thật.
- Có một số eventual UI update, nhưng authoritative command vẫn nhất quán.
- Phải có reconciliation/runbook khi Redis restart hoặc confirm bị gián đoạn.
