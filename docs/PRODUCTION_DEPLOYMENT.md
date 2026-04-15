# 🚀 Production Deployment Guide

## Overview

Panduan deployment backend untuk fase saat ini, dengan source of truth yang selaras ke target runtime aktif.

## Current Deployment Truth

Backend deployment truth for the current phase is:

- active runtime target = **Droplet + Docker Compose**
- image publication path = **DigitalOcean Container Registry (DOCR)**
- App Platform = **obsolete / historical path**
- Kubernetes = **optional / non-active path**

This document should not be used to justify new App Platform deployment work unless that direction is intentionally reactivated later.

## Current Deployment Model

### Phase 1: Publish image to DOCR
- GitHub Actions publishes backend image from branch `deploy`
- Registry: `registry.digitalocean.com/infinit-track`
- Repository: `infinit-track-backend`

### Phase 2: Runtime consumes exact SHA images on Droplet + Docker Compose
- Current runtime path remains droplet-based
- Docker Compose app runtime now consumes a DOCR image selected through `APP_IMAGE_TAG`
- Runtime source of truth is the exact published SHA image, not a host-side rebuild

## Runtime Image Selection Contract

The backend app service on the Droplet must run an exact DOCR image selected by:

- `APP_IMAGE_TAG=<sha>`

Runtime source of truth is the exact published SHA image, not a host-side rebuild.

## Host Registry Auth Prerequisite

Before pulling backend images from DOCR, the Droplet host must already be logged in to:

- `registry.digitalocean.com`

Recommended posture for this phase:
- host-level Docker login is present before deploy starts
- registry credentials are not stored in the repository
- runtime deploy procedure assumes valid host auth already exists

## Deploy Procedure

1. Choose the exact backend image SHA to deploy.
2. Set or update:
   - `APP_IMAGE_TAG=<sha>`
3. Pull the selected backend image:
   - `docker compose pull app`
4. Restart the backend app service:
   - `docker compose up -d app`
5. Verify runtime health and logs.

## Rollback Procedure

1. Choose the previous known-good SHA.
2. Set:
   - `APP_IMAGE_TAG=<old-sha>`
3. Pull the previous image:
   - `docker compose pull app`
4. Restart the backend app service:
   - `docker compose up -d app`
5. Re-run health and log verification.

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
- that GitHub Actions already deploys the runtime to the droplet
- that Docker Compose runtime already pulls prebuilt images from DOCR
- that Kubernetes is an active deployment path

## Deployment Readiness Checklist

### Before image publication
- [ ] CI validation is passing
- [ ] branch `deploy` contains the reviewed release artifact candidate
- [ ] Dockerfile still builds the backend correctly
- [ ] runtime contract changes are reviewed separately from image publication changes

### Before runtime deployment on Droplet
- [ ] droplet access is available
- [ ] Docker Compose configuration on the droplet is verified
- [ ] required runtime secrets are present on the droplet
- [ ] image tag to be deployed is explicitly chosen
- [ ] rollback path is known

## Verification Evidence

Minimum evidence expected for this phase:
- proof the selected SHA exists in DOCR
- output from `docker compose pull app`
- output from `docker compose up -d app`
- successful `/health` check after restart
- backend boot log + DB connectivity confirmation

## Notes for future follow-up
- If runtime later moves from `build:` to `image:`, update this document again instead of silently reusing old assumptions.
- If Kubernetes is intentionally reactivated, document that as a separate deployment truth decision.
- If any App Platform material is retained elsewhere, it should be marked historical to avoid misleading future operators.
