# Infinite Track - Backend API

Selamat datang di repositori backend untuk **Infinite Track**, sebuah **Platform Manajemen Kehadiran Cerdas** yang dirancang untuk mendukung lingkungan kerja modern yang fleksibel.

## 1. Ringkasan Proyek

**Infinite Track** adalah sistem presensi berbasis Node.js & Express yang menggantikan metode absensi konvensional. Tujuannya adalah untuk meningkatkan efisiensi, fleksibilitas, dan akurasi data kehadiran di lingkungan kerja seperti Infinite Learning. Keunikan utama proyek ini terletak pada implementasi **Fuzzy AHP (FAHP) murni** untuk memberikan penilaian dan rekomendasi yang cerdas serta dapat dipertanggungjawabkan.

### 🎯 **Visi & Misi**

- **Visi:** Menciptakan ekosistem kerja yang aman, fleksibel, dan cerdas
- **Misi:** Memberikan insights berbasis data untuk meningkatkan produktivitas dan kepuasan karyawan

## 2. Fitur Unggulan

Sistem ini memiliki empat pilar fungsionalitas utama yang membuatnya lebih dari sekadar aplikasi presensi biasa:

### **🏢 1. Presensi Multi-Mode & Aman**

- Mendukung mode kerja **WFO, WFH, dan WFA** secara penuh.
- Menggunakan validasi berlapis dengan **Geofencing** untuk lokasi dan **Face Recognition** untuk identitas, memastikan setiap absensi akurat dan terpercaya.
- **Timezone Consistency:** Semua operasi waktu menggunakan WIB (Jakarta, UTC+7) untuk akurasi data.
- **Real-time Status Tracking:** API yang optimized untuk mobile integration.

### **🧠 2. Sistem Rekomendasi & Skor Lokasi WFA**

- Merekomendasikan lokasi WFA di sekitar pengguna.
- Setiap lokasi dinilai oleh **FAHP murni** untuk menghasilkan **Skor Kelayakan**.
- **Suitability Labels:** 4 tingkat (Rendah, Cukup, Baik, Sangat Baik) dengan ambang interval sama 0–25–50–75.
- **Multi-criteria Analysis (default):** Location type, Distance, Amenities.

### **⚡ 3. Proses Otomatis Malam Hari (Cron Jobs)**

- **Auto Alpha:** Menandai pengguna yang tidak hadir tanpa keterangan.
- **Missed Checkout Flag:** Menandai sesi yang melewati jam pulang + toleransi tanpa checkout (tanpa prediksi fuzzy).
- **WFA Resolution:** Memproses booking WFA yang disetujui.
- **Manual Trigger API:** Admin dapat memicu jobs secara manual.
- **Research Attendance Trigger API:** Admin/Management dapat membangun atau menerapkan research attendance plan operator-only melalui `/api/attendance/research-trigger/daily` dan `/api/attendance/research-trigger/full-day`, dengan default `dry_run=true` dan feature flag `RESEARCH_ATTENDANCE_TRIGGER_ENABLED=false`.

### **📊 4. Dashboard Analitik dengan Indeks Kedisiplinan**

- Menyediakan laporan kehadiran yang komprehensif untuk manajemen.
- Menghasilkan **Indeks Kedisiplinan** 0–100 menggunakan **FAHP murni**.

## 3. Tumpukan Teknologi (Tech Stack)

### **🏗️ Core Technologies**

- **Runtime:** Node.js (ESM modules)
- **Framework:** Express.js
- **Database:** MySQL/MariaDB
- **ORM:** Sequelize
- **Authentication:** JWT + RBAC

### **🧠 Decision Engine**

- **FAHP (Pure):** TFN pairwise → synthetic extent → degree of possibility → minimum possibility → normalized crisp weights (∑w=1)
- **Consistency Check:** CR dihitung dari matriks TFN yang didefuzzifikasi (eigenvalue approximation)

### **☁️ External Services**

- **Cloudinary** (media), **Geoapify** (places), **Winston** (logging)

### **🛠️ Development Tools**

- **Swagger/OpenAPI**, **ESLint + Prettier**, **Docker Compose**

## 4. Panduan Setup & Instalasi

Berikut adalah langkah-langkah untuk menjalankan proyek ini di lingkungan development:

### **📥 4.1 Clone & Install**

```bash
# Clone repositori
git clone <url_repositori_anda>
cd infinite-track-backend

# Install dependensi
npm install
```

### **⚙️ 4.2 Konfigurasi Environment**

```bash
# Salin template environment
cp .env.example .env
```

Isi semua variabel yang dibutuhkan di dalam `.env`:

