# Promotion Proof Batch — Users, Bookings, Summary Design

**Date:** 2026-07-02  
**Repo:** `Infinit_Track_BE`  
**Status:** Draft for user review  
**Scope:** Checklist proof-filling for the Users, Bookings, and Summary endpoint groups only

## 1. Purpose

Define the next incremental phase of the promotion checklist MVP by filling status-code proof for the endpoint groups:
- Users
- Bookings
- Summary

This phase exists to reduce the number of checklist rows that are still missing proof before a future `develop -> master` promotion decision is made.

## 2. Problem Statement

The current promotion checklist verdict is blocked because too many endpoints listed in `docs/openapi.yaml` still have no recorded status-code proof.

The user chose to remain disciplined about the checklist, meaning:
- promotion remains blocked until proof is filled
- progress should happen incrementally by endpoint groups rather than by trying to prove the entire API in one step

## 3. Design Goal

For the endpoint groups Users, Bookings, and Summary:
- identify all relevant endpoints from `docs/openapi.yaml`
- classify them according to checklist rules
- collect minimum runtime proof for anonymous/protected behavior
- record the proof in the checklist artifact
- reduce the unknown/missing-proof surface without widening scope unnecessarily

## 4. Non-Goals

This phase does not attempt to:
- cover Auth + Attendance yet
- cover Analysis / Discipline / Settings / Reference Data yet
- validate full response payload schemas
- validate deep business rules
- collect wrong-role `403` proof in this phase
- redesign deploy workflows or release automation

## 5. Chosen Design

### 5.1 Scope rule

Only these endpoint groups are in scope for this phase:
- Users
- Bookings
- Summary

### 5.2 Proof depth rule

The proof depth remains:
- **status-code contract only**

### 5.3 Protected-route rule

For this phase, the minimum acceptable proof for a protected route is:
- anonymous request returns `401`

This is intentionally narrower than full auth/role verification.

### 5.4 Public-route rule

If any endpoint in these groups is public, the minimum proof is the minimum status expected by contract.
If there are no public endpoints in the scoped groups, then all rows are expected to use the anonymous-`401` pattern or another documented contract status if route semantics require it.

### 5.5 Missing-proof rule

If any scoped endpoint in these groups cannot be exercised or has no evidence recorded after the phase is complete, it remains:
- `Needs Verification`

That endpoint still counts as incomplete checklist coverage.

### 5.6 Artifact rule

This phase should update the promotion checklist artifact rather than invent a parallel evidence format.
The checklist remains the single artifact used for later promotion decisions.

## 6. Operational Consequences

### 6.1 What this phase achieves
- reduces missing checklist coverage in a controlled way
- proves access-control boundary behavior for three important endpoint groups
- builds toward a future promotion-ready verdict without pretending the whole API is already covered

### 6.2 What this phase does not achieve
- full release readiness
- full payload correctness
- role matrix verification
- success-path verification for every endpoint

## 7. Risks and Trade-offs

### Benefits
- incremental progress
- low ambiguity
- consistent with the approved checklist model
- low blast radius

### Costs
- more phases will still be needed for the remaining endpoint groups
- anonymous-`401` proof alone cannot detect deeper route logic issues

### Main risk
If people overinterpret this phase as proving Users/Bookings/Summary are fully correct, the checklist will be misread. The artifact must remain explicit that this is minimum contract proof only.

## 8. Acceptance Criteria

This phase is considered implemented when all of the following are true:

1. All Users endpoints from `docs/openapi.yaml` are represented in the checklist.
2. All Bookings endpoints from `docs/openapi.yaml` are represented in the checklist.
3. All Summary endpoints from `docs/openapi.yaml` are represented in the checklist.
4. Each scoped endpoint has a classification.
5. Each scoped endpoint has either recorded anonymous/protected proof or an explicit `Needs Verification` note.
6. The checklist artifact remains the single source of proof for this phase.

## 9. Recommended Implementation Scope

Implementation should stay bounded to:
- reading scoped endpoints from `docs/openapi.yaml`
- updating `docs/promotion-checklist-mvp.md`
- collecting anonymous/protected runtime evidence for the scoped groups
- recording verdicts cleanly in the checklist

Implementation should not automatically expand into:
- success-path coverage for every endpoint
- role-based `403` verification
- unrelated endpoint groups
- deploy workflow changes

## 10. Recommendation

Proceed with the Users + Bookings + Summary proof batch now.

This is the highest-value next slice because it reduces checklist uncertainty while staying small, repeatable, and faithful to the agreed MVP rules.
