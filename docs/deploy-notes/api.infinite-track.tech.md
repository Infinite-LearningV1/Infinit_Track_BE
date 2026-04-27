# api.infinite-track.tech Deploy Notes

Date: 2026-04-27

## Target

Backend base URL: https://api.infinite-track.tech  
Droplet: it-backend-staging-sgp1 / 168.144.33.33  
Runtime: Docker container behind host Nginx  
Database: DigitalOcean managed MySQL cluster it-mysql-staging-sgp1

## Verification Evidence

DNS verification:

```text
A record: api.infinite-track.tech -> 168.144.33.33
DigitalOcean domain record present for host `api`
verify-droplet-api.sh:
Resolved IPv4: 168.144.33.33
DNS_OK
```

Container verification:

```text
NAMES               STATUS                       PORTS
infinit-track-app   Up About an hour (healthy)
```

Internal health verification:

```text
curl http://127.0.0.1:3005/health
{"status":"OK","timestamp":"2026-04-27T12:15:48.209Z"}
```

Nginx verification:

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
HTTP redirect:
HTTP/1.1 301 Moved Permanently
Location: https://api.infinite-track.tech/health
```

Public HTTPS health verification:

```text
curl https://api.infinite-track.tech/health
{"status":"OK","timestamp":"2026-04-27T10:15:55.953Z"}
```

Non-health endpoint verification:

```text
curl --include https://api.infinite-track.tech/api
HTTP/1.1 404 Not Found
{"message":"Route not found"}
```

Database connectivity verification:

```text
DNS_OK 10.104.0.3 4
TCP_OK private-it-mysql-staging-sgp1-do-user-35565539-0.i.db.ondigitalocean.com 25060
MYSQL_OK [{"ok":1}]
```

Verification script result:

```text
DNS_OK
LOCAL_HEALTH_OK
NGINX_CONFIG_OK
PUBLIC_HEALTH_OK
```

## Runtime Notes

- Droplet-side Docker bridge DNS could not reliably resolve external or private hostnames.
- As a deployment workaround, the running container uses `network_mode: host` on the droplet.
- The active container inspect result reported:

```text
host
```

- Managed MySQL connectivity succeeded only after setting:

```text
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
```

This is a staging workaround for DigitalOcean managed MySQL TLS chain handling inside the current image/runtime.

## Migration Status

Baseline bootstrap result:

```text
Imported /opt/infinite-track/backend/v1_infinite_track.sql into defaultdb
Session override used during import:
SET SESSION sql_require_primary_key=0
```

Final migration status:

```text
up 20240525120000-create-user.cjs
up 20240619000000-update-photos-for-cloudinary.cjs
up 20260403000000-add-unique-constraint-attendance.cjs
up 20260422000000-add-photo-storage-metadata.cjs
up 20260423010000-add-attendance-date-index.cjs
up 20260424000000-bootstrap-operational-settings.cjs
```

Migration root-cause summary:

```text
1. Managed MySQL target was initially empty except SequelizeMeta.
2. Deploy source had to be normalized to CommonJS migration artifacts (.cjs, no export default).
3. Baseline SQL import needed a session-level sql_require_primary_key=0 override because the dump adds some primary keys later via ALTER TABLE.
```

## Risk Notes

1. **Service availability:** SUCCESS — public HTTPS base URL is online and `/health` is healthy.
2. **Database connectivity:** SUCCESS — MySQL DNS/TCP/query path is proven.
3. **Schema convergence:** SUCCESS — baseline import completed and all tracked migrations are now `up`.
4. **Docker runtime design drift:** NEEDS FOLLOW-UP — deployment currently relies on `network_mode: host` as a workaround for Docker bridge DNS failure on the droplet.
5. **TLS hardening:** NEEDS FOLLOW-UP — `DB_SSL_REJECT_UNAUTHORIZED=false` is a temporary staging compromise; proper CA trust should replace this.
6. **Baseline import method:** NEEDS DOCUMENTATION — this staging bootstrap used `v1_infinite_track.sql` plus a session-level `sql_require_primary_key=0` override; this should be documented as an explicit bootstrap path or replaced with a formal bootstrap migration.
7. **Secret rotation:** REQUIRED FOLLOW-UP — secrets exposed earlier in session/chat should be rotated after deployment stabilization.

## Docs / ADR Update Note

This deployment introduced two architecture-significant operational deviations that should be documented before production promotion:

- Docker runtime on droplet currently depends on `network_mode: host` due to Docker bridge DNS failure.
- Managed MySQL TLS verification is temporarily relaxed with `DB_SSL_REJECT_UNAUTHORIZED=false`.