```env
# Server Configuration
NODE_ENV=development
PORT=3005

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_NAME=v1_infinite_track
DB_USER=your_db_user
DB_PASS=your_db_password
DB_SSL=false
DB_SSL_REJECT_UNAUTHORIZED=true

# JWT Configuration
JWT_SECRET=your_super_secure_jwt_secret_minimum_256_characters_long

# External Services
CLOUDINARY_CLOUD_NAME=your_cloudinary_name
CLOUDINARY_API_KEY=your_cloudinary_key
CLOUDINARY_API_SECRET=your_cloudinary_secret
GEOAPIFY_API_KEY=your_geoapify_api_key

# Optional: Logging & Monitoring
LOG_LEVEL=info
```

### **🗄️ 4.3 Setup Database**

Pastikan MySQL/MariaDB sudah berjalan, lalu siapkan database lokal dari terminal dengan urutan berikut:

```bash
# Buat database baru lewat terminal menggunakan MySQL/MariaDB client
mysql -u your_db_user -p -e "CREATE DATABASE v1_infinite_track;"

# Import baseline schema terlebih dahulu
mysql -u your_db_user -p v1_infinite_track < v1_infinite_track.sql

# Jalankan migrasi incremental setelah baseline schema tersedia
npm run migrate

# (Opsional) Isi data awal dengan seeder
npm run seed
```

> **Catatan:** Untuk database lokal yang benar-benar kosong, jalur bootstrap yang saat ini tervalidasi adalah import `v1_infinite_track.sql` terlebih dahulu, lalu jalankan `npm run migrate`, karena migrasi bersifat incremental dan mengasumsikan tabel inti seperti `attendance` sudah ada.

### **🚀 4.4 Jalankan Server**

```bash
# Development mode (dengan hot reload)
npm run dev

# Production mode
npm start

# Local Docker Compose runtime verification
bash ./test-production.sh --local-base-url http://127.0.0.1:3005 --public-base-url http://127.0.0.1:3005
```

Server akan berjalan di `http://localhost:3005` (atau port yang ditentukan di `.env`).

Endpoint health memiliki dua fungsi berbeda:

- `GET /livez` memverifikasi proses backend masih hidup.
- `GET /health` memverifikasi dependency startup sudah siap, terutama database dan scheduler.
- Backend masih dapat start tetapi mengembalikan HTTP `503` dari `/health` jika database atau scheduler belum siap.

> **Catatan Docker Desktop Windows:** `docker-compose.yml` repo ini menggunakan `network_mode: host`. Pada Docker Desktop Windows, aktifkan **Enable host networking** di **Docker Desktop Settings → Resources → Network** sebelum `http://127.0.0.1:3005` dapat diakses dari host. Jika dependency seperti container MySQL manual dijalankan di luar Compose, dependency tersebut mungkin perlu dijalankan ulang setelah Docker Desktop restart.

### **✅ 4.5 Verifikasi Setup**

```bash
# Liveness check: proses backend hidup
curl http://localhost:3005/livez

# Readiness check: database dan scheduler siap
curl http://localhost:3005/health

# Swagger UI (requires authenticated Admin/Management session)
open http://localhost:3005/docs

# Raw OpenAPI contract (requires authenticated Admin/Management token)
curl -H "Authorization: Bearer <admin_or_management_token>" http://localhost:3005/docs/openapi.yaml
```

Respons `/health` yang sehat mengembalikan `ready: true`, `components.database: "ready"`, dan `components.scheduler: "ready"`.

## 5. Dokumentasi API (Endpoint Utama)

Dokumentasi API interaktif tersedia melalui **Swagger UI**, tetapi route `/docs` dan `/docs/openapi.yaml`
bersifat internal-only dan memerlukan sesi `Admin` atau `Management` yang terautentikasi.

### **📋 5.1 Endpoint Overview**

