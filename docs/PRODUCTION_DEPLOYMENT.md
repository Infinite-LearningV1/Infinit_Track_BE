# 🚀 Production Deployment Guide

For the canonical Nginx ingress, certificate lifecycle, loopback listener, and external port-3005 verification contract, see [PRODUCTION_NGINX_INGRESS.md](PRODUCTION_NGINX_INGRESS.md). Production deployment must run `nginx -t` before reload and must not rely on Certbot mutating the tracked application vhost.

## Overview

Panduan deployment backend untuk fase saat ini, dengan source of truth yang selaras ke target runtime aktif.

## Current Deployment Truth

Backend deployment truth for the current phase is:

- active runtime target = **Droplet + Docker Compose**
- image publication path = **DigitalOcean Container Registry (DOCR)**
- App Platform = **obsolete / historical path**
- Kubernetes = **optional / non-active path**

This document should not be used to justify new App Platform deployment work unless that direction is intentionally reactivated later.

## Official Release Path

The backend uses a single official release path:

`develop -> review -> master -> deploy`

- `develop` is the integration and review surface.
- `master` is the release branch.
- staging deploy is automatic from `master`.
- production deploy is automatic from `master`.
- all required evidence is green before merge into `master`.

Before `develop -> master` promotion:
- run the promotion checklist MVP
- require status-code proof for all endpoints represented in `docs/openapi.yaml`
- block promotion if any endpoint lacks proof
- review the Claude verdict
- operator approves or rejects promotion

If the checklist passes and the operator approves, promotion to `master` may proceed and existing automation may run.

## Master GitHub Gate

GitHub enforces PR review + `build` for `master`.
In this repository, `build` means install + lint + test.

runtime/smoke verification is still an operational verification concern, not an enforced GitHub merge gate today.

## Current Deployment Model

### Phase 1: Publish image to DOCR
- `docker-deploy.yml` is a manual publish-only workflow
- `deploy-staging.yml` also builds and pushes the immutable image as part of staging rollout for non-PR events
- Registry: `registry.digitalocean.com/infinit-track`
- Repository: `infinit-track-backend`
- Published tags: immutable SHA tag + rolling `latest`

### Phase 2: Runtime remains on Droplet + Docker Compose
- Current runtime path is droplet-based
- Docker Compose runtime is image-based and should pull the selected DOCR tag
- Runtime deploy should pin a SHA tag explicitly via `BACKEND_IMAGE_TAG`

## Obsolete Historical Guidance

Any older references in this repository to:
- DigitalOcean App Platform app IDs
- `.do/app.yaml`
- `.do/app-production.yaml`
- `doctl apps create-deployment`

should be interpreted as historical artifacts unless explicitly reactivated.
They are not part of the supported active backend deploy path and should be treated as retained-for-history material or future cleanup candidates, not runtime instructions.

## Phase Boundaries

### What this document covers now
- image publication truth
- active runtime target truth
- boundary between artifact publishing and runtime deployment

### What this document does not claim
- that the publish-only workflow (`docker-deploy.yml`) deploys the runtime to the droplet by itself
- that automatic production rollout removes the required review and evidence gate before merge into `master`
- that Kubernetes is an active deployment path

## Deployment Readiness Checklist

### Before image publication
- [ ] CI validation is passing
- [ ] branch `master` contains the reviewed release artifact candidate
- [ ] Dockerfile still builds the backend correctly
- [ ] runtime contract changes are reviewed separately from image publication changes

### Before runtime deployment on Droplet
- [ ] droplet access is available
- [ ] Docker Compose configuration on the droplet is verified
- [ ] required runtime secrets are present on the droplet
- [ ] image tag to be deployed is explicitly chosen
- [ ] rollback path is known

## Web-Origin and Runtime Artifact Contract

Each environment has an independent expected Web origin (Web-origin input). The deployment compares that value with the running backend container's `CORS_ORIGIN` before claiming Web FE compatibility.

The workflow synchronizes the tracked runtime artifacts from the release commit: `docker-compose.yml` and `deploy/scripts/verify-droplet-api.sh`. Host-local env/secrets remain untracked and are never copied from Git.

Staging and production are separate workflows triggered from `master`; repository YAML does not enforce staging-before-production ordering. GitHub environment/ruleset protection is external operational evidence and must be inspected separately.

## Verification Expectations

### Minimum verification for publish-only phase
- [ ] `docker-deploy.yml` pushes SHA tag successfully when manually dispatched
- [ ] `docker-deploy.yml` pushes `latest` successfully when manually dispatched
- [ ] image appears in `registry.digitalocean.com/infinit-track/infinit-track-backend`
- [ ] publish-only workflow summary does not imply a droplet restart
- [ ] no App Platform deployment workflow is treated as active backend runtime truth

### Minimum verification for runtime pull phase
- [ ] droplet can authenticate to the registry
- [ ] Docker Compose can pull the selected image tag
- [ ] backend health endpoint returns success after compose restart
- [ ] logs confirm backend boot + DB connectivity

## Notes for future follow-up
- If runtime later changes again, update this document instead of silently reusing old assumptions.
- If Kubernetes is intentionally reactivated, document that as a separate deployment truth decision.
- If any App Platform material is retained elsewhere, it should be marked historical to avoid misleading future operators.
