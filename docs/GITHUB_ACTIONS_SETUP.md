# 🔄 GitHub Actions Setup Guide

Production ingress verification uses the Droplet-side `deploy/scripts/verify-droplet-api.sh` and an external runner-side `deploy/scripts/verify-public-ingress.sh`. The external check must prove that the Droplet public IP cannot reach Express directly on TCP port `3005`; a successful response is a release blocker. Nginx syntax validation remains a required pre-reload gate.

## Overview

Guide untuk setup GitHub Actions backend sesuai source of truth saat ini:

- `.github/workflows/ci.yml` = validation gate (lint + test)
- `.github/workflows/docker-deploy.yml` = manual publish-only workflow for backend Docker image ke **DigitalOcean Container Registry (DOCR)**
- `.github/workflows/deploy-staging.yml` = active staging rollout workflow for **Droplet + Docker Compose**
- active backend runtime target = **Droplet + Docker Compose**
- App Platform = **historical / obsolete path**
- Kubernetes = **optional / non-active path**

## 🎯 Workflow Overview

### 1. CI Validation (`ci.yml`)
- **Trigger:** push + pull_request
- **Purpose:** lint and test backend code
- **Output:** verification signal only

### 2. DOCR Publish (`docker-deploy.yml`)
- **Trigger:** manual dispatch only
- **Purpose:** build backend Docker image and push it to DOCR
- **Output:** image tags in `registry.digitalocean.com/infinit-track/infinit-track-backend`
- **Guardrail:** publish is intentional and operator-triggered; the publish job validates `DIGITALOCEAN_ACCESS_TOKEN` before any DOCR login or image push step runs
- **Required secret:** `DIGITALOCEAN_ACCESS_TOKEN`

### 3. Staging droplet rollout (`deploy-staging.yml`)
- **Trigger:** push to `master`, pull request to `master`, and manual dispatch
- **Purpose:** run lint/test, publish the immutable image for non-PR events, then roll staging droplet forward via Docker Compose
- **Output:** real staging rollout, migration execution, remote health verification, and blocking smoke gate
- **PR behavior:** pull requests execute validation only; image publish and droplet rollout are skipped for `pull_request` events

### Current non-goals
- GitHub Actions in this repo does **not** deploy backend to App Platform.
- `docker-deploy.yml` publishes images only; it does not restart the droplet runtime by itself.

## Required Secrets

### Repository Secrets

1. `DIGITALOCEAN_ACCESS_TOKEN`
   - Used by: DOCR publish workflow, staging droplet rollout, and production droplet rollout
   - Needed for: `doctl registry login` and remote droplet `docker login`
2. `STAGING_SSH_PRIVATE_KEY`
   - Used by: staging droplet rollout
   - Needed for: SSH access from GitHub Actions into the staging droplet host
3. `PRODUCTION_SSH_PRIVATE_KEY`
   - Used by: production droplet rollout
   - Needed for: SSH access from GitHub Actions into the production droplet host

### GitHub Environment Variables

#### Staging environment variables
- `STAGING_SSH_HOST`
- `STAGING_SSH_USER`
- `STAGING_DEPLOY_PATH`
- `STAGING_PUBLIC_DOMAIN`
- `STAGING_PUBLIC_BASE_URL`
- `STAGING_EXPECTED_IP`

`deploy-staging.yml` validates all of the staging variables above before remote rollout starts.

#### Production environment variables
- `PRODUCTION_SSH_HOST`
- `PRODUCTION_SSH_USER`
- `PRODUCTION_DEPLOY_PATH`
- `PRODUCTION_PUBLIC_DOMAIN`
- `PRODUCTION_PUBLIC_BASE_URL`
- `PRODUCTION_EXPECTED_IP`

`deploy-production.yml` validates all of the production variables above before remote rollout starts.

### No longer active for backend deploy truth
These may still exist historically, but are not part of the active backend image publication path:

- `DO_APP_ID_STAGING`
- `DO_APP_ID_PRODUCTION`
- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `KUBECONFIG`

## Branch Contract

- `develop`: normal integration work
- `master`: final release-ready branch and image publication trigger

Current image publication workflow is manual-dispatch only, so the operator intentionally chooses the release-ready commit or branch to publish from.
