# Droplet DOCR Runtime Procedure

## Runtime source of truth
The staging droplet runs the backend from a DOCR image, not from a local compose build.

## Image contract
- Repository: `registry.digitalocean.com/infinit-track/infinit-track-backend`
- Runtime tag source: `BACKEND_IMAGE_TAG`
- `latest` is convenience only; the runtime should pin a SHA tag for actual deploys.

## Deploy procedure
1. Set the runtime tag:
   ```bash
   export BACKEND_IMAGE_TAG=<git-sha>
   ```
2. Authenticate Docker to DOCR on the droplet.
   - If `registry.digitalocean.com/infinit-track/infinit-track-backend` is private, authenticate before pulling.
   - Prerequisite: a DigitalOcean personal access token with Container Registry read access.
   - Direct Docker login:
     ```bash
     export DOCR_TOKEN=<digitalocean-pat-with-registry-read-access>
     echo "$DOCR_TOKEN" | docker login registry.digitalocean.com -u doctl --password-stdin
     ```
   - Or, if `doctl` is installed and already authenticated:
     ```bash
     doctl registry login
     ```
3. Pull the selected image:
   ```bash
   docker compose pull app
   ```
4. Restart the app service:
   ```bash
   docker compose up -d app
   ```
5. Verify:
   ```bash
   docker compose ps
   curl -fsS http://localhost:3000/health
   docker compose logs --tail=100 app
   ```

## Rollback procedure
1. Set `BACKEND_IMAGE_TAG` back to the last known good SHA.
2. Pull that image:
   ```bash
   docker compose pull app
   ```
3. Restart the app service:
   ```bash
   docker compose up -d app
   ```
4. Re-run health and log checks.
