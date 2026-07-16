# ADR-003: AI and MCP are constrained read/tool adapters

## Status

Accepted

## Date

2026-07-13

## Context

Chatbot cần tìm chuyến, giải thích policy và tra cứu booking. MCP cho phép AI client bên ngoài gọi các khả năng tương tự. Dữ liệu booking chứa PII và model có thể hallucinate hoặc bị prompt injection.

## Decision

- Dữ liệu động chỉ đến từ typed tool call tới domain service.
- Booking lookup cần booking code + normalized email; error không tiết lộ sự tồn tại.
- Policy response phải có source/version/effective date.
- MCP mặc định read-only và chia scope; analytics tool yêu cầu admin credential và audit.
- Tool/resource output được coi là untrusted data trong model context.
- Không đưa raw email/phone/document vào analytics event hoặc AI log.

## Alternatives considered

- Cho model query database: phá service boundary và khó audit/authorize.
- Chỉ prompt model bằng toàn bộ booking/policy: rủi ro lộ PII, stale data và injection.
- Public revenue tools: không phù hợp RBAC và yêu cầu admin.

## Consequences

- Chatbot có thể từ chối hoặc báo không tra cứu được thay vì trả lời trôi chảy nhưng sai.
- Cần tool authorization test và prompt-injection test.
- MCP/AI adapters tái dùng domain contract, không sở hữu business logic.