| Method                       | Path                              | Deskripsi Singkat                                     | Otorisasi        |
| :--------------------------- | :-------------------------------- | :---------------------------------------------------- | :--------------- |
| **🔐 Authentication**        |
| `POST`                       | `/api/auth/login`                 | Login pengguna dan mendapatkan token                  | Publik           |
| `POST`                       | `/api/auth/logout`                | Logout dan menghapus sesi                             | Pengguna         |
| `GET`                        | `/api/auth/me`                    | Mendapatkan data profil pengguna yang sedang login    | Pengguna         |
| **⏰ Attendance Management** |
| `GET`                        | `/api/attendance/status-today`    | Status absensi terkini (source of truth untuk UI)     | Pengguna         |
| `POST`                       | `/api/attendance/check-in`        | Melakukan proses check-in dengan geofencing           | Pengguna         |
| `POST`                       | `/api/attendance/checkout/:id`    | Melakukan proses check-out manual                     | Pengguna         |
| `GET`                        | `/api/attendance/history`         | Riwayat kehadiran dengan filtering dan pagination     | Pengguna         |
| `POST`                       | `/api/attendance/location-event`  | Log events geofence (ENTER/EXIT)                      | Pengguna         |
| **🌍 WFA Booking System**    |
| `POST`                       | `/api/bookings`                   | Mengajukan booking lokasi WFA baru                    | Pengguna         |
| `GET`                        | `/api/bookings/history`           | **[NEW]** Riwayat booking dengan advanced filtering   | Pengguna         |
| `PATCH`                      | `/api/bookings/:id`               | Update status booking (approve/reject)                | Admin/Management |
| `DELETE`                     | `/api/bookings/:id`               | Hapus booking (admin only)                            | Admin            |
| **🧠 WFA Intelligence**      |
| `GET`                        | `/api/wfa/recommendations`        | Rekomendasi lokasi WFA dengan Fuzzy AHP               | Pengguna         |
| `GET`                        | `/api/wfa/ahp-config`             | Konfigurasi algoritma AHP                             | Admin            |
| **📊 Analytics & Reports**   |
| `GET`                        | `/api/summary`                    | **[ENHANCED]** Laporan komprehensif + Indeks Disiplin | Admin/Management |
| `GET`                        | `/api/discipline/user/:id`        | Indeks kedisiplinan individual                        | Admin/Management |
| `GET`                        | `/api/discipline/all`             | Overview disiplin semua karyawan                      | Admin            |
| `GET`                        | `/api/analysis/fuzzy-ahp`         | Analisis bobot fuzzy AHP                              | Admin/Management |
| **⚙️ Operational Settings**  |
| `GET`                        | `/api/settings/operational`       | Membaca konfigurasi operasional aplikasi              | Admin/Management |
| `PATCH`                      | `/api/settings/operational`       | Mengubah konfigurasi operasional aplikasi             | Admin/Management |
| **👥 User Management**       |
| `GET`                        | `/api/users`                      | Mengelola semua pengguna (CRUD)                       | Admin            |
| `POST`                       | `/api/users`                      | Buat user baru                                        | Admin            |
| `PATCH`                      | `/api/users/:id`                  | Update data user                                      | Admin            |
| `DELETE`                     | `/api/users/:id`                  | Hapus user                                            | Admin            |
| **📋 Reference Data**        |
| `GET`                        | `/api/roles`                      | Daftar semua roles                                    | Admin/Management |
| `GET`                        | `/api/programs`                   | Daftar semua program                                  | Admin/Management |
| `GET`                        | `/api/positions`                  | Daftar semua positions                                | Admin/Management |
| `GET`                        | `/api/divisions`                  | Daftar semua divisions                                | Admin/Management |

### **🎯 5.2 Featured Endpoints**

#### **New Booking History API**

```bash
# Advanced filtering dengan pagination dan sorting
GET /api/bookings/history?status=approved&sort_by=schedule_date&sort_order=DESC&page=1&limit=10

# Response includes suitability scoring
{
  "success": true,
  "data": {
    "bookings": [
      {
        "booking_id": 123,
        "schedule_date": "2025-07-15",
        "status": "approved",
        "suitability_score": 87.5,
        "suitability_label": "Sangat Baik",
        "location": {
          "description": "Starbucks Mall Panakkukang",
          "latitude": -5.1477,
          "longitude": 119.4327
        }
      }
    ],
    "pagination": {
      "current_page": 1,
      "total_pages": 5,
      "total_items": 48
    }
  }
}
```

#### **Enhanced Summary with Discipline Index**

```bash
# Comprehensive analytics dengan real-time discipline calculation
GET /api/summary?period=monthly&start_date=2025-07-01&end_date=2025-07-31

# Response includes discipline analytics
{
  "success": true,
  "summary": {
    "total_employees": 45,
    "average_attendance_rate": 92.5,
    "average_discipline_score": 78.2
  },
  "report": {
    "data": [
      {
        "user_id": 20,
        "user_name": "John Doe",
        "total_present": 22,
        "total_late": 3,
        "discipline_score": 85.5,
        "discipline_label": "Sangat Baik"
      }
    ]
  }
}
```

### **🔒 5.3 Authentication & Authorization**

#### **User Roles**

- **Employee:** Basic attendance dan WFA booking
- **Management:** View reports, manage bookings
- **Admin:** Full system access, job management

#### **JWT Token Structure**

```json
{
  "id": 20,
  "email": "user@company.com",
  "full_name": "John Doe",
  "role_name": "Admin",
  "iat": 1751607363,
  "exp": 1751693763
}
```

#### **API Rate Limiting**

- **General API:** 10 requests/second with 20 burst
- **Auth endpoints:** 3 requests/second with 5 burst
- **Health check:** No rate limiting

