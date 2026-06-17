# Backend — Verification & Evidence

Perintah verifikasi sah (jangan mengarang):
- Lint: `npm run lint`
- Test: `npm test` (jest, ESM via --experimental-vm-modules)
- Spesifik: `npm run test:alpha`, `npm run test:smart`
- Smoke (runtime): `npm run smoke-test <url>`

Aturan:
- Klaim PASS hanya dengan output segar dari cycle ini.
- Migration (`npm run migrate`) = manual-first, jangan autonomous.
- Kalau verifikasi tidak bisa dijalankan -> tandai Needs Verification, bukan Done.
