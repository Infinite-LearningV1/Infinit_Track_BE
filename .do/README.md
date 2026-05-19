# DigitalOcean App Platform Backend Specs (Legacy)

## Overview

File `.do/app.yaml` dan `.do/app-production.yaml` disimpan sebagai artefak historical untuk backend App Platform; backend canonical saat ini bukan lagi App Platform dan file-file ini bukan deployment truth aktif.

Active backend deployment truth saat ini adalah:

- `.github/workflows/ci.yml` untuk validation gate
- `.github/workflows/docker-deploy.yml` untuk publish image ke DOCR
- droplet-hosted Docker Compose sebagai runtime aktif

Gunakan dokumen ini hanya jika jalur App Platform memang sengaja diaktifkan kembali dan diverifikasi ulang.

Canonical runtime backend saat ini adalah:

- DOCR image `registry.digitalocean.com/infinit-track/infinit-track-backend`
- droplet-hosted Docker Compose runtime
- host Nginx di depan container
- managed MySQL di belakang runtime

Gunakan workflow GitHub Actions droplet rollout sebagai source of truth operasional:

- `.github/workflows/deploy-staging.yml`
- `.github/workflows/deploy-production.yml`
- `deploy/scripts/verify-droplet-api.sh`
- `scripts/smoke-test.js`

Contoh env penting yang tetap harus konsisten dengan runtime canonical saat ini:

```env
GEOAPIFY_API_KEY=<your-geoapify-key>
```

## What This Folder Is For

- Menyimpan snapshot konfigurasi backend App Platform lama
- Membantu audit drift antara topologi lama vs runtime canonical saat ini
- Menjadi referensi historis bila perlu menelusuri konfigurasi environment lama

## What This Folder Is Not

Folder ini bukan panduan deploy backend aktif, bukan checklist verifikasi live host, dan bukan source of truth untuk host staging/production yang berjalan sekarang.

## Current Health Semantics

Walau spesifikasi App Platform ini legacy, kontrak health backend aktif tetap seperti berikut:

- `/livez` = process liveness
- `/health` = dependency readiness

Ready response contoh:

```json
{"status":"OK","ready":true,"components":{"database":"ready","scheduler":"ready"},"missing":[],"timestamp":"..."}
```

Not ready response contoh:

```json
{"status":"NOT_READY","ready":false,"components":{"database":"not_ready","scheduler":"ready"},"missing":["database"],"timestamp":"..."}
```

Artinya:

- `/health` mengembalikan HTTP `200` hanya saat dependency startup benar-benar siap
- `/health` mengembalikan HTTP `503` saat ada dependency belum siap
- payload readiness harus tetap memuat `"components"` dan `"missing"`
- operator harus memperhatikan `missing` array untuk menentukan blocker startup

## Migration Note

Jika suatu saat file `.do/app*.yaml` dipakai lagi untuk eksperimen, perlakukan itu sebagai jalur baru yang harus diverifikasi ulang terhadap:

- `CLAUDE.md`
- `README.md`
- workflow deploy aktif
- runtime evidence dari host canonical

Sampai ada bukti runtime yang berubah, droplet + DOCR tetap menjadi jalur deploy backend resmi.