## 6. Arsitektur & Design Patterns

### **🏗️ 6.1 MVC Architecture**

```
src/
├── app.js              # Express app configuration
├── server.js           # Server entry point
├── config/             # Database & environment config
│   ├── database.js     # Sequelize config dengan timezone
│   └── index.js        # Configuration aggregator
├── models/             # Sequelize models & associations
│   ├── index.js        # Model aggregator & relationships
│   ├── *.model.js      # Individual model definitions
│   ├── migrations/     # Database schema migrations
│   └── seeders/        # Initial data seeders
├── controllers/        # Business logic & API handlers
│   ├── *.controller.js # Route-specific controllers
│   └── jobs.controller.js # Manual job trigger endpoints
├── routes/             # API route definitions
│   ├── index.js        # Route aggregator
│   └── *.routes.js     # Individual route files
├── middlewares/        # Custom middlewares
│   ├── authJwt.js      # JWT authentication
│   ├── roleGuard.js    # Role-based authorization
│   ├── validator.js    # Request validation
│   └── errorHandler.js # Global error handling
├── utils/              # Utility functions & helpers
│   ├── fuzzyAhpEngine.js # Core intelligence engine
│   ├── geofence.js     # Location validation
│   ├── logger.js       # Winston logging configuration
│   └── *.helper.js     # Various helper functions
├── jobs/               # Automated cron jobs
│   ├── autoCheckout.job.js    # Smart checkout prediction
│   ├── createGeneralAlpha.job.js # Auto alpha generation
│   └── resolveWfaBookings.job.js # WFA booking processing
└── docs/               # Documentation files
    ├── openapi.yaml    # Swagger/OpenAPI specification
    ├── *.md            # Various documentation
    └── *.guide.md      # Implementation guides
```

### **🧠 6.2 Fuzzy AHP Engine Architecture**

```javascript
// Core Intelligence Components
Fuzzy AHP Engine
├── WFA Recommendation System
│   ├── Location Type
│   ├── Distance Factor
│   └── Amenity Score
├── Discipline Index Calculator
│   ├── Alpha Rate
│   ├── Lateness Severity
│   ├── Lateness Frequency
│   └── Work Focus
└── Smart Auto-Checkout Predictor
    ├── Historical Pattern
    ├── Check-in Pattern
    ├── Context Signal
    └── Transition Signal
```

Bobot setiap komponen dihitung dari pairwise TFN backend menggunakan Chang’s Extent Analysis.

### **⚡ 6.3 Automated Job Processing**

```javascript
// Cron Schedule (Asia/Jakarta timezone)
Jobs Schedule
├── 23:55 Daily: Smart Auto-Checkout
├── 00:05 Daily: General Alpha Generation
├── 06:00 Daily: WFA Booking Resolution
└── Manual Triggers Available via API
```

## FAHP (Fuzzy AHP) Engine

- Method: TFN → synthetic extent → degree of possibility → minimum possibility → normalized crisp weights (∑w=1) → CR check.
- Normalization: min–max to [0,1] with benefit/cost; labeling equal-interval 4 bucket (`Rendah`, `Cukup`, `Baik`, `Sangat Baik`).
- Public APIs:
  - `calculateWfaScore(place)` → `{ score(0..100), label, breakdown, weights, CR, warning? }`
  - `calculateDisciplineIndex(metrics)` → `{ score(0..100), label, breakdown, weights, CR, warning? }`
  - `getWfaAhpWeights()`, `getDisciplineAhpWeights()`, `getSmartAcAhpWeights()` → `{ ...weights, consistency_ratio, consistency_index, lambda_max }`
  - `GET /api/analysis/fuzzy-ahp` → dashboard payload with `generated_at`, `window.start_at`, and `window.end_at` emitted as millisecond-precision WIB timestamps (`+07:00`).
- Configuration: TFN scales and pairwise matrices in `src/analytics/config.fahp.js`.
- Consistency: CR, CI, and λmax are computed from the defuzzified matrix; threshold is fixed in backend code at `0.10` because it is a theoretical FAHP guardrail, not an operational setting.
- WFA analysis uses the static location catalog assumptions (`amenity_score=50`, `distance=1000`) when runtime visit telemetry is not applied; the response exposes `scope`, `window_applied`, and `data_source` to make that boundary explicit.
- Auto-checkout: Smart Auto Checkout uses FAHP weighted prediction from historical, check-in, contextual, and transition signals; CR/CI/λmax are exposed as consistency diagnostics.

## 7. Fuzzy AHP Intelligence System

### **🎯 7.1 WFA Suitability Scoring**

Setiap lokasi WFA dinilai menggunakan 4 bucket equal-interval:

