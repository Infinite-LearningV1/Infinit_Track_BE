# Final Endpoint Proof Batch Design

**Date:** 2026-07-03  
**Repo:** `Infinit_Track_BE`  
**Status:** Draft for user review  
**Scope:** Final remaining proof batch for Analysis, Discipline, Settings, and Reference Data

## 1. Purpose

Define the final remaining proof batch needed to complete the promotion checklist MVP endpoint coverage.

This batch covers:
- Analysis
- Discipline
- Settings
- Reference Data

Its purpose is to finish the remaining unproven OpenAPI surface so the checklist can produce a full promotion verdict for `develop -> master`.

## 2. Problem Statement

The promotion checklist already has proof for:
- Users
- Bookings
- Summary
- Auth
- Attendance

Promotion is still blocked only because the final endpoint groups remain unproven.

The user wants to finish the remaining scope directly and does not want known-problem endpoints to be silently excepted or skipped. If an endpoint is buggy, the checklist should say so explicitly.

## 3. Design Goal

For the remaining endpoint groups:
- use `docs/openapi.yaml` as inventory source
- collect status-code-only proof
- default protected/default endpoints to anonymous `401`
- use contract minimum status for public endpoints
- treat known-problem endpoints exactly as observed
- produce a final honest checklist state for the remaining groups

## 4. Non-Goals

This phase does not attempt to:
- validate full payload schemas
- validate deep business-rule correctness
- redesign deploy workflows
- redesign backend runtime or auth/session logic
- soften or bypass known failures automatically

## 5. Chosen Design

### 5.1 Scope rule

This batch covers only:
- Analysis
- Discipline
- Settings
- Reference Data

### 5.2 Proof depth rule

The proof depth remains:
- **status-code contract only**

This keeps the final batch consistent with all earlier proof batches.

### 5.3 Protected-route rule

Protected/default routes use:
- anonymous request returns `401`

### 5.4 Public-route rule

If a route is public by contract, the proof uses:
- minimum status documented by contract

### 5.5 Known-bug rule

Known-bug endpoints are not exempted.
They must be probed normally and recorded based on actual result:
- `PASS`
- `FAIL`
- `Needs Verification`

This avoids hiding release risk behind manual exception language.

### 5.6 Failure and uncertainty rule

If a route:
- returns a status that does not match the expected contract, it is `FAIL`
- cannot be exercised safely or cleanly, it is `Needs Verification`
- lacks evidence entirely, it remains incomplete and blocks promotion

### 5.7 Completion rule

This batch is complete only when every remaining endpoint from these groups has:
- a checklist row
- an expected proof rule
- recorded evidence
- a final row status

## 6. Operational Consequences

### 6.1 What this phase achieves
- completes the final remaining checklist coverage groups
- exposes real endpoint mismatches honestly
- lets the checklist move from partial to full endpoint inventory coverage

### 6.2 What this phase does not achieve
- proof of deep correctness
- proof of business semantics
- elimination of all production risk

### 6.3 Why this is acceptable

This is acceptable because the checklist is intentionally an MVP gate based on contract-level proof, not a comprehensive correctness framework.

## 7. Risks and Trade-offs

### Benefits
- full inventory coverage becomes achievable
- known-problem endpoints stay visible instead of being hidden
- final promotion verdict becomes concrete

### Costs
- this batch may surface more failures than earlier ones
- operators may need to decide between strict block vs explicit exception if real failures remain

### Main risk
If a final endpoint batch is treated as “just cleanup,” real failures in the remaining groups may be underestimated. This phase must remain release-significant.

## 8. Acceptance Criteria

This phase is considered implemented when all of the following are true:

1. All Analysis endpoints from `docs/openapi.yaml` are represented in the checklist.
2. All Discipline endpoints from `docs/openapi.yaml` are represented in the checklist.
3. All Settings endpoints from `docs/openapi.yaml` are represented in the checklist.
4. All Reference Data endpoints from `docs/openapi.yaml` are represented in the checklist.
5. Every remaining row has a proof rule.
6. Every remaining row has evidence or explicit `Needs Verification` / `FAIL`.
7. The checklist can produce a full endpoint-coverage verdict for promotion.

## 9. Recommended Implementation Scope

Implementation should stay bounded to:
- expanding `docs/promotion-checklist-mvp.md`
- collecting runtime status-code proof for the remaining groups
- recording PASS / FAIL / Needs Verification honestly
- producing a final promotion-impact summary

Implementation should not automatically expand into:
- payload validation
- workflow redesign
- automated exception handling
- broader release orchestration redesign

## 10. Recommendation

Proceed with the final endpoint proof batch now.

This is the fastest path to a complete promotion checklist verdict while staying faithful to the agreed MVP rules and keeping known endpoint failures visible instead of hidden.