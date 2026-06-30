# Droplet DOCR Runtime Procedure

## Runtime source of truth
Backend canonical runtime berjalan dari image DOCR yang dipull oleh Docker Compose di droplet, dengan host Nginx di depan container dan managed MySQL di belakang runtime.

Compose file adalah bagian dari image-based runtime procedure. Local host-run development tetap mengikuti workflow native MySQL di `README.md` / `CLAUDE.md`, jadi compose runtime ini bukan pengganti host-published local development setup.

## Image contract
- Repository: `registry.digitalocean.com/infinit-track/infinit-track-backend`
- Runtime tag source: `BACKEND_IMAGE_TAG`
- Default compose image should resolve to the DOCR repository above unless an operator intentionally overrides `BACKEND_IMAGE` for a local/manual scenario.
- `BACKEND_IMAGE_TAG` wajib di-set ke SHA image immutable sebelum runtime pull/recreate dijalankan.
- `latest` hanya convenience untuk publication/discovery, bukan fallback runtime deploy.

## Health contract
- `/livez` = process liveness
- `/health` = dependency readiness
- Runtime container listen di `127.0.0.1:3005`

Ready response contoh:

```json
{"status":"OK","ready":true,"components":{"database":"ready","scheduler":"ready"},"missing":[],"timestamp":"..."}
```

Not ready response contoh:

```json
{"status":"NOT_READY","ready":false,"components":{"database":"not_ready","scheduler":"ready"},"missing":["database"],"timestamp":"..."}
```

## Deploy procedure
1. Set runtime tag ke SHA image yang akan dirilis:
   ```bash
   export BACKEND_IMAGE_TAG=<git-sha>
   ```
2. Authenticate Docker ke DOCR di droplet.
   - Jika `registry.digitalocean.com/infinit-track/infinit-track-backend` private, login dulu sebelum pull.
   - Prerequisite: DigitalOcean personal access token dengan Container Registry read access.
   - Direct Docker login:
     ```bash
     export DOCR_TOKEN=<digitalocean-pat-with-registry-read-access>
     echo "$DOCR_TOKEN" | docker login registry.digitalocean.com -u doctl --password-stdin
     ```
   - Atau, jika `doctl` sudah terpasang dan terautentikasi:
     ```bash
     doctl registry login
     ```
3. Pull image yang dipilih:
   ```bash
   docker compose pull app
   ```
4. Recreate service app dengan image baru:
   ```bash
   docker compose up -d --force-recreate app
   ```
5. Jalankan migrasi runtime:
   ```bash
   docker compose exec -T app npm run migrate
   ```
6. Verifikasi local runtime, public runtime, dan DNS/IP expectation:
   ```bash
   DOMAIN=<public-domain> EXPECTED_IP=<droplet-ip> ./deploy/scripts/verify-droplet-api.sh
   ```
7. Verifikasi smoke/readiness gate aplikasi:
   ```bash
   npm run smoke-test https://<public-domain>
   ```
8. Cek state container dan migration status jika perlu:
   ```bash
   docker compose ps app
   docker compose exec -T app npm run migrate:status
   docker compose logs --tail=100 app
   ```

## Manual spot checks
```bash
curl -fsS http://127.0.0.1:3005/livez
curl -fsS http://127.0.0.1:3005/health
curl -fsS https://<public-domain>/livez
curl -fsS https://<public-domain>/health
```

## Rollback procedure
1. Set `BACKEND_IMAGE_TAG` kembali ke SHA terakhir yang diketahui sehat.
2. Pull image tersebut:
   ```bash
   docker compose pull app
   ```
3. Recreate service app:
   ```bash
   docker compose up -d --force-recreate app
   ```
4. Jika rollback membutuhkan schema yang sesuai, verifikasi migration state.
5. Ulangi verification gate:
   ```bash
   DOMAIN=<public-domain> EXPECTED_IP=<droplet-ip> ./deploy/scripts/verify-droplet-api.sh
   npm run smoke-test https://<public-domain>
   ```