| **Suitability Label** | **Score Range** | **Business Action**           |
| --------------------- | --------------- | ----------------------------- |
| `Sangat Baik`         | 75-100          | Kandidat paling sesuai        |
| `Baik`                | 50-74.99        | Kandidat sesuai               |
| `Cukup`               | 25-49.99        | Perlu review tambahan         |
| `Rendah`              | 0-24.99         | Kesesuaian rendah             |

### **📊 7.2 Discipline Index Components**

```javascript
// Discipline scoring methodology
const disciplineFactors = {
  attendanceRate: {
    weight: 0.4,
    description: 'Persentase kehadiran dalam periode'
  },
  punctualityScore: {
    weight: 0.35,
    description: 'Tingkat ketepatan waktu check-in'
  },
  consistencyAnalysis: {
    weight: 0.25,
    description: 'Konsistensi pola kehadiran'
  }
};
```

### **🔮 7.3 Smart Prediction Features**

- **Auto-Checkout Prediction:** Accuracy rate 85%+ based on historical patterns
- **Location Recommendation:** Multi-criteria analysis dengan real-time data
- **Anomaly Detection:** Fake location prevention melalui speed analysis

## 8. Continuous Deployment (CD) - Staging → Production

### **🚀 8.1 CD Architecture Overview**

Infinit Track Backend menggunakan **GitOps-style deployment** berbasis **DigitalOcean Container Registry (DOCR) + droplet-hosted Docker Compose runtime + host Nginx**. Image backend dibangun di CI, dipush ke `registry.digitalocean.com/infinit-track/infinit-track-backend`, lalu runtime droplet menarik image immutable melalui `BACKEND_IMAGE_TAG`.

```
Development → Image Build → Staging Droplet → Production Droplet
     ↓             ↓              ↓                    ↓
  Feature      Immutable SHA   Integration         Live Users
  Testing        Artifact       Verification        Real Data
```

**Key Features:**

- ✅ Canonical runtime backend ada di droplet, bukan App Platform
- ✅ Image release dipin oleh `BACKEND_IMAGE_TAG`
- ✅ Manual/CI deploy harus diverifikasi lewat `/livez` dan `/health`
- ✅ Managed MySQL tetap terpisah per environment
- ✅ Smoke/readiness verification adalah release gate, bukan best-effort check
- ✅ Rollback dilakukan dengan mengembalikan tag image terakhir yang sehat

### **📋 8.2 Quick Start - First Deployment**

#### **Step 1: Prepare Runtime Targets**

- Siapkan droplet target yang menjalankan Docker Compose backend.
- Siapkan host Nginx yang mengarah ke container backend di droplet tersebut.
- Siapkan managed MySQL per environment.
- Pastikan runtime target menarik image dari DOCR, bukan build lokal ad-hoc.

#### **Step 2: Configure GitHub Secrets & Environment Variables**

```bash
# Shared repository secret
DIGITALOCEAN_ACCESS_TOKEN=<your-do-token>

# Staging workflow input
STAGING_SSH_PRIVATE_KEY=<private-key-for-root@168.144.33.33>

# Production workflow inputs
PRODUCTION_SSH_PRIVATE_KEY=<private-key-for-production-host>
PRODUCTION_SSH_HOST=<production-ssh-host>
PRODUCTION_SSH_USER=<production-ssh-user>
PRODUCTION_DEPLOY_PATH=<absolute-path-to-backend-compose-runtime>
PRODUCTION_PUBLIC_DOMAIN=<production-public-domain>
PRODUCTION_PUBLIC_BASE_URL=<production-public-base-url>
PRODUCTION_EXPECTED_IP=<production-public-ip>
```

#### **Step 3: Deploy**

```bash
# Staging / release-candidate flow
git add .
git commit -m "Deploy-ready change"
git push origin master
# → push ke master memicu workflow staging:
#   lint + test + DOCR publish + droplet rollout + migrate + blocking smoke gate

# Optional: run staging workflow manually from GitHub Actions
# → workflow_dispatch pada "Deploy to Staging"

# Production / approved release flow
# Trigger workflow "Deploy to Production" secara manual,
# isi konfirmasi deploy-to-production,
# lalu workflow menjalankan lint + test + DOCR publish + droplet rollout + migrate + blocking smoke gate.
```

### **🎯 8.3 Deployment Workflows**

#### **Staging Deployment**

Canonical staging release should do this in order:

```yaml
1. ✅ Lint Code
2. ✅ Run Tests
3. ✅ Build and push immutable DOCR image
4. ✅ Update droplet runtime to selected BACKEND_IMAGE_TAG
5. ✅ Run migrations against staging database
6. ✅ Verify /livez and /health as blocking checks
```

