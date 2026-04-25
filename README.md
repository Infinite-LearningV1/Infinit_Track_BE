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
- **Suitability Labels:** 5 tingkat (Sangat Rendah → Sangat Tinggi) berbasis interval sama.
- **Multi-criteria Analysis (default):** Location type, Distance, Amenities.

### **⚡ 3. Proses Otomatis Malam Hari (Cron Jobs)**

- **Auto Alpha:** Menandai pengguna yang tidak hadir tanpa keterangan.
- **Missed Checkout Flag:** Menandai sesi yang melewati jam pulang + toleransi tanpa checkout (tanpa prediksi fuzzy).
- **WFA Resolution:** Memproses booking WFA yang disetujui.
- **Manual Trigger API:** Admin dapat memicu jobs secara manual.

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

- **FAHP (Pure):** TFN pairwise → Fuzzy Geometric Mean (Buckley) → centroid defuzzification → normalized weights (∑w=1)
- **Consistency Check:** CR dihitung dari matriks defuzzifikasi (eigenvalue approximation)

### **☁️ External Services**

- **Cloudinary** (media), **Geoapify** (places), **Winston** (logging)

### **🛠️ Development Tools**

- **Swagger/OpenAPI**, **ESLint + Prettier**, **PM2**

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
DB_NAME=v1_infinite_track
DB_USER=your_db_user
DB_PASS=your_db_password

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

```bash
# Pastikan MySQL/MariaDB berjalan
# Buat database baru (manual di MySQL)
CREATE DATABASE v1_infinite_track;

# Jalankan migrasi untuk membuat semua tabel
npm run migrate

# (Opsional) Isi data awal dengan seeder
npm run seed
```

### **🚀 4.4 Jalankan Server**

```bash
# Development mode (dengan hot reload)
npm run dev

# Production mode
npm start

# Dengan PM2 (production deployment)
npm run prod:pm2
```

Server akan berjalan di `http://localhost:3005` (atau port yang ditentukan di `.env`).

### **✅ 4.5 Verifikasi Setup**

```bash
# Health check
curl http://localhost:3005/health

# API documentation
open http://localhost:3005/docs

# Test timezone configuration
curl http://localhost:3005/api/attendance/test-timezone
```

## 5. Dokumentasi API (Endpoint Utama)

Dokumentasi API interaktif yang lengkap tersedia melalui **Swagger UI** saat server berjalan di:
**🌐 `http://localhost:3005/docs`**

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
| `POST`                       | `/api/wfa/test-ahp`               | Test AHP algorithm (debugging)                        | Admin            |
| **📊 Analytics & Reports**   |
| `GET`                        | `/api/summary`                    | **[ENHANCED]** Laporan komprehensif + Indeks Disiplin | Admin/Management |
| `GET`                        | `/api/discipline/user/:id`        | Indeks kedisiplinan individual                        | Admin/Management |
| `GET`                        | `/api/discipline/all`             | Overview disiplin semua karyawan                      | Admin            |
| **🤖 Job Management**        |
| `GET`                        | `/api/jobs/status`                | Status semua automated jobs                           | Admin            |
| `POST`                       | `/api/jobs/trigger/general-alpha` | **[NEW]** Trigger manual alpha job                    | Admin            |
| `POST`                       | `/api/jobs/trigger/wfa-bookings`  | **[NEW]** Trigger manual WFA resolution               | Admin            |
| `POST`                       | `/api/jobs/trigger/auto-checkout` | **[NEW]** Trigger manual auto-checkout                | Admin            |
| `POST`                       | `/api/jobs/trigger/all`           | **[NEW]** Trigger semua jobs sekaligus                | Admin            |
| **👥 User Management**       |
| `GET`                        | `/api/users`                      | Mengelola semua pengguna (CRUD)                       | Admin            |
| `POST`                       | `/api/users`                      | Buat user baru                                        | Admin            |
| `PATCH`                      | `/api/users/:id`                  | Update data user                                      | Admin            |
| `DELETE`                     | `/api/users/:id`                  | Hapus user                                            | Admin            |
| **📋 Reference Data**        |
| `GET`                        | `/api/roles`                      | Daftar semua roles                                    | Authenticated    |
| `GET`                        | `/api/positions`                  | Daftar semua positions                                | Authenticated    |
| `GET`                        | `/api/divisions`                  | Daftar semua divisions                                | Authenticated    |
| `GET`                        | `/api/locations`                  | Daftar office locations                               | Authenticated    |

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
        "suitability_label": "Sangat Direkomendasikan",
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
        "discipline_label": "Sangat Disiplin"
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
│   ├── Location Type Scoring (70% weight)
│   ├── Distance Factor (23% weight)
│   └── Amenity Assessment (7% weight)
├── Discipline Index Calculator
│   ├── Attendance Rate (40% weight)
│   ├── Punctuality Score (35% weight)
│   └── Consistency Analysis (25% weight)
└── Smart Auto-Checkout Predictor
    ├── Check-in Time Pattern (40% weight)
    ├── Historical Hours (35% weight)
    └── Work Duration Context (25% weight)
