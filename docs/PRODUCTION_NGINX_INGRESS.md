# Production Nginx ingress contract

The production topology has one public backend ingress:

```text
HTTPS api.infinite-track.tech -> host Nginx -> 127.0.0.1:3005 -> Express
```

Express is bound to `127.0.0.1:3005` in production. Docker Compose intentionally keeps host networking for the canonical Droplet runtime, but the application listener must not bind to the Droplet's public interfaces. The DigitalOcean firewall must not expose inbound TCP `3005`; only the intended Nginx ports are public.

## Bootstrap and certificate lifecycle

1. Install the shared proxy snippet and bootstrap vhost:
   ```bash
   sudo install -D -m 0644 deploy/nginx/snippets/infinite-track-api-proxy.conf \
     /etc/nginx/snippets/infinite-track-api-proxy.conf
   sudo install -D -m 0644 deploy/nginx/api.infinite-track.tech.bootstrap.conf \
     /etc/nginx/sites-available/api.infinite-track.tech.conf
   sudo ln -sfn /etc/nginx/sites-available/api.infinite-track.tech.conf \
     /etc/nginx/sites-enabled/api.infinite-track.tech.conf
   ```
2. Create `/var/www/certbot` and ensure `/.well-known/acme-challenge/` is reachable over HTTP.
3. Obtain or renew the certificate with Certbot webroot/cert-only mode.
4. Install `deploy/nginx/api.infinite-track.tech.conf` as the canonical vhost at the same `sites-available` path.
5. Confirm the certificate files exist under `/etc/letsencrypt/live/api.infinite-track.tech/`.
6. Run `sudo nginx -t`; stop if it fails.
7. Reload Nginx only after syntax validation succeeds: `sudo systemctl reload nginx`.

The final vhost keeps the ACME challenge on port 80 and redirects all other HTTP requests to the equivalent HTTPS URL. It supports TLS 1.2 and TLS 1.3. Certificate private keys and the `/etc/letsencrypt` directory remain host-managed and are never committed.

Configure a Certbot deploy hook (or equivalent system-managed renewal hook) to run `nginx -t && systemctl reload nginx` after successful renewal. Certbot must not mutate the tracked application vhost.

## Verification

On the Droplet:

```bash
DOMAIN=api.infinite-track.tech EXPECTED_IP=<droplet-ip> \
  bash deploy/scripts/verify-droplet-api.sh
```

This proves Nginx syntax, local `/livez` and `/health`, the loopback-only `3005` listener, public HTTPS health, protected-route rejection, and the authenticated surface boundaries.

From an external runner:

```bash
PUBLIC_IP=<droplet-ip> bash deploy/scripts/verify-public-ingress.sh
```

The direct `http://<droplet-ip>:3005/livez` request must fail. A successful response is a release blocker. Public port 80 redirect, port 443 API ingress, Web FE credentialed CORS/session smoke, Android representative API smoke, and the existing production smoke pack remain separate external evidence gates.

## Rollback

If `nginx -t` fails, do not reload. If public HTTPS fails after a valid reload, restore the previous known-good vhost, run `nginx -t`, and reload only after it passes. Certificate rollback selects an existing valid Certbot lineage on the host; it never copies private keys into Git.

Nginx remains a transport boundary. Express owns CORS, JWT/session authentication, authorization, rate limits, validation, business errors, `/livez`, `/health`, `/docs`, `/docs/openapi.yaml`, and all `/api/*` semantics.
