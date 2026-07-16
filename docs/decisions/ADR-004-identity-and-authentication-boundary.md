# ADR-004: Identity and authentication boundary

## Status

Accepted for Milestone 4.

## Context

The platform needs customer, staff and admin identities without moving booking,
catalog or operational authorization into the Gateway. Access credentials must
be short lived, refresh credentials must rotate, and owning services must still
authorize privileged commands.

## Decision

- Identity Service exclusively owns users, password credentials, refresh
  sessions and access-token signing.
- Browser authentication operations remain GraphQL. The Gateway translates
  `login`, `refreshSession`, `logout` and `viewer` to generated Identity gRPC
  calls; it never queries Identity tables.
- Access tokens are signed HS256 JWTs containing only `sub`, `role`, `jti`,
  issuer, audience and time claims. Identity Service validates signature,
  expiry and the current active user before returning an actor.
- Refresh tokens are opaque high-entropy bearer credentials. Identity stores
  only a SHA-256 digest, rotates the session on every refresh and rejects
  expired, revoked or replayed credentials.
- For privileged GraphQL operations, the Gateway validates the access token
  through Identity Service and propagates actor ID, role and token ID through
  gRPC metadata. The owning service performs the final authorization check.
- Guest checkout remains independent and continues to derive ownership from
  `x-checkout-session-id`.

## Consequences

- Identity availability is required for authenticated operations but not for
  guest search, checkout or ticket delivery.
- Revocation of a refresh session prevents future rotation; short access-token
  lifetime bounds exposure of an already issued access token.
- Access and refresh tokens are never logged or persisted outside Identity's
  refresh-token digest.
- Local development uses a configured HMAC secret. Production must inject a
  rotated secret from a secret manager and should migrate to asymmetric keys if
  independent offline verification is later required.