```

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

- Method: TFN → FGM (Buckley) → defuzzify (centroid) → normalize (∑w=1) → CR check.
- Normalization: min–max to [0,1] with benefit/cost; labeling equal-interval (5 classes).
- Public APIs:
  - `calculateWfaScore(place)` → `{ score(0..100), label, breakdown, weights, CR, warning? }`
  - `calculateDisciplineIndex(metrics)` → `{ score(0..100), label, breakdown, weights, CR, warning? }`
  - `getWfaAhpWeights()`, `getDisciplineAhpWeights()` → `{... , consistency_ratio}`
- Configuration: TFN scales and pairwise matrices in `src/analytics/config.fahp.js`.
- Consistency: CR computed from defuzzified matrix; threshold is fixed in backend code at `0.10` because it is a theoretical FAHP guardrail, not an operational setting.
- Auto-checkout: prediction removed; system flags likely-missed-checkout using time tolerance only.

## 7. Fuzzy AHP Intelligence System

### **🎯 7.1 WFA Suitability Scoring**

Setiap lokasi WFA dinilai menggunakan 5-tier scoring system:

| **Suitability Label**     | **Score Range** | **Business Action**   |
| ------------------------- | --------------- | --------------------- |
| `Sangat Direkomendasikan` | 85-100          | Auto-approve kandidat |
| `Direkomendasikan`        | 70-84           | Standard approval     |
| `Cukup Direkomendasikan`  | 55-69           | Manual review needed  |
| `Kurang Direkomendasikan` | 40-54           | Likely rejection      |
| `Tidak Direkomendasikan`  | 0-39            | Auto-reject           |

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

Infinit Track Backend menggunakan **GitOps-style deployment** dengan DigitalOcean App Platform dan GitHub Actions untuk continuous deployment otomatis.

```
Development → Staging (Auto) → Production (Manual)
     ↓              ↓                    ↓
  Feature      Integration         Live Users
  Testing       Testing            Real Data
```

**Key Features:**

- ✅ Automated staging deployment on push to `master`
- ✅ Manual production deployment dengan approval workflow
- ✅ Automated migrations dengan rollback safety
- ✅ Health checks dan smoke tests otomatis
- ✅ Zero-downtime deployments
- ✅ Instant rollback capabilities

### **📋 8.2 Quick Start - First Deployment**

#### **Step 1: Setup DigitalOcean**

```bash
# 1. Create DO apps (via dashboard)
# - Staging: infinit-track-staging
# - Production: infinit-track-production

# 2. Get App IDs
doctl apps list

# 3. Configure environment variables (via DO Dashboard)
# See: docs/ENVIRONMENT_VARIABLES.md
```

#### **Step 2: Configure GitHub Secrets**

```bash
# Repository Secrets (Settings → Secrets → Actions)
DIGITALOCEAN_ACCESS_TOKEN=<your-do-token>

# Environment Secrets (Settings → Environments)
# staging environment:
DO_APP_ID_STAGING=<staging-app-id>

# production environment (with required reviewers):
DO_APP_ID_PRODUCTION=<production-app-id>
```

#### **Step 3: Deploy!**

```bash
# Staging (automatic)
git add .
git commit -m "Add new feature"
git push origin master
# → GitHub Actions automatically deploys to staging

