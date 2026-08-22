# INF-278 — Production Nginx Ingress Hardening Design

**Date:** 2026-08-17
**Repository:** `Infinite-LearningV1/Infinit_Track_BE`
**Base:** `origin/develop` at `a52426f6dfa26dbad18c59b30b620e0104099b52`
**Branch:** `djangosuryaa/inf-278-backendinfra-harden-production-nginx-ingress-and-reverse`
**Linear:** `INF-278`
**Status:** Design approved; implementation not started

## Purpose

Harden the production API ingress so `api.infinite-track.tech` has exactly one public backend ingress: the host Nginx instance on the production Droplet.

The change preserves the existing Droplet + Docker Compose + managed MySQL runtime and keeps Nginx as a thin transport boundary. It does not move application policy into Nginx and does not change public API semantics.

Target topology:

```text
Web FE / Android
      ↓ HTTPS
api.infinite-track.tech :443
      ↓
Host Nginx
      ↓ loopback HTTP only
Express 127.0.0.1:3005
      ↓
Managed MySQL
```
## Current Runtime Findings

The current repository already establishes the main deployment direction, but the ingress contract is incomplete:

- `docker-compose.yml` uses `network_mode: host` for the backend container.
- `src/server.js` calls `app.listen(config.port)` without an explicit bind host.
- `src/app.js` uses production `trust proxy = 1`.
- `deploy/nginx/api.infinite-track.tech.conf` proxies to `127.0.0.1:3005` but forwards unconditional `Upgrade` and `Connection: upgrade` headers.
- no WebSocket, Socket.IO, or other HTTP-upgrade runtime was found in the backend repository.
- Express accepts JSON and URL-encoded bodies up to `10mb`.
- face-photo upload uses Multer memory storage with a `20MB` file-size limit.
- Nginx has no tracked explicit body-size contract.
- the tracked Nginx vhost is HTTP-only bootstrap configuration and expects Certbot to mutate the host config for final HTTPS behavior.
- `deploy/scripts/verify-droplet-api.sh` already verifies DNS, local liveness/readiness, Nginx syntax when available, public HTTPS health, docs protection, and representative anonymous rejection.
- Kubernetes and historical App Platform deployment surfaces are not production authority for INF-278.

Baseline before INF-278 implementation:

```text
npm run lint: PASS
Test Suites: 158 passed, 158 total
Tests:       1530 passed, 1530 total
```

The initial local `npm ci` required `PUPPETEER_SKIP_DOWNLOAD=true` because of a broken local Puppeteer Chrome cache; this is workstation-only setup evidence and is not part of the product/runtime design.
## Architecture Decision

Production uses one host Nginx in front of the Express process. Nginx owns only ingress and transport concerns:

- TCP ports `80` and `443` exposed publicly for the API host;
- HTTP-to-HTTPS redirect;
- TLS certificate presentation;
- reverse proxying to the loopback backend;
- standard proxy headers;
- transport-level request-body envelope;
- proxy connection/read/send timeouts.

Express remains authoritative for:

- JWT authentication and session semantics;
- RBAC/authorization;
- CORS policy and credentialed browser requests;
- application/login rate limiting;
- request validation and error mapping;
- attendance, geofence, WFA, FAHP, and other business rules;
- `/livez`, `/health`, `/docs`, `/docs/openapi.yaml`, and all `/api/*` response semantics.

Nginx must not synthesize application health responses, decode JWTs, duplicate CORS rules, cache API responses, or implement business-specific access decisions.

## Runtime Network Exposure

The canonical production bind address is `127.0.0.1` and the canonical application port is `3005`.

A new runtime variable named `APP_BIND_HOST` makes the listener contract explicit without overloading database `DB_HOST`. The production env template sets:

```env
APP_BIND_HOST=127.0.0.1
PORT=3005
```

Production defaults `config.bindHost` to `127.0.0.1` when the variable is absent and rejects a production `APP_BIND_HOST` value other than `127.0.0.1`. Non-production keeps the current unspecified-host listener behavior unless `APP_BIND_HOST` is explicitly provided. This makes the production boundary fail-safe while preserving local-development compatibility.

`src/config/index.js` exposes the resolved value as `config.bindHost`. `src/server.js` must use the Node/Express signature:

```js
app.listen(config.port, config.bindHost, callback);
```

