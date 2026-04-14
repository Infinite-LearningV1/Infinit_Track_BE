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

### Phase 2: Runtime remains on Droplet + Docker Compose
- Current runtime path is still droplet-based
- Docker Compose runtime has not yet been switched from `build:` to `image:` in this phase
- Any future move to image-pull runtime should be treated as a separate tracked change

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

## Verification Expectations

### Minimum verification for publish-only phase
- [ ] DOCR workflow pushes SHA tag successfully
- [ ] DOCR workflow pushes `deploy-latest` successfully
- [ ] image appears in `registry.digitalocean.com/infinit-track/infinit-track-backend`
- [ ] no runtime deployment is implied by the publish workflow summary

### Minimum verification for future runtime pull phase
- [ ] droplet can authenticate to the registry
- [ ] Docker Compose can pull the selected image tag
- [ ] backend health endpoint returns success after compose restart
- [ ] logs confirm backend boot + DB connectivity

## Notes for future follow-up
- If runtime later moves from `build:` to `image:`, update this document again instead of silently reusing old assumptions.
- If Kubernetes is intentionally reactivated, document that as a separate deployment truth decision.
- If any App Platform material is retained elsewhere, it should be marked historical to avoid misleading future operators.
