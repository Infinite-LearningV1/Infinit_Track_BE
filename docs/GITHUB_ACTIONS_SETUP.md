# 🔄 GitHub Actions Setup Guide

## Overview

Guide untuk setup GitHub Actions backend sesuai source of truth saat ini:

- `.github/workflows/ci.yml` = validation gate (lint + test)
- `.github/workflows/docker-deploy.yml` = build and publish Docker image ke **DigitalOcean Container Registry (DOCR)**
- `.github/workflows/deploy-staging.yml` = manual-only historical marker, no active deploy
- active backend runtime target = **Droplet + Docker Compose**
- App Platform = **historical / obsolete path**
- Kubernetes = **optional / non-active path**

## 🎯 Workflow Overview

### 1. CI Validation (`ci.yml`)
- **Trigger:** push + pull_request
- **Purpose:** lint and test backend code
- **Output:** verification signal only

### 2. DOCR Publish (`docker-deploy.yml`)
- **Trigger:** push to `master` branch + manual dispatch
- **Purpose:** build backend Docker image and push it to DOCR
- **Output:** image tags in `registry.digitalocean.com/infinit-track/infinit-track-backend`
- **Guardrail:** manual dispatch is still enforced to publish only from branch `master`
- **Required secret:** `DIGITALOCEAN_ACCESS_TOKEN`; the workflow fails fast with an explicit message when it is missing

### 3. Historical App Platform marker (`deploy-staging.yml`)
- **Trigger:** manual dispatch only
- **Purpose:** document that App Platform deployment is not the active backend path
- **Output:** summary only; no `doctl apps create-deployment` call is made

### Current non-goals
- GitHub Actions does **not** deploy backend runtime directly to the droplet yet.
- Runtime deployment remains a separate operational step after image publication.

## Required Secrets

### Repository Secrets

1. `DIGITALOCEAN_ACCESS_TOKEN`
   - Used by: DOCR publish workflow
   - Needed for: `doctl registry login`

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

Current image publication workflow is intentionally bound to `master` so the release branch is the same branch that produces the published artifact.