Production therefore remains compatible with `network_mode: host` while preventing the process from listening on the Droplet's public interfaces.

Runtime verification must prove both sides of the boundary:

1. on the Droplet, the backend listener is bound to `127.0.0.1:3005` and local health checks work;
2. from outside the Droplet, a direct connection to `<droplet-public-ip>:3005` fails.

DigitalOcean firewall configuration must not contain an inbound rule exposing `3005`. INF-278 does not redesign SSH policy; it only requires that application ingress remain restricted to Nginx-facing public ports.

## Express Proxy Trust

The verified topology has one same-host proxy hop, and the only trusted proxy source is loopback. Production therefore uses:

```js
app.set('trust proxy', 'loopback');
```

This replaces hop-count trust (`1`) with an address-based trust boundary.

A focused infrastructure configuration unit will apply this setting only in production. Tests must prove that a request entering from loopback with Nginx-style forwarding headers resolves:

- `req.ip` to the forwarded client address;
- `req.protocol` to `https` when `X-Forwarded-Proto: https` is supplied.

Tests must also prove that non-production behavior does not silently enable production proxy trust.
## Protocol Upgrade Policy

The production backend is a REST Express application. No repository evidence establishes a WebSocket or other HTTP-upgrade endpoint.

The Nginx proxy therefore removes these unconditional headers:

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

Normal HTTP/1.1 reverse proxying remains enabled. If a future feature introduces a real upgrade endpoint, that behavior requires a separate architecture decision and must be scoped only to the route that needs it.

## Request-Body Size Contract

The current public path is implicitly limited by Nginx while Express advertises a broader `10mb` parser limit. INF-278 makes the contract explicit and route-aware.

Canonical limits:

```text
General JSON / URL-encoded API body: 1 MiB
Face multipart Nginx envelope:       25 MiB
Actual face file accepted by Multer: 20 MiB
```

Express global JSON and URL-encoded parser limits become `1mb`.

The two legitimate face-upload surfaces retain the existing Multer `20MB` file-size rule:

- `POST /api/users`
- `POST /api/users/:id/photo`
Nginx uses `client_max_body_size 1m` as the default API transport envelope and overrides it to `25m` only for the two face-upload paths.

The Nginx `25m` value is intentionally larger than Multer's `20MB` file limit because multipart requests contain boundaries, headers, and form fields in addition to file bytes. Multer remains the application-level authority for the actual face-file limit.

No attendance, WFA, FAHP, auth, report, or ordinary JSON route receives the expanded multipart envelope unless repository evidence later establishes a legitimate need.

Boundary tests must cover:

- ordinary JSON below 1 MiB succeeds when otherwise valid;
- ordinary JSON above 1 MiB is rejected by the application parser in direct Express tests;
- Nginx configuration exposes only 1 MiB globally;
- face-upload locations have the 25 MiB transport envelope;
- Multer continues rejecting a face file above 20 MiB.

## Nginx Configuration Structure

Tracked production Nginx configuration is split by responsibility:

- `deploy/nginx/api.infinite-track.tech.bootstrap.conf` — initial HTTP-only certificate bootstrap surface;
- `deploy/nginx/api.infinite-track.tech.conf` — canonical final HTTP redirect + HTTPS reverse-proxy vhost;
- `deploy/nginx/snippets/infinite-track-api-proxy.conf` — shared reverse-proxy headers and timeout contract used by all proxied locations.

The current HTTP-only `api.infinite-track.tech.conf` is renamed to the bootstrap role before the canonical final file takes its name.

The shared proxy snippet retains:

```nginx
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```
It also retains the existing connect/read/send timeout behavior unless a failing runtime test demonstrates a need to change it. Upgrade headers are absent.

The final vhost proxies to:

```nginx
proxy_pass http://127.0.0.1:3005;
```

All application paths continue to reach Express. Nginx does not create special synthetic handlers for `/health`, `/livez`, `/docs`, `/docs/openapi.yaml`, or `/api/*`.

## HTTP and TLS Lifecycle

Certbot owns certificate issuance and renewal. It does not own or mutate the canonical Nginx application vhost.

Bootstrap sequence:

1. install the tracked bootstrap HTTP vhost;
2. expose `/.well-known/acme-challenge/` from a dedicated webroot such as `/var/www/certbot`;
3. obtain the certificate with Certbot webroot/cert-only mode;
4. install the tracked final Nginx vhost;
5. run `nginx -t` before reload;
6. reload Nginx only after syntax validation succeeds.

