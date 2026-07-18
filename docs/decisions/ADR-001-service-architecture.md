# ADR-001: GraphQL edge, gRPC internal, event-driven workflows

## Status

Accepted

## Date

2026-07-13

## Context

Project bắt buộc dùng GraphQL, gRPC, microservices, RabbitMQ/Kafka, Redis, Nginx, Next.js, AI SDK và MCP Server. Nếu dùng mọi công nghệ cho cùng một mục đích, hệ thống sẽ phức tạp và khó giải thích.

## Decision

- GraphQL là API public cho web và subscription realtime.
- gRPC là contract đồng bộ nội bộ giữa gateway/MCP và domain service.
- RabbitMQ xử lý workflow transactional cần worker, retry và DLQ.
- Kafka ghi analytics event có retention/replay.
- Redis xử lý cache, ephemeral hold và Pub/Sub adapter; PostgreSQL giữ dữ liệu bền vững.
- Nginx là entrypoint duy nhất cho browser/external MCP client.
- Nginx phân phối GraphQL traffic qua nhiều Gateway worker stateless; Redis
  Pub/Sub giữ subscription fan-out nhất quán giữa các instance.

## Alternatives considered

- GraphQL federation giữa mọi service: tăng chi phí vận hành và ownership phức tạp cho project học tập; chưa cần.
- Chỉ Kafka hoặc chỉ RabbitMQ: có thể đơn giản hơn, nhưng không thể hiện rõ hai workload bắt buộc và làm worker transactional hoặc analytics replay kém tự nhiên hơn.
- REST nội bộ: không đáp ứng yêu cầu gRPC và mất lợi ích contract/codegen protobuf.

## Consequences

- Có nhiều contract phải quản lý; bắt buộc codegen và contract test.
- Gateway phải mỏng, tránh trở thành monolith logic.
- Team phải vận hành hai broker, nhưng mỗi broker có phạm vi rõ và demo được trade-off.
