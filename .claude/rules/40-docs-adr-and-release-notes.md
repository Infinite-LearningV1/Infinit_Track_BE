# Backend — Docs, ADR & Release Notes

Tulis `DOCS/ADR UPDATE REQUIRED` saat task menyentuh:
- auth/session contract
- attendance final-state semantics
- scheduler/job behavior
- dashboard/reporting contract (OpenAPI)
- env/deploy/runtime truth
- FAHP theory/threshold

Release/promotion:
- develop = integrasi (sudah review). master = release-ready.
- Promotion develop->master butuh evidence + human review (lihat LOOP_CLOSURE_CONTRACT).
- OpenAPI (docs/openapi.yaml) wajib sinkron saat kontrak berubah.
