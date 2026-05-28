# ADR-007: Auth Session Contract

Status: Accepted
Date: 2026-05-21

## Context

Infinite Track backend is the final authority for authentication state and session validity. Access tokens are still JWTs, but protected-route authorization must not be purely stateless because logout, refresh rotation, session replacement, inactivity expiry, and revocation all depend on persisted backend state.

The backend supports two credential transports:

- browser/web clients receive HTTP-only auth cookies;
- native/non-browser clients receive credentials in JSON.

Existing clients also depend on legacy token fields, so the contract needs a primary shape that new clients can use while preserving backward-compatible fields during migration.

## Decision

The backend auth contract is session-backed. Every successful login or register creates an `auth_sessions` row, and every access token includes the backend `session_id`. Protected routes validate the decoded access JWT against the persisted session before accepting the request.

Login creates one active session per user per resolved client type. A new login for the same user and client type revokes previous active sessions for that same client type with `revocation_reason = 'replaced_by_new_login'`. The same-client replacement runs inside one database transaction and locks the user row before revoking and creating sessions, so concurrent replacement attempts for the same user are serialized and failed replacement creation does not revoke the previous session. Sessions for other client types remain active.

Refresh tokens include both `session_id` and refresh `jti`. Refresh rotates the refresh `jti` with a compare-and-swap update against the current persisted `refresh_jti`, so a consumed refresh token cannot be reused after a successful rotation.

## Client Type Resolution

Clients can explicitly request transport behavior with `X-Client-Type`:

- `web` uses browser cookie transport;
- `mobile` uses native JSON transport;
- `android` remains a backward-compatible native JSON alias.

When the header is absent, the backend falls back to User-Agent and Bearer-token heuristics. Native fallback values may still persist as `android` for compatibility, while explicit `mobile` persists as `mobile`.

## Response Contract

The primary response contract is `data.auth`:

- web login and web refresh return `data.auth.access_token` in JSON and rotate HTTP-only cookies;
- native login and native refresh return `data.auth.access_token` and `data.auth.refresh_token` in JSON.

Backward-compatible direct fields remain available:

- login web: `data.token`;
- login native: `data.token` and `data.refresh_token`;
- refresh web: `data.access_token`;
- refresh native: `data.access_token` and `data.refresh_token`.

New clients should read `data.auth`. Legacy fields are kept for existing web and Android/mobile integrations.

## Refresh Rejection Contract

Refresh failures use stable error codes:

| Condition | HTTP | Code | Message |
| --- | --- | --- | --- |
| malformed refresh JWT, missing session identity, stale/consumed refresh JTI | 401 | `AUTH_REFRESH_TOKEN_INVALID` | `Refresh token invalid` |
| persisted session already revoked | 401 | `AUTH_REFRESH_TOKEN_REVOKED` | `Refresh session revoked` |
| refresh JWT expired, persisted session expired, or session inactive beyond the inactivity window | 401 | `AUTH_SESSION_INACTIVE` | `Refresh session expired` |

The inactivity window is controlled by `JWT_REFRESH_INACTIVITY_WINDOW_SECONDS`; the current deployment contract is 48 hours.

## Protected Route Contract

`verifyToken` accepts a Bearer token before falling back to the `token` cookie. Malformed or non-Bearer Authorization headers are rejected and must not fall back to cookies.

After JWT verification, `verifyToken` checks the persisted `auth_sessions` row by `session_id`. The request is rejected when the session is missing, belongs to a different user, is revoked, is absolutely expired, or is inactive beyond the refresh inactivity window.

Expired access JWTs return `AUTH_ACCESS_TOKEN_EXPIRED` with `details.refreshable = true` so clients can attempt refresh when they still have a valid refresh session.

## Consequences

- Logout and same-client login replacement are enforced by backend session state, not by trusting clients to discard tokens.
- Refresh token replay is rejected by persisted `refresh_jti` rotation.
- Web and native transports remain compatible while sharing the same session lifecycle model.
- OpenAPI must describe `data.auth` as the primary token response shape while retaining legacy fields until clients are migrated.
- Any future auth/session changes must update both `docs/openapi.yaml` and this ADR when they change wire contract, error codes, or persisted session semantics.

## Verification

The contract is covered by auth/session tests for:

- stateful protected-route session validation;
- Authorization header precedence over cookie tokens;
- malformed Authorization rejection without cookie fallback;
- login web cookie transport and native JSON transport;
- explicit `X-Client-Type: web`, `mobile`, and backward-compatible `android`;
- same-client session replacement without revoking other client types;
- atomic same-client login replacement using a transaction and user-row lock;
- refresh JTI rotation and concurrent rotation rejection;
- refresh invalid, revoked, expired, and inactive error contracts;
- logout revocation and cookie clearing.
