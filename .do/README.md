# DigitalOcean App Platform Deployment

## 📋 Overview

Konfigurasi ini mendukung deployment otomatis aplikasi Infinit Track Backend ke DigitalOcean App Platform menggunakan GitOps-style deployment.

## 🚀 Deployment Methods

### Method 1: Via DigitalOcean Dashboard (Manual)

1. **Login ke DigitalOcean Dashboard**

   - Buka https://cloud.digitalocean.com/
   - Navigate ke "Apps"

2. **Create New App**

   - Click "Create App"
   - Pilih "GitHub" sebagai source
   - Authorize GitHub dan pilih repository `Infinit_Track_BE`
   - Pilih branch `master` (atau branch staging Anda)

3. **Upload App Spec**

   - Pilih opsi "Edit Your App Spec"
   - Copy-paste isi dari `.do/app.yaml`
   - Update `github.repo` dengan username GitHub Anda

4. **Configure Environment Variables (CRITICAL)**

   Set environment variables berikut di Dashboard → Apps → Settings → Environment Variables:

   **Database (Required):**

   ```
   DB_HOST=<your-db-host>
   DB_NAME=<your-db-name>
   DB_USER=<your-db-user>
   DB_PASS=<your-db-password>
   ```

   **JWT (Required):**

   ```
   JWT_SECRET=<generate-random-secure-string>
   ```

   **Optional Services:**

   ```
   GEOAPIFY_API_KEY=<your-geoapify-key>
   ```

   **Media Storage:**

   ```env
   SPACES_ENDPOINT=sgp1.digitaloceanspaces.com
   SPACES_REGION=sgp1
   SPACES_BUCKET=infinite-track-staging-sgp1
   SPACES_ACCESS_KEY_ID=<your-spaces-access-key>
   SPACES_SECRET_ACCESS_KEY=<your-spaces-secret-key>
   ```

   **Optional transitional legacy cleanup:**

   ```env
   CLOUDINARY_CLOUD_NAME=<your-cloudinary-cloud-name>
   CLOUDINARY_API_KEY=<your-cloudinary-api-key>
   CLOUDINARY_API_SECRET=<your-cloudinary-api-secret>
   ```

5. **Deploy**
   - Review konfigurasi
   - Click "Create Resources"
   - Tunggu hingga deployment selesai (~5-10 menit)

### Method 2: Via GitHub Actions (Automated CD)

Lihat file `.github/workflows/deploy-staging.yml` untuk workflow otomatis.

**Prerequisites:**

1. Set GitHub Secrets:

   - `DIGITALOCEAN_ACCESS_TOKEN` - Token API dari DO
   - Environment-specific secrets di GitHub Environments

2. Workflow akan otomatis trigger saat:
   - Push ke branch `master`
   - Atau manual trigger via GitHub Actions tab

## 🔒 Environment Variables Security

### ⚠️ JANGAN commit secrets ke repository!

**Secrets harus diset di:**

- ✅ DigitalOcean Dashboard (untuk manual deploy)
- ✅ GitHub Environments Secrets (untuk CI/CD)
- ❌ JANGAN di `.env` file yang di-commit
- ❌ JANGAN di `app.yaml` langsung

## 🏥 Health Check

App Platform akan melakukan health check ke endpoint `/health` setiap 10 detik:

- **Success Response:** `{"status":"OK","timestamp":"..."}`
- **HTTP Status:** 200

Jika health check gagal 3x berturut-turut, container akan di-restart otomatis.

## 📊 Monitoring & Logs

### Via DigitalOcean Dashboard

1. **Runtime Logs:**

   - Dashboard → Apps → Your App → Runtime Logs
   - Lihat console output dari aplikasi

2. **Build Logs:**

   - Dashboard → Apps → Your App → Activity
   - Lihat log build process

3. **Metrics:**
   - Dashboard → Apps → Your App → Insights
   - Monitor CPU, Memory, Request rate

## 🔄 Update Deployment

### Auto Deploy (Recommended)

Push perubahan ke branch `master`:

```bash
git add .
git commit -m "Update feature XYZ"
git push origin master
```

DO App Platform akan otomatis detect dan deploy.

### Manual Deploy via Dashboard

1. Dashboard → Apps → Your App
2. Click "Create Deployment"
3. Pilih branch/commit
4. Click "Deploy"

## 🎯 Verifikasi Setelah Deploy

Checklist yang harus dilakukan:

1. **Health Check**

   ```bash
   curl https://your-app-url.ondigitalocean.app/health
   ```

   Expected: `{"status":"OK",...}`

2. **API Docs**

   ```bash
   curl https://your-app-url.ondigitalocean.app/docs
   ```

   Should return Swagger UI

3. **Database Connection**

   - Check Runtime Logs untuk "Database connected successfully"
   - Jika error, verifikasi DB credentials di Environment Variables

4. **CORS Configuration**

   - Test API call dari frontend staging
   - Verifikasi `CORS_ORIGIN` sudah diset dengan benar

5. **Automated Jobs**
   - Check logs untuk "All automated attendance jobs have been scheduled"

## 🐛 Troubleshooting

### Deploy Failed - Build Error

- Check Build Logs di Activity tab
- Biasanya issue: dependency tidak terinstall atau syntax error
- Fix: pastikan `package.json` up-to-date

### Deploy Success tapi Health Check Failed

- Check Runtime Logs
- Kemungkinan:
  - Database connection gagal (cek DB_HOST, DB_USER, DB_PASS)
  - Missing environment variable (cek JWT_SECRET)
  - Port binding issue (pastikan PORT=3000)

### 500 Internal Server Error

- Check Runtime Logs untuk error details
- Common issues:
  - Missing JWT_SECRET
  - Database connection timeout
  - Missing required environment variables

## 📝 Notes

- **Instance Size:** Staging menggunakan `basic-xxs` (cost-effective)
- **Region:** Singapore (`sgp1`) - sesuaikan jika perlu
- **Auto-scaling:** Disabled untuk staging (manual scale via dashboard jika perlu)
- **Database:** Pastikan menggunakan managed database DO atau external DB yang accessible

## 🔗 Useful Links

- [DO App Platform Docs](https://docs.digitalocean.com/products/app-platform/)
- [App Spec Reference](https://docs.digitalocean.com/products/app-platform/reference/app-spec/)
- [Environment Variables](https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/)

