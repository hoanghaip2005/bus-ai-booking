# Foundation implementation sources

Các pattern framework-specific của Milestone 0.1 được kiểm tra theo tài liệu
chính thức sau vào ngày 2026-07-13:

- Next.js App Router installation and TypeScript requirements:
  https://nextjs.org/docs/app/getting-started/installation
- NestJS GraphQL quick start and Apollo driver setup:
  https://docs.nestjs.com/graphql/quick-start
- NestJS gRPC transporter configuration:
  https://docs.nestjs.com/microservices/grpc
- Model Context Protocol TypeScript server and Streamable HTTP guidance:
  https://modelcontextprotocol.io/docs/develop/build-server
- Turborepo workspace structure:
  https://turborepo.com/docs/crafting-your-repository/structuring-a-repository
- pnpm workspace configuration:
  https://pnpm.io/workspaces
- Docker Compose startup order and health checks:
  https://docs.docker.com/compose/how-tos/startup-order/
- NestJS GraphQL subscriptions with `graphql-ws`:
  https://docs.nestjs.com/graphql/subscriptions
- Apollo Server subscription transport guidance:
  https://www.apollographql.com/docs/apollo-server/data/subscriptions
- NestJS structured JSON logging:
  https://docs.nestjs.com/techniques/logger
- OpenTelemetry JavaScript Node.js setup:
  https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
- OpenTelemetry manual context and instrumentation guidance:
  https://opentelemetry.io/docs/languages/js/instrumentation/

Version pins were verified from the corresponding npm package metadata. The
repository deliberately uses TypeScript 5.9 instead of the latest TypeScript 7
because `typescript-eslint` 8 declares compatibility below TypeScript 6.1.
GraphQL is pinned to 16.11 because NestJS GraphQL 13 declares a GraphQL 16 peer
range.
