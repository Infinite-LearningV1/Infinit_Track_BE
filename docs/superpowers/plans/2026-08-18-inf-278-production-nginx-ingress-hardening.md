# INF-278 Production Nginx Ingress Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Droplet-hosted Express API reachable only through the canonical Nginx ingress while locking proxy trust, request-size, TLS, and runtime verification contracts.

**Architecture:** Keep Docker Compose `network_mode: host`, but bind production Express to `127.0.0.1:3005`. Express owns proxy interpretation, CORS, auth, health, and business behavior; tracked Nginx bootstrap/final vhosts own transport and TLS lifecycle, with a shared proxy snippet.

**Tech Stack:** Node.js ESM, Express, Jest, Docker Compose, Nginx, Bash, Certbot webroot renewal.

**Spec:** `docs/superpowers/specs/2026-08-17-inf-278-production-nginx-ingress-hardening-design.md`

## Global Constraints

- Production bind address is `127.0.0.1`; application port is `3005`.
- Production Express proxy trust is the explicit loopback contract `app.set('trust proxy', 'loopback')`.
- General JSON and URL-encoded bodies are limited to `1mb`; face uploads retain a `20 MiB` Multer file limit and receive a `25m` Nginx envelope.
- Nginx remains a thin ingress boundary and must not own auth, CORS, application rate limits, health responses, or business rules.
- Final HTTPS config must be tracked without certificate private keys; `nginx -t` is required before reload.
- Preserve `network_mode: host`, existing API paths, `/livez`, `/health`, and public API contracts.

---

### Task 1: Lock application runtime and proxy/body contracts

**Files:**
- Modify: `src/config/index.js`
- Modify: `src/app.js`
- Modify: `src/server.js`
- Modify: `docker-compose.yml`
- Modify: `deploy/env/backend.production.example`
- Test: `tests/inf278IngressRuntimeContract.test.js`

- [ ] Write tests that assert production defaults/rejects non-loopback `APP_BIND_HOST`, `config.bindHost`, production loopback trust, forwarded IP/protocol behavior, and 1 MiB parser behavior while preserving non-production defaults.
- [ ] Run the focused test and confirm it fails because the runtime contract is absent.
- [ ] Add `bindHost` resolution and production validation, set Express trust proxy to `loopback` only in production, reduce JSON/urlencoded limits to `1mb`, and pass `config.bindHost` to `app.listen`.
- [ ] Set `APP_BIND_HOST: 127.0.0.1` in the production Compose environment and template.
- [ ] Run the focused test and confirm it passes.

### Task 2: Make the Nginx source contract reproducible

**Files:**
- Rename: `deploy/nginx/api.infinite-track.tech.conf` → `deploy/nginx/api.infinite-track.tech.bootstrap.conf`
- Create: `deploy/nginx/api.infinite-track.tech.conf`
- Create: `deploy/nginx/snippets/infinite-track-api-proxy.conf`
- Test: `tests/inf278NginxContract.test.js`

- [ ] Write contract tests for bootstrap challenge handling, final HTTP→HTTPS redirect, TLS 1.2/1.3 directives, loopback proxy target, standard forwarded headers, body-size locations, and absence of unconditional upgrade headers.
- [ ] Run the focused test and confirm it fails against the current single HTTP-only vhost.
- [ ] Move shared proxy headers/timeouts into the snippet, remove `Upgrade` and `Connection: upgrade`, add global `1m` and the two `25m` face-upload locations, and add tracked bootstrap/final vhosts using Certbot-managed certificate paths without secrets.
- [ ] Run the focused test and confirm it passes.

### Task 3: Extend Droplet and external ingress verification

**Files:**
- Modify: `deploy/scripts/verify-droplet-api.sh`
- Create: `deploy/scripts/verify-public-ingress.sh`
- Modify: `tests/inf278DeploymentVerificationContract.test.js`

- [ ] Write tests for `nginx -t`, loopback listener inspection, local health checks, HTTP redirect, protected-route rejection, and external negative TCP/HTTP verification of public port `3005`.
- [ ] Run the focused test and confirm it fails because the new checks/scripts do not exist.
- [ ] Implement safe host-side checks that stop before reload on failed syntax validation and an externally runnable script that treats an unreachable public `3005` as success.
- [ ] Run the focused test and shell syntax checks.

### Task 4: Document deployment, renewal, and rollback ownership

**Files:**
- Create: `docs/PRODUCTION_NGINX_INGRESS.md`
- Modify: `docs/PRODUCTION_DEPLOYMENT.md`
- Modify: `docs/GITHUB_ACTIONS_SETUP.md`

- [ ] Document bootstrap installation, Certbot webroot/cert-only issuance, final vhost installation, renewal deploy hook reload, `nginx -t` gate, loopback binding/firewall expectations, external port-3005 check, and rollback to the last known-good vhost.
- [ ] Add the verifier commands and explicitly distinguish repository evidence from target-host and external production evidence.

### Task 5: Run full verification and review the diff

- [ ] Run focused INF-278 Jest tests.
- [ ] Run `npm run lint`.
- [ ] Run full non-integration `npm test`.
- [ ] Run `bash -n` for both verifier scripts and static Nginx contract checks; run `nginx -t` if Nginx is installed.
- [ ] Run `git diff --check`, inspect the final diff against every Linear acceptance criterion, and report unavailable production-only evidence separately.
