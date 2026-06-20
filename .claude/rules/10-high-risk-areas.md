# Backend — High-Risk Areas (gate sebelum edit)

Selalu baca kondisi terkini + nyatakan impact/risk + rencana verifikasi sebelum mengubah:

- Attendance final-state: src/controllers/attendance.controller.js, src/jobs/createGeneralAlpha.job.js, autoCheckout.job.js, resolveWfaBookings.job.js
- Auth/session: src/middlewares/authJwt.js, roleGuard.js, auth.controller.js, tabel auth_sessions
- FAHP (teori terkunci): src/utils/fuzzyAhpEngine.js, src/analytics/config.fahp.js
- Env/deploy: src/config/index.js, .env.example, docker-compose.yml, .github/workflows/*, docs/openapi.yaml
- Dashboard/reporting contract: src/routes/summary.routes.js, summary.controller.js

Aturan: area ini = manual-first. Happy-path manual TIDAK cukup; wajib test + analisis dampak job.
