# AGENTS — Backend (Infinit_Track_BE)

> Active agent operating guide for the Infinite Track backend repository.
> Official operating model: `Cowork -> Claude Desktop Host -> Claude Code CLI -> GitHub + Linear`.
> `CLAUDE.md` remains the detailed governance and runtime gate; this file is the concise repo-local agent routing guide.

## Role repo
Backend = sumber kebenaran akhir attendance, auth/session, booking approval, reporting, scheduled jobs. Upstream untuk semua client. Stack: Node.js (ESM) + Express + Sequelize + MySQL, TZ Asia/Jakarta.

## STYLE
- ESM modules only (`import`), bukan CommonJS.
- Error handling konsisten: try/catch + logger + next(error).
- Controller tipis, logika berat di utils/analytics.
- Jangan tambah route/response shape/token convention diam-diam — itu perubahan kontrak.

## GOTCHAS
- Timezone bisnis dipaksa Asia/Jakarta (WIB) di server.js + Sequelize. Semua perhitungan tanggal/jam wajib WIB.
- Auth = JWT divalidasi terhadap stateful `auth_sessions`, bukan JWT stateless murni. Token valid hanya jika session row aktif.
- Scheduled jobs malam mengubah final state attendance (alpha, auto-checkout, WFA resolution). Bug kecil di job = truth bisnis berubah.
- `/livez` = liveness, `/health` = readiness. Server bisa start degraded jika DB/scheduler gagal.
- `/docs` + `/docs/openapi.yaml` dibatasi Admin/Management.

## ARCH_DECISIONS
- Backend final authority; client adalah request originator.
- Canonical runtime = droplet Docker Compose pull image DOCR by BACKEND_IMAGE_TAG, host Nginx di depan, managed MySQL di belakang. `.do/app*.yaml` & k8s = legacy kecuali bukti runtime berkata lain.
- Promotion: feature/* → develop (review) → master (release). Jangan push feature langsung ke master.

## ACTIVE_CONTEXT_FLOW
- Cowork captures product collaboration and high-level intent.
- Claude Desktop Host holds PM/cockpit context and decides routing.
- Claude Code CLI executes repo work in isolated worktrees.
- GitHub PRs and Linear issues are the active evidence/status systems.
- Source-of-truth order: live repo/runtime > GitHub PR/diff/checks > Linear issue context > active cockpit docs > archived docs.

## TEST_STRATEGY
- Verifikasi sah: `npm run lint`, `npm test` (jest, ESM via --experimental-vm-modules).
- Spesifik: `npm run test:alpha`, `npm run test:smart`, `npm run smoke-test <url>`.
- Area final-state/auth/scheduler: happy path manual TIDAK cukup; perlu test + cek dampak job.

## SENSITIVE (gate sebelum edit)
attendance.controller.js, jobs/*.job.js (createGeneralAlpha, autoCheckout, resolveWfaBookings), middlewares/authJwt.js + roleGuard.js, utils/fuzzyAhpEngine.js + analytics/config.fahp.js, config/index.js + .env.example + docker-compose.yml + .github/workflows/*, docs/openapi.yaml.

## DEPENDENCY RULE
Backend adalah upstream. Sebelum tandai kontrak backend Done, pastikan verifikasi ada. Client (Web FE/Android) tidak boleh menutup task konsumen sebelum kontrak backend yang dipakainya terkunci + verified.

## GENERAL

| Common Mistake | Correct Behavior |
| --- | --- |
| Membuat PR baru hanya karena branch remote sempat hilang atau diff lokal terlihat belum terserap | Sebelum membuat PR baru, verifikasi dulu apakah PR sebelumnya sudah merged dan apakah commit/isi branch sudah atau belum masuk ke `develop`. Jika belum yakin, cek state merge PR, compare `develop` vs branch target, dan baru putuskan apakah perlu PR baru. |