Staging host is environment-specific and must come from the GitHub staging environment (`STAGING_PUBLIC_BASE_URL`, `STAGING_PUBLIC_DOMAIN`, `STAGING_EXPECTED_IP`). Never hard-code the canonical production host into the staging workflow.

#### **Production Deployment**

Canonical production release should do this in order:

```yaml
1. ✅ Validate release input / approval gate
2. ✅ Lint & Test
3. ✅ Build or select immutable DOCR image
4. ✅ Update production droplet runtime to selected BACKEND_IMAGE_TAG
5. ✅ Run migrations against production database
6. ✅ Verify /livez and /health as blocking checks
7. ✅ Observe logs/metrics on the live host after release
```

**Production host:** gunakan host canonical production yang benar-benar aktif di runtime; jangan treat placeholder domain sebagai source of truth.

### **🔒 8.4 Security & Environment Separation**

#### **Critical Differences: Staging vs Production**

| Component          | Staging                | Production                   |
| ------------------ | ---------------------- | ---------------------------- |
| **Database**       | Staging DB (test data) | Production DB (**separate**) |
| **JWT_SECRET**     | Staging secret         | **Different** secret         |
| **CORS_ORIGIN**    | Staging frontend       | Production frontend          |
| **Deploy Trigger** | Automatic              | Manual + Approval            |
| **Instance Count** | 1                      | 2+ (HA)                      |
| **Log Level**      | `info`                 | `warn`                       |

**⚠️ NEVER:**

- Reuse production secrets in staging
- Mix production & staging databases
- Auto-deploy to production

### **📊 8.5 Monitoring & Health Checks**

#### **Automated Health Checks**

Every deployment includes:

```bash
# 1. Process Liveness
GET /livez
# Expected: HTTP 200 with {"status":"OK","timestamp":"..."}

# 2. Dependency Readiness
GET /health
# Ready: HTTP 200 with {"status":"OK","ready":true,...}
# Not ready: HTTP 503 with {"status":"NOT_READY","missing":[...],...}

# 3. Database Connection
# Logs: "Database connected successfully"

# 4. Security Headers
# X-Content-Type-Options, X-Frame-Options, etc.

# 5. Authentication
# Protected endpoints return 401 without auth

# 6. CORS Configuration
# Proper origin whitelisting

# 7. Response Time
# Average < 1 second
```

#### **Smoke Tests**

Automated tests after each deployment:

```bash
# Run locally against the current staging host
npm run smoke-test "$STAGING_PUBLIC_BASE_URL"

# Included in GitHub Actions automatically
# Tests: Liveness, Readiness, Docs, CORS, Security, Auth, Performance
```

#### **First 5 Things to Check Post-Deploy**

1. **✅ Liveness & Readiness**

   ```bash
   curl "$STAGING_PUBLIC_BASE_URL/livez"
   curl "$STAGING_PUBLIC_BASE_URL/health"
   ```

   - `/livez` should return HTTP `200`
   - `/health` should return HTTP `200` only when startup dependencies are ready
   - If dependencies are missing, `/health` should return HTTP `503` and a `missing` array

2. **✅ Runtime Logs**

   - Check the droplet container logs (`docker compose logs app --tail=200`)
   - Look for "Database connected successfully"
   - No error logs

3. **✅ Database Migrations**

   - Check Build Logs
   - "✓ Migrations completed successfully"

4. **✅ CORS from Frontend**

   - Test API call from production frontend
   - No CORS errors in console

5. **✅ Critical User Flow**
   - Login → Check-in → Check-out
   - Verify full flow works

### **🔄 8.6 Rollback Procedures**

#### **Quick Rollback (5 minutes)**

**Via droplet runtime:**

```bash
export BACKEND_IMAGE_TAG=<last-known-good-sha>
docker compose pull app
docker compose up -d --force-recreate app
./deploy/scripts/verify-droplet-api.sh
```

#### **Git Rollback**

```bash
# Revert last commit
git revert HEAD
git push origin master

# Or revert specific commit
git revert <commit-hash>
git push origin master

# Staging: Auto-deploys
# Production: Manual trigger required
```

#### **Database Rollback (Emergency)**

```bash
# Only if migration caused issues
1. Stop application (prevent further writes)
2. Restore from managed database backup (DigitalOcean database tooling)
3. Rollback application code
4. Restart application
5. Verify functionality
```

### **📚 8.7 Detailed Documentation**

Comprehensive guides tersedia di folder `docs/`:

