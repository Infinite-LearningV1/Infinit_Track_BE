# Promotion Proof Batch — Auth, Attendance Design

**Date:** 2026-07-02  
**Repo:** `Infinit_Track_BE`  
**Status:** Draft for user review  
**Scope:** Checklist proof-filling for the Auth and Attendance endpoint groups only

## 1. Purpose

Define the next incremental phase of the promotion checklist MVP by filling status-code proof for the endpoint groups:
- Auth
- Attendance

This phase exists to reduce the remaining checklist uncertainty on the most critical backend contract surfaces before a future `develop -> master` promotion decision.

## 2. Problem Statement

The Users/Bookings/Summary proof batch is already complete, but promotion is still blocked because other endpoint groups remain unproven.

Among the remaining groups, Auth and Attendance are the highest-value next slice because they are closest to the core backend contract surface.

## 3. Design Goal

For the endpoint groups Auth and Attendance:
- identify all relevant endpoints from `docs/openapi.yaml`
- classify them according to checklist rules
- collect minimum runtime proof for status-code contract behavior
- record the proof in the checklist artifact
- reduce the promotion uncertainty on core backend surfaces without widening proof depth

## 4. Non-Goals

This phase does not attempt to:
- cover Analysis / Discipline / Settings / Reference Data yet
- validate full response payload schemas
- validate deep business rules
- collect wrong-role `403` proof in this phase
- redesign deploy workflows or release automation

## 5. Chosen Design

### 5.1 Scope rule

Only these endpoint groups are in scope for this phase:
- Auth
- Attendance

### 5.2 Proof depth rule

The proof depth remains:
- **status-code contract only**

### 5.3 Auth rule

For Auth, use the minimum contract behavior per endpoint:
- public-by-contract auth endpoints use the minimum documented status expected by contract
- protected auth endpoints use anonymous `401`

This avoids forcing all Auth endpoints into a fake protected-only model.

### 5.4 Attendance rule

For Attendance in this phase, the default proof for protected routes is:
- anonymous request returns `401`

This is intentionally narrower than full attendance business-rule verification.

### 5.5 Missing-proof rule

If any scoped endpoint in Auth or Attendance cannot be exercised cleanly or has no evidence recorded after the phase is complete, it remains:
- `Needs Verification`

That endpoint still counts as incomplete checklist coverage and therefore keeps promotion blocked.

### 5.6 Artifact rule

This phase should update the existing promotion checklist artifact rather than creating a parallel evidence format.

## 6. Operational Consequences

### 6.1 What this phase achieves
- reduces missing checklist coverage in the most critical backend surfaces
- proves minimum access/contract behavior for Auth and Attendance endpoints
- builds toward a future promotion-ready verdict without pretending deeper correctness is already proven

### 6.2 What this phase does not achieve
- full release readiness
- payload-level correctness
- role-matrix verification
- deep attendance/business semantics verification

## 7. Risks and Trade-offs

### Benefits
- highest-value next batch
- keeps checklist progress disciplined
- aligned with the approved MVP verification depth

### Costs
- still leaves later endpoint groups to prove
- status-code-only proof can miss deeper Auth/Attendance behavior bugs

### Main risk
If people interpret this batch as proving Auth and Attendance are fully correct, the checklist will be overread. The artifact must remain explicit that this is minimum status-code contract proof only.

## 8. Acceptance Criteria

This phase is considered implemented when all of the following are true:

1. All Auth endpoints from `docs/openapi.yaml` are represented in the checklist.
2. All Attendance endpoints from `docs/openapi.yaml` are represented in the checklist.
3. Each scoped endpoint has a classification.
4. Each scoped endpoint has either recorded proof or an explicit `Needs Verification` note.
5. The checklist artifact remains the single source of truth for this proof batch.

## 9. Recommended Implementation Scope

Implementation should stay bounded to:
- reading scoped endpoints from `docs/openapi.yaml`
- updating `docs/promotion-checklist-mvp.md`
- collecting status-code evidence for Auth and Attendance
- recording verdicts cleanly in the checklist

Implementation should not automatically expand into:
- full payload validation
- full role-matrix verification
- unrelated endpoint groups
- deploy workflow changes

## 10. Recommendation

Proceed with the Auth + Attendance proof batch now.

This is the highest-value remaining slice because it tightens the promotion checklist around the backend’s core access and attendance surfaces while staying faithful to the agreed MVP verification model.