# Production (manual, requires approval)
# Go to GitHub Actions → Deploy to Production → Run workflow
# Type: deploy-to-production
# → Requires reviewer approval → Deploys to production
```

### **🎯 8.3 Deployment Workflows**

#### **Staging Deployment (Automatic)**

Triggers on every push to `master`:

```yaml
1. ✅ Lint Code
2. ✅ Run Tests
3. ✅ Deploy to DO App Platform
4. ✅ Run Database Migrations
5. ✅ Execute Smoke Tests
6. ✅ Health Check Verification
```

**Staging URL:** `https://infinit-track-staging.ondigitalocean.app`

#### **Production Deployment (Manual)**

Manual trigger with confirmation + approval:

```yaml
1. ✅ Validate Confirmation ("deploy-to-production")
2. ✅ Lint & Test
3. ⏸️  Wait for Approval (required reviewers)
4. ✅ Deploy to Production
5. ✅ Run Migrations
6. ✅ Smoke Tests
7. ✅ 30-minute monitoring window
```

**Production URL:** `https://api.yourdomain.com`

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
# 1. Health Endpoint
GET /health
# Expected: {"status":"OK","timestamp":"..."}

# 2. Database Connection
# Logs: "Database connected successfully"

# 3. Security Headers
# X-Content-Type-Options, X-Frame-Options, etc.

# 4. Authentication
# Protected endpoints return 401 without auth

# 5. CORS Configuration
# Proper origin whitelisting

# 6. Response Time
# Average < 1 second
```

#### **Smoke Tests**

Automated tests after each deployment:

```bash
# Run locally
npm run smoke-test https://staging-api.app

# Included in GitHub Actions automatically
# Tests: Health, Docs, CORS, Security, Auth, Performance
```

#### **First 5 Things to Check Post-Deploy**

1. **✅ Health Endpoint**

   ```bash
   curl https://api.yourdomain.com/health
   ```

2. **✅ Runtime Logs**

   - Check DO Dashboard → Runtime Logs
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

**Via DigitalOcean Dashboard:**

```
1. Dashboard → Apps → Your App
2. Deployments tab
3. Find last good deployment
4. Click "Redeploy"
5. Monitor health checks
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
2. Restore from backup (DO Dashboard)
3. Rollback application code
4. Restart application
5. Verify functionality
```

### **📚 8.7 Detailed Documentation**

Comprehensive guides tersedia di folder `docs/`:

- **🏗️ [DigitalOcean Setup](./.do/README.md)** - App Platform configuration
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
curl https://api.yourdomain.com/health                  # Health check
curl https://api.yourdomain.com/api/jobs/status         # Check cron jobs
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

# 3. Merge to Master
# → Staging deploys automatically
# → Verify in staging

# 4. Production Deploy (when ready)
# → Manual trigger via GitHub Actions
# → Approval from reviewer
# → Monitor for 30 minutes
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
# Check DigitalOcean logs
1. Dashboard → Apps → Runtime Logs
2. Look for error messages
3. Common issues:
   - DB connection → Verify DB_HOST, DB_PASS
   - Missing ENV → Check environment variables
   - Migration failed → Check Build Logs
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
GET /health                    # Basic server health
GET /api/attendance/test-timezone  # Timezone configuration
GET /api/jobs/status          # Automated jobs status
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
# Verify timezone configuration
curl http://localhost:3005/api/attendance/test-timezone

# Check database timezone settings
npm run db:timezone:check
```

#### Job Processing Issues

```bash
# Check cron job status
GET /api/jobs/status

# Manual trigger for debugging
POST /api/jobs/trigger/all
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

- **📖 API Reference:** [`/docs`](http://localhost:3005/docs) (Swagger UI)
- **🚀 CD & Deployment:**
  - [`docs/PRODUCTION_DEPLOYMENT.md`](docs/PRODUCTION_DEPLOYMENT.md) - Complete production deployment guide
  - [`docs/GITHUB_ACTIONS_SETUP.md`](docs/GITHUB_ACTIONS_SETUP.md) - GitHub Actions CI/CD setup
  - [`.do/README.md`](.do/README.md) - DigitalOcean App Platform configuration
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

- **Health Check:** [`http://localhost:3005/health`](http://localhost:3005/health)
- **API Documentation:** [`http://localhost:3005/docs`](http://localhost:3005/docs)
- **OpenAPI Spec:** [`http://localhost:3005/docs/openapi.yaml`](http://localhost:3005/docs/openapi.yaml)

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