- **🏗️ [DigitalOcean Setup](./docs/droplet-docr-runtime.md)** - Canonical droplet + DOCR runtime procedure
- **🔐 [Environment Variables](./docs/ENVIRONMENT_VARIABLES.md)** - Complete ENV guide
- **🗄️ [Database Migrations](./docs/DATABASE_MIGRATION.md)** - Migration best practices
- **🔒 [Security Checklist](./docs/SECURITY_CHECKLIST.md)** - Pre/post deploy security
- **🤖 [GitHub Actions Setup](./docs/GITHUB_ACTIONS_SETUP.md)** - CI/CD configuration
- **📊 [Logging & Monitoring](./docs/LOGGING_MONITORING.md)** - Observability guide
- **🚀 [Production Deployment](./docs/PRODUCTION_DEPLOYMENT.md)** - Complete production guide

### **⚡ 8.8 Quick Commands Reference**

```bash
# Development
npm run dev                  # Start dev server with hot reload
npm run migrate              # Run database migrations
npm run migrate:status       # Check migration status
npm test                     # Run test suite
npm run lint                 # Lint code

# Deployment
npm run smoke-test <url>     # Test deployed instance
npm run migrate:undo         # Rollback last migration (dev only)

# Production Monitoring
curl "$PRODUCTION_PUBLIC_BASE_URL/health" # Health check
curl -H "Authorization: Bearer <admin_or_management_token>" "$PRODUCTION_PUBLIC_BASE_URL/docs/openapi.yaml" # Internal OpenAPI contract
```

### **🎯 8.9 Development Workflow Best Practices**

```bash
# 1. Feature Development
git checkout -b feature/new-feature
# ... make changes ...
git commit -m "Add feature: description"
git push origin feature/new-feature

# 2. Create Pull Request
# → Tests run automatically
# → Code review by team

# 3. Promote reviewed code to master
# → Push/merge to master triggers staging droplet rollout automatically
# → Verify canonical staging host after rollout completes

# 4. Production Deploy (when ready)
# → Manual trigger via GitHub Actions: "Deploy to Production"
# → Type deploy-to-production for confirmation
# → Monitor live host and logs after smoke gate passes
```

### **🔧 8.10 Troubleshooting Deployment Issues**

#### **Staging Deploy Failed**

```bash
# Check GitHub Actions logs
1. Actions tab → Failed workflow
2. Review error messages
3. Common issues:
   - Test failures → Fix tests
   - Lint errors → Run `npm run lint` locally
   - Migration errors → Check database state
```

#### **Production Health Check Failed**

```bash
# Check droplet/runtime logs
1. SSH to the target droplet
2. Review `docker compose logs app --tail=200`
3. Common issues:
   - DB connection → Verify DB_HOST, DB_PASS
   - Missing ENV → Check environment variables / env file
   - Migration failed → Review deploy workflow and container command output
```

#### **CORS Errors**

```bash
# Verify CORS_ORIGIN
1. Check environment variable in DO Dashboard
2. Must match frontend URL exactly
3. Include protocol: https://
4. No trailing slash
```

## 9. Testing & Quality Assurance

### **🧪 9.1 Available Test Scripts**

```bash
# Run all tests
npm test

# Lint code quality
npm run lint

# Test API documentation
npm run test:docs

# Test production deployment
npm run test:production

# Test booking history endpoint
node test-booking-history.js

# Manual health check
npm run health:check
```

### **📊 9.2 Testing Coverage**

- **Unit Tests:** Core business logic functions
- **Integration Tests:** API endpoint functionality
- **Performance Tests:** Load testing untuk analytics endpoints
- **Security Tests:** Authentication dan authorization validation

## 10. Monitoring & Maintenance

### **📈 10.1 Health Monitoring**

```bash
# Health check endpoints
GET /livez               # Process liveness
GET /health              # Dependency readiness
GET /docs                # Internal Swagger UI (authenticated Admin/Management session required)
GET /docs/openapi.yaml   # Internal OpenAPI contract (authenticated Admin/Management token required)
```

### **📝 10.2 Logging System**

```javascript
// Winston logging levels
{
  error: 0,    // System errors & exceptions
  warn: 1,     // Business logic warnings
  info: 2,     // General information
  debug: 3     // Detailed debugging info
}

// Log files location
logs/
├── app-YYYY-MM-DD.log     # Daily rotating logs
├── error-YYYY-MM-DD.log   # Error-only logs
└── combined.log           # All logs combined
```

### **⚠️ 10.3 Common Troubleshooting**

#### Database Connection Issues

```bash
# Check database connection
npm run db:test

# Reset database (development only)
npm run db:reset
```

#### Timezone Issues

```bash
# Verify service health and internal contract access
curl http://localhost:3005/health
curl -H "Authorization: Bearer <admin_or_management_token>" http://localhost:3005/docs/openapi.yaml

# Check database timezone settings
npm run db:timezone:check
```

#### Operational Readiness Issues

```bash
# Verify hardened operational surfaces
GET /health
GET /api/settings/operational    # authenticated Admin/Management
GET /api/attendance/today-locations # authenticated user
```

