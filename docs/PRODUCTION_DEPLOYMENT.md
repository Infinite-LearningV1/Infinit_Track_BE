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
- GitHub Actions publishes backend image from branch `master`
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
- that GitHub Actions already deploys the runtime to the droplet
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

## Verification Expectations

### Minimum verification for publish-only phase
- [ ] DOCR workflow pushes SHA tag successfully
- [ ] DOCR workflow pushes `latest` successfully
- [ ] image appears in `registry.digitalocean.com/infinit-track/infinit-track-backend`
- [ ] no runtime deployment is implied by the publish workflow summary

### Minimum verification for runtime pull phase
- [ ] droplet can authenticate to the registry
- [ ] Docker Compose can pull the selected image tag
- [ ] backend health endpoint returns success after compose restart
- [ ] logs confirm backend boot + DB connectivity

## Notes for future follow-up
- If runtime later changes again, update this document instead of silently reusing old assumptions.
- If Kubernetes is intentionally reactivated, document that as a separate deployment truth decision.
- If any App Platform material is retained elsewhere, it should be marked historical to avoid misleading future operators.
