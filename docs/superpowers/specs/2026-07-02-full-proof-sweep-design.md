# Full Proof Sweep Design

**Date:** 2026-07-02  
**Repo:** `Infinit_Track_BE`  
**Status:** Draft for user review  
**Scope:** Full remaining endpoint proof sweep for the promotion checklist MVP

## 1. Purpose

Define the next phase of the promotion checklist MVP by filling proof for **all remaining endpoints** that are still unproven in the checklist.

This phase exists to turn the checklist from a partial artifact into a full promotion gate artifact that can be used for a real `develop -> master` decision.

## 2. Problem Statement

The current checklist has partial coverage only.

Completed proof exists for:
- Users
- Bookings
- Summary

But the checklist still blocks promotion because other endpoint groups remain unproven.

The user now wants to stop working by batch and instead run a full proof sweep across all remaining endpoint groups while keeping the MVP proof depth minimal.

## 3. Design Goal

Complete the remaining checklist proof using these rules:
- `docs/openapi.yaml` remains the full endpoint inventory source
- proof depth remains **status-code contract only**
- protected endpoints default to anonymous `401`
- public endpoints use minimum documented contract status
- one endpoint without proof still blocks promotion to `master`

## 4. Non-Goals

This phase does not attempt to:
- validate full payload schemas
- validate deep business rules
- redesign deploy workflows
- redesign auth/session logic
- redesign runtime architecture
- replace the test suite with checklist evidence

## 5. Chosen Design

### 5.1 Inventory rule

The endpoint inventory continues to come from:
- `docs/openapi.yaml`

The full sweep covers every remaining endpoint not already proven in the checklist.

### 5.2 Proof depth rule

The proof depth remains:
- **status-code contract only**

This is intentionally the same as the earlier batches so the checklist stays internally consistent.

### 5.3 Protected-route proof rule

For protected endpoints, the default proof is:
- anonymous request returns `401`

This remains true even for Auth/Attendance and the remaining groups unless a route is public by design.

### 5.4 Public-route proof rule

For any route that is public by contract, minimum proof is the minimum status-code expected by the contract.

### 5.5 Failure and uncertainty rule

If any endpoint:
- cannot be exercised safely,
- does not return the expected status,
- or has no evidence recorded,

then that checklist row must remain:
- `FAIL`, or
- `Needs Verification`

and the promotion verdict remains blocked.

### 5.6 Completion rule

This full proof sweep is complete only when every endpoint remaining from the inventory has:
- a row in the checklist,
- an expected proof rule,
- recorded evidence,
- and a final row status.

## 6. Operational Consequences

### 6.1 What this phase achieves
- promotion checklist coverage becomes full
- the operator can finally ask whether `develop` is promotion-ready using one artifact
- missing proof is no longer hidden behind partial batches

### 6.2 What this phase still does not achieve
- full payload correctness
- full business-rule correctness
- complete runtime rollout certainty
- elimination of all production risk

### 6.3 Why this is acceptable

This is acceptable because the checklist is explicitly an MVP gate based on status-code contract proof, not a full-system correctness framework.

## 7. Risks and Trade-offs

### Benefits
- one final promotion artifact
- one final go/no-go verdict source
- no more ambiguity about “what still lacks proof”

### Costs
- runtime probing is broader and more time-consuming
- some endpoints may still end up `Needs Verification`
- MVP proof depth can still miss deeper correctness bugs even after full coverage

### Main risk
If the team interprets a fully filled checklist as full backend correctness proof, the gate will be overtrusted. The artifact must stay explicitly framed as minimum status-code contract proof.

## 8. Acceptance Criteria

This phase is considered implemented when all of the following are true:

1. Every endpoint from `docs/openapi.yaml` appears in the checklist.
2. Every endpoint row has a classification.
3. Every endpoint row has an expected status-code proof rule.
4. Every endpoint row has recorded evidence or an explicit `Needs Verification` note.
5. The checklist can produce a final promotion verdict for `develop -> master`.

## 9. Recommended Implementation Scope

Implementation should stay bounded to:
- expanding `docs/promotion-checklist-mvp.md`
- collecting runtime status-code evidence for all remaining endpoint groups
- recording final PASS / FAIL / Needs Verification rows
- producing a final promotion verdict summary

Implementation should not automatically expand into:
- full success-path testing for every endpoint
- payload schema validation
- workflow redesign
- new deploy automation design

## 10. Recommendation

Proceed with the full proof sweep now.

This is the fastest path to a usable promotion verdict while staying consistent with the checklist discipline that has already been established.