## 11. Contributing & Development Guidelines

### **👥 11.1 Development Workflow**

1. Fork repository & create feature branch
2. Follow ESLint configuration untuk code style
3. Add tests untuk new features
4. Update documentation sesuai perubahan
5. Submit pull request dengan clear description

### **📝 11.2 Code Style Guidelines**

```javascript
// ESM modules only
import express from 'express';

// Consistent error handling
try {
  await someAsyncOperation();
} catch (error) {
  logger.error('Operation failed:', error);
  next(error);
}

// Comprehensive documentation
/**
 * Calculate WFA suitability score using Fuzzy AHP
 * @param {Object} location - Location data with coordinates
 * @returns {Promise<{score: number, label: string}>}
 */
```

## 12. Changelog & Version History

### **🆕 Version 2.0.0 (July 2025)**

- ✅ **NEW:** Advanced booking history API dengan filtering & sorting
- ✅ **ENHANCED:** Complete timezone consistency untuk WIB accuracy
- ✅ **NEW:** Manual job trigger endpoints untuk admin control
- ✅ **ENHANCED:** Comprehensive Swagger documentation
- ✅ **NEW:** Production-ready deployment scripts
- ✅ **FIXED:** All cron job scheduling dan execution issues

### **📈 Version 1.5.0 (June 2025)**

- ✅ Enhanced Fuzzy AHP engine dengan hybrid scoring
- ✅ Smart auto-checkout dengan predictive analytics
- ✅ Real-time discipline index calculation
- ✅ Complete API documentation dengan Swagger UI

## 13. Support & Resources

### **📞 Support Channels**

- **Technical Issues:** Submit GitHub issues dengan detailed description
- **Feature Requests:** Create feature request dengan business justification
- **Security Concerns:** Contact security team directly

### **📚 Additional Documentation**

- **📖 API Reference:** [`docs/API_DOCUMENTATION.md`](docs/API_DOCUMENTATION.md) and local Swagger UI at `http://localhost:3005/docs` (authenticated `Admin`/`Management` session required)
- **🚀 CD & Deployment:**
  - [`docs/PRODUCTION_DEPLOYMENT.md`](docs/PRODUCTION_DEPLOYMENT.md) - Complete production deployment guide
  - [`docs/GITHUB_ACTIONS_SETUP.md`](docs/GITHUB_ACTIONS_SETUP.md) - GitHub Actions CI/CD setup
  - [`docs/droplet-docr-runtime.md`](docs/droplet-docr-runtime.md) - Canonical droplet + DOCR runtime procedure
- **🔐 Security & Configuration:**
  - [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md) - Environment variables reference
  - [`docs/SECURITY_CHECKLIST.md`](docs/SECURITY_CHECKLIST.md) - Security best practices
  - [`docs/DATABASE_MIGRATION.md`](docs/DATABASE_MIGRATION.md) - Database migration guide
- **📊 Monitoring & Operations:**
  - [`docs/LOGGING_MONITORING.md`](docs/LOGGING_MONITORING.md) - Logging & monitoring guide
  - [`docs/API_DOCUMENTATION.md`](docs/API_DOCUMENTATION.md) - Detailed API documentation
- **📈 Analytics:**
  - [`docs/SUITABILITY_LABELS_SCORING_GUIDE.md`](docs/SUITABILITY_LABELS_SCORING_GUIDE.md) - FAHP scoring guide
  - [`memory-bank/projectbrief.md`](memory-bank/projectbrief.md) - Project context

### **🔗 Quick Links**

- **Process Liveness:** [`http://localhost:3005/livez`](http://localhost:3005/livez)
- **Dependency Readiness:** [`http://localhost:3005/health`](http://localhost:3005/health)
- **Swagger UI (authenticated `Admin`/`Management` session required):** `http://localhost:3005/docs`
- **Raw OpenAPI (authenticated `Admin`/`Management` token required):** `http://localhost:3005/docs/openapi.yaml`

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**🎉 Project Status: ✅ PRODUCTION READY**

_Infinite Track Backend adalah solusi enterprise-grade untuk manajemen kehadiran modern dengan artificial intelligence terintegrasi. Dilengkapi dengan CI/CD pipeline untuk deployment otomatis, monitoring comprehensive, dan rollback instant. Siap untuk deployment dan scaling di environment production._

**Deployment Status:**

- ✅ Staging: Auto-deploy dari master branch
- ✅ Production: Manual deploy dengan approval workflow
- ✅ Database: Managed MySQL dengan automated backups
- ✅ Monitoring: Real-time logs dan health checks
- ✅ Security: CORS, security headers, rate limiting, JWT auth

**Last Updated:** October 24, 2025  
**Version:** 2.0.0  
**Maintainer:** Infinite Track Development Team
