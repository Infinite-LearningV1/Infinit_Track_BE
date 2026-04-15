# 🔄 GitHub Actions Setup Guide

## Overview

Guide untuk setup GitHub Actions backend sesuai source of truth saat ini:

- `.github/workflows/ci.yml` = validation gate (lint + test)
- `.github/workflows/docker-deploy.yml` = build and publish Docker image ke **DigitalOcean Container Registry (DOCR)**
- active backend runtime target = **Droplet + Docker Compose**
- App Platform = **historical / obsolete path**
- Kubernetes = **optional / non-active path**

## 🎯 Workflow Overview

### 1. CI Validation (`ci.yml`)
- **Trigger:** push + pull_request
- **Purpose:** lint and test backend code
- **Output:** verification signal only

### 2. DOCR Publish (`docker-deploy.yml`)
- **Trigger:** push to `deploy` branch + manual dispatch
- **Purpose:** build backend Docker image and push it to DOCR
- **Output:** image tags in `registry.digitalocean.com/infinit-track/infinit-track-backend`
- **Guardrail:** manual dispatch is still enforced to publish only from branch `deploy`

### Current non-goals
- GitHub Actions does **not** deploy backend runtime directly to the droplet yet.
- Docker Compose on the droplet still uses the current build-based path until runtime contract is switched intentionally.

## Required Secrets

### Repository Secrets

1. `DIGITALOCEAN_ACCESS_TOKEN`
   - Used by: DOCR publish workflow
   - Needed for: `doctl registries login`

### No longer active for backend deploy truth
These may still exist historically, but are not part of the active backend image publication path:

- `DO_APP_ID_STAGING`
- `DO_APP_ID_PRODUCTION`
- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `KUBECONFIG`

## Branch Contract

- `develop`: normal integration work
- `master`: final release-ready branch
- `deploy`: image publication branch for DOCR review/testing

Current image publication workflow is intentionally bound to `deploy` so release artifacts can be reviewed without coupling normal development pushes to image publication.

## Publication-to-Runtime Handoff

Current artifact flow is:

1. Branch `deploy` publishes backend images to DOCR
2. Runtime deployment on the Droplet selects an exact SHA using:
   - `APP_IMAGE_TAG=<sha>`
3. Docker Compose pulls and runs that exact image

Important:
- `deploy-latest` is a convenience publication tag
- runtime source of truth should remain the exact SHA tag
- the publish workflow does not deploy to the Droplet automatically
