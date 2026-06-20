# Backend — Repo Identity & Boundaries

Backend (Infinit_Track_BE) adalah SUMBER KEBENARAN AKHIR untuk attendance state, auth/session validity, booking approval, reporting outcome, dan hasil scheduled jobs. Stack: Node.js (ESM) + Express + Sequelize + MySQL, TZ Asia/Jakarta.

- Backend = upstream truth; Web FE & Android = konsumen.
- Source-of-truth hierarchy: repo+runtime > Linear > Vibe Kanban > docs.
- Jangan tambah route/response shape/token convention diam-diam — itu perubahan kontrak (butuh DOCS/ADR note).
- Promotion: feature/* -> develop (review) -> master (release). Tidak push feature langsung ke master.
