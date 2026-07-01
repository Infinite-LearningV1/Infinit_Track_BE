# INF-190 Implementation Summary

## Branch
feature/family-f-dashboard-contract-lock

## Worktree
C:/Users/Febriyadi/.claude/worktrees/Infinit_Track_BE-pr62-merged-review/Infinit_Track_BE-inf190-fahp-window-fix

## Changes Made

### Files Modified
1. src/services/fuzzyAhpAnalysis.service.js
   - Fixed `getWibAnalysisWindow('monthly')` to use a rolling 30-day window.
   - Added a dashboard recap guardrail that warns and falls back when a computed monthly window is under 7 days.
   - Scoped the new explicit empty-state behavior to the discipline dashboard recap without breaking the broader discipline analysis contract.

2. tests/analysisFuzzyAhpDashboardRecapRoute.test.js
   - Updated the mocked monthly window example to a 30-day shape.
   - Added service-focused regression tests for rolling monthly window, discipline empty state, and WFA ready-state protection.
   - Verified the real router wiring remains intact.

## Verification
- [x] `npm run lint`
- [x] `npm test -- tests/analysisFuzzyAhpDashboardRecapRoute.test.js`
- [x] `npm test -- tests/analysisFuzzyAhpContract.test.js tests/analysisFuzzyAhpControllerValidation.test.js`
- [x] `npm test`
- [ ] Manual HTTP verification with authenticated token against a running server
- [ ] Postman/curl verification for discipline empty state, WFA ready state, and Smart AC ready state
- [x] Worktree dependency setup completed (`PUPPETEER_SKIP_DOWNLOAD=1 npm ci`)

## Risks / Notes
- Dashboard recap empty-state contract for discipline now returns `reason: NO_DISCIPLINE_DATA_IN_WINDOW`, `criteria_weights: null`, `ranking_preview: null`, `distribution: null`, and `consistency: null`.
- The shared discipline analysis builder remains backward-compatible for the non-dashboard FAHP endpoint to avoid unintended API contract drift.
- DOCS/ADR UPDATE REQUIRED: dashboard empty-state runtime behavior changed, but `docs/openapi.yaml` was not updated in this scope because the approved implementation constrained changes to the specified files.
- Needs Verification: authenticated runtime smoke on a live server was not executed in this cycle.

## Related Issues
- INF-190 — FAHP dashboard recap monthly window failure
- INF-160 — Discipline tab frontend follow-up blocked on recap stability

## Next Steps
- Review the working tree diff and commit the change set.
- If desired, run authenticated smoke checks against a local or staging server.
- Decide whether to sync `docs/openapi.yaml` / dashboard contract docs in a follow-up patch or broaden this scope with explicit approval.
