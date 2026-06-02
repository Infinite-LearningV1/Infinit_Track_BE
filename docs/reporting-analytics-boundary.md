# Reporting and Analytics Boundary

This document records the backend contract boundary for reporting and analytics features. The backend remains the source of final truth for attendance-derived state, FAHP calculations, provider availability boundaries, and API response contracts.

## Fuzzy AHP Endpoints Contract

- `GET /api/analysis/fuzzy-ahp` remains temporarily supported as the legacy combined endpoint for existing clients; compatibility is transition-only.
- Canonical dedicated production endpoints are:
  - `GET /api/analysis/fuzzy-ahp/discipline`
  - `GET /api/analysis/fuzzy-ahp/wfa`
  - `GET /api/analysis/fuzzy-ahp/smart-ac`
- The Postman collection `Infinite Track`, folder `FuzzyAhp`, is the primary manual smoke surface for the dedicated FAHP endpoints and contains curated Discipline, WFA, and Smart AC requests.
- Dedicated FAHP endpoint smoke requests require a Bearer token authorized for `Admin` or `Management` access.
- This repo document records only route ownership and source-of-truth boundary. Keep detailed per-endpoint validation, examples, and run guidance in Postman instead of duplicating a manual guide here.
- Use the legacy combined endpoint only for explicit migration compatibility checks.
