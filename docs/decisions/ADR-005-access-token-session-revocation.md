# ADR-005: Access tokens follow refresh-session revocation

## Status

Accepted for Milestone 8.

## Context

ADR-004 made access JWTs short lived and refresh credentials revocable. That
left an access token usable until expiry after logout, which is not sufficient
for privileged MCP analytics tools: a logged-out admin credential must stop
authorizing requests immediately.

## Decision

- Every access JWT includes a `sid` claim containing the ID of the refresh
  session that issued it.
- Identity Service validates the JWT signature, expiry, active user and the
  referenced refresh session on every access-token validation request.
- A refresh session is active only when it belongs to the token subject, has
  not expired and has not been revoked.
- Login binds the access token to the initial refresh session. Refresh rotation
  binds the replacement access token to the replacement refresh session.
- Logout revokes that session, immediately invalidating its associated access
  token. Tokens without a valid `sid` are rejected.
- Other services continue to receive only the privacy-minimal actor metadata;
  the session ID is not propagated beyond Identity Service.

## Alternatives considered

- Keep stateless access tokens until expiry: simpler, but leaves logged-out
  privileged credentials usable during the remaining TTL.
- Add a separate token denylist: duplicates lifecycle state already owned by
  refresh sessions and requires additional cleanup semantics.
- Bind tokens to a session-family ID: logout currently revokes the exact active
  session, while rotation already creates a new session ID, so family-wide
  binding would be broader than required.

## Consequences

- Access-token validation now requires an Identity database read. Authenticated
  operations already depend on Identity availability, so the external boundary
  does not change.
- Logout and refresh rotation invalidate access tokens issued from the replaced
  session immediately.
- Existing access tokens without `sid` become invalid and users must log in
  again after deployment.