The final port `80` server keeps the ACME challenge path reachable for renewal and redirects all other requests to the equivalent HTTPS URL.

The final port `443` server references certificate files under the standard Certbot-managed `/etc/letsencrypt/live/api.infinite-track.tech/` path. No certificate private-key material is committed to Git.

The final vhost explicitly supports TLS 1.2 and TLS 1.3. Application security headers remain owned by Express/Helmet; INF-278 does not duplicate them in Nginx.

Certificate renewal must reload Nginx after a successful renewal through a Certbot deploy hook or equivalent system-managed renewal hook. The repository documentation must state this operational contract explicitly.
## Verification Architecture

Verification is divided according to where each property can actually be observed.

### Repository and CI verification

Jest contract tests must lock:

- production `APP_BIND_HOST` and `config.bindHost` behavior;
- production loopback proxy trust and forwarded IP/protocol semantics;
- the 1 MiB Express parser boundary;
- the unchanged 20 MiB Multer face-file boundary;
- the tracked Nginx final-vhost structure;
- absence of unconditional protocol-upgrade headers;
- the 1 MiB global Nginx body limit and 25 MiB face-upload overrides;
- HTTP redirect and HTTPS certificate directives in the final config;
- `/health` and `/livez` remaining Express-owned routes rather than Nginx-generated responses.

Every implementation batch must preserve `npm run lint` and the full non-integration `npm test` baseline.
### Droplet-local verification

`deploy/scripts/verify-droplet-api.sh` remains the host-side runtime verifier and is extended to prove:

- `nginx -t` passes;
- local `127.0.0.1:3005/livez` passes;
- local `127.0.0.1:3005/health` passes;
- the backend listener is bound only to loopback on port `3005`;
- public HTTPS liveness/readiness still pass;
- protected public routes still reject anonymous callers through Express.

### External verification

A check running outside the Droplet must prove that `<droplet-public-ip>:3005` is not reachable directly.

The production deployment workflow is the preferred automation point because its GitHub-hosted runner is external to the Droplet. A failed TCP/HTTP connection to port `3005` is success for this negative check; a successful direct response is a release blocker.

The same production gate must continue to verify:

- public port `80` redirects to HTTPS;
- public port `443` reaches the API through Nginx;
- Web FE credentialed CORS/login-session behavior works;
- a representative Android API request works without contract changes;
- the existing production smoke test passes.
## Deployment and Failure Semantics

Nginx configuration is never reloaded blindly. Deployment order is:

```text
stage tracked config/snippet
→ verify expected certificate files when final TLS config is selected
→ nginx -t
→ reload Nginx
→ run local health checks
→ run external ingress checks
→ run application smoke checks
```

If `nginx -t` fails, the active known-good Nginx configuration remains in service and the deployment stops before reload.

If Express fails after the listener change, Docker health/readiness evidence must identify the failure before the ingress change is considered complete. Binding to loopback must not alter database connectivity because the application still uses host networking for outbound managed-MySQL access.

If public HTTPS fails after a valid Nginx reload, operators restore the previous known-good vhost and rerun `nginx -t` before reloading. Certificate rollback does not copy private keys into the repository; it selects an existing valid Certbot-managed certificate lineage on the host.

INF-278 does not make Nginx return application JSON errors. Nginx transport failures such as an oversized request can retain standard Nginx transport responses; Express remains responsible for application-level validation and business-error envelopes.

## Source-of-Truth Boundaries

After implementation, production authority is:

- `docker-compose.yml` plus production env contract for the Express runtime;
- `deploy/nginx/api.infinite-track.tech.conf` for final public ingress behavior;
- `deploy/nginx/api.infinite-track.tech.bootstrap.conf` only for first certificate provisioning/recovery;
- `deploy/nginx/snippets/infinite-track-api-proxy.conf` for shared reverse-proxy transport settings;
- Certbot-managed `/etc/letsencrypt` state for certificate material;
- Express routes/middleware for API behavior and security policy.
Historical `k8s/` and `.do/` deployment artifacts are not promoted into the INF-278 production path. They may be referenced as historical context, but they must not override the Droplet + host-Nginx contract.

## Implementation Units

The implementation plan must keep changes bounded to the following responsibilities:

1. **HTTP runtime configuration** — introduce `APP_BIND_HOST`, loopback production trust, and the 1 MiB application parser contract without business logic.
2. **Server listener** — consume `config.bindHost` when starting Express.
3. **Nginx source contract** — split bootstrap/final vhosts, share proxy directives, remove protocol-upgrade headers, and encode body/TLS behavior.
4. **Ingress contract tests** — verify runtime network/proxy/body behavior and tracked Nginx invariants.
5. **Droplet verification** — extend the existing verifier for loopback listener and HTTP redirect evidence.
6. **External deployment verification** — prove direct public port `3005` is unavailable from outside the Droplet.
7. **Operational documentation** — document certificate bootstrap, renewal/reload, Nginx installation paths, verification, and rollback.

No database model, migration, controller business flow, repository/service business rule, attendance policy, WFA policy, FAHP calculation, JWT contract, or public OpenAPI endpoint contract is redesigned by these units.

## Acceptance Criteria

Implementation is acceptable only when all of the following are true:

- one public backend ingress remains: host Nginx;
- Express listens on `127.0.0.1:3005` in production;
- direct public access to port `3005` is unavailable;
- Nginx proxies `api.infinite-track.tech` to loopback successfully;
- `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto` remain correctly forwarded;
- Express trusts loopback rather than a numeric hop count;
- real client IP and forwarded HTTPS protocol semantics are proven by tests;
- unconditional `Upgrade` and `Connection: upgrade` headers are absent;
- general API request bodies are explicitly limited to 1 MiB at Nginx and Express;
- the two face-upload paths receive a 25 MiB Nginx envelope while Multer retains the 20 MiB file limit;
- HTTP requests redirect to HTTPS after certificate bootstrap;
- final HTTPS/TLS behavior is represented by tracked repository configuration rather than Certbot mutation;
- certificate private keys remain outside Git;
- CORS remains owned by Express;
- `/livez` and `/health` still return from Express with existing semantics;
- `/docs` and `/docs/openapi.yaml` retain their existing Express authentication/authorization behavior;
- representative protected endpoints still reject anonymous callers;
- Web FE credentialed session/CORS smoke remains successful;
- representative Android API smoke remains successful;
- `nginx -t` passes on the target host;
- `npm run lint` passes;
- the full non-integration `npm test` suite passes;
- production smoke verification passes.

## Non-Goals

INF-278 does not:

- remove backend Nginx;
- move Nginx into Docker;
- replace `network_mode: host` with a new Docker-network architecture;
- migrate the backend to Kubernetes, App Platform, a load balancer, CDN, WAF, or service mesh;
- introduce API response caching;
- add WebSockets;
- redesign authentication, authorization, CORS, session, or rate-limit semantics;
- change API endpoint schemas or OpenAPI business contracts;
- change attendance, geofence, WFA, FAHP, report, or user-management semantics;
- change managed-MySQL topology;
- store TLS private keys or production secrets in Git;
- redesign Web FE infrastructure.
## Minimum Completion Evidence

The implementation PR must capture or reference evidence equivalent to:

```text
nginx -t: PASS
public :80 redirect to HTTPS: PASS
public :443 API ingress: PASS
direct public :3005 access: BLOCKED
Droplet listener 127.0.0.1:3005 only: PASS
/livez: PASS
/health: PASS
protected endpoint anonymous rejection: PASS
real client IP / forwarded protocol verification: PASS
Web FE login/session + CORS smoke: PASS
Android representative API smoke: PASS
request-body boundary tests: PASS
npm run lint: PASS
npm test: PASS
production smoke test: PASS
```

## Design Rationale

This design deliberately hardens the current architecture instead of replacing it. The earlier Docker bridge DNS problem already forced the production runtime onto host networking, so moving ingress into Docker would reopen unrelated runtime risk. Loopback binding gives the current topology a concrete process-level boundary while the external negative port check verifies the public effect.

Address-based proxy trust is preferred because the topology has a known trusted proxy source rather than an abstract hop count. Route-specific body envelopes preserve the legitimate 20 MiB face-upload capability without broadening every API route. Repository-managed final TLS configuration removes configuration drift while Certbot continues doing the job it is intended to do: certificate lifecycle.

The result is a bounded infrastructure change: transport ownership becomes explicit while application behavior remains in Express.
