# Promotion Checklist and Master Promotion Design

**Date:** 2026-07-01  
**Repo:** `Infinit_Track_BE`  
**Status:** Draft for user review  
**Scope:** Promotion-process checklist plus controlled `develop -> master` promotion flow

## 1. Purpose

Define the MVP artifact and operating rule used before promoting backend changes from `develop` to `master`, and define what happens immediately after that checklist passes.

This design is intentionally built for the operating model:

```text
develop -> review -> QA -> master -> deploy
```

The checklist is not the deploy itself.
The checklist is the minimum decision artifact that must pass before promotion to `master` is allowed.

## 2. Problem Statement

The backend release path is now clearer, but the promotion step is still too easy to interpret loosely.

Two risks remain if we do not define the process explicitly:
- operators may promote to `master` with incomplete endpoint verification
- operators may treat endpoint verification as optional or partial, which defeats the purpose of using `master` as the release branch

At the same time, this is still an MVP phase. The design must be strict enough to block incomplete promotions, but small enough to adopt immediately.

## 3. Design Goal

Create an MVP promotion process with these properties:
- `docs/openapi.yaml` is the source of truth for the endpoint inventory
- every currently available endpoint must have status-code proof before promotion
- if even one endpoint has no proof, promotion to `master` is blocked
- Claude summarizes the evidence and gives a verdict
- the human operator gives the final go/no-go decision
- if the checklist passes and the operator approves, promotion from `develop` to `master` proceeds and existing automation is allowed to run

## 4. Non-Goals

This design does not attempt to:
- validate full response payload schemas for every endpoint
- validate every business rule or data semantics deeply
- replace the Jest test suite
- replace runtime smoke verification after promotion
- redesign deploy workflows
- fully automate all endpoint verification immediately
- redefine OpenAPI in this phase

## 5. Chosen Design

### 5.1 Inventory source rule

The endpoint inventory for promotion readiness comes from:
- `docs/openapi.yaml`

This file is treated as the canonical list of endpoint surfaces that must be accounted for before `develop -> master` promotion.

### 5.2 Verification depth rule

For this MVP, the minimum proof required per endpoint is:
- **status-code contract only**

This means the checklist validates access/contract boundary behavior, not full payload correctness.

### 5.3 Endpoint classification rule

Each endpoint in the checklist should be classified as one of:
- public route
- authenticated route
- role-restricted route
- admin/management-only route
- intentionally absent/deprecated route (if still relevant for compatibility checks)

The purpose of this classification is to define what status-code proof is expected.

### 5.4 Expected proof rule

Each checklist row must define the minimum expected status-code proof, for example:
- public route → documented success or validation status (`200`, `201`, `400`, etc.)
- authenticated route hit anonymously → `401`
- role-restricted route hit with insufficient privilege → `403`
- intentionally absent/deprecated route → `404`

### 5.5 Blocking rule

Promotion to `master` is blocked when any of the following is true:
- an endpoint from `docs/openapi.yaml` is missing from the checklist
- a checklist entry has no proof recorded
- a proof result does not match the expected status-code contract
- the final verdict is `FAIL` or `Needs Verification`

This blocking rule is intentionally strict:

> **One endpoint without proof = no promotion**

### 5.6 Decision rule

The promotion decision is hybrid:
- Claude assembles evidence and produces the verdict
- the human operator gives the final decision to proceed or stop

Claude is not the final approver.
Claude is the evidence summarizer and release-check assistant.

### 5.7 Promotion rule after pass

If all checklist entries are covered and the verdict is `PASS`, then:
1. the operator may approve promotion from `develop` to `master`
2. the `develop -> master` promotion action is performed
3. existing `master` automation is allowed to run

This design does not change the automation itself. It only defines when promotion into that automation is allowed.

## 6. Operational Consequences

### 6.1 What this process guarantees
- endpoint inventory is explicit
- promotion readiness is judged against a single source of truth
- operators have a consistent minimum gate before `master`
- incomplete endpoint verification cannot be silently waived

### 6.2 What this process does not guarantee
- full response-payload correctness
- deep business-rule correctness
- complete runtime rollout safety
- absence of all backend defects
- complete automation of all checks

### 6.3 Why this is acceptable for MVP

This is acceptable because the immediate goal is not perfect release automation.
The goal is to stop promotion decisions from being loose and to ensure that all currently available endpoint surfaces are at least contract-verified at the status-code level before release promotion.

## 7. Risks and Trade-offs

### Benefits
- clear promotion gate
- hard stop on missing endpoint evidence
- simple enough to use now
- aligned with OpenAPI contract truth
- preserves human approval authority

### Costs
- manual or semi-manual effort per promotion cycle
- status-code-only proof can miss payload-level regressions
- if OpenAPI drifts from route reality, the checklist must surface that mismatch instead of hiding it

### Main risk
If the checklist is treated as “complete backend quality proof,” operators may overtrust it. The artifact must remain explicitly labeled as an MVP promotion gate, not a full-system correctness proof.

## 8. Acceptance Criteria

This design is considered implemented when all of the following are true:

1. A promotion checklist artifact exists.
2. The artifact explicitly states that `docs/openapi.yaml` is the endpoint inventory source.
3. The artifact explicitly states that the MVP proof depth is status-code contract only.
4. Every endpoint in the OpenAPI inventory has a place in the checklist.
5. Every checklist entry has an expected proof rule.
6. The checklist explicitly states that one missing endpoint proof blocks promotion.
7. The checklist includes a final Claude verdict section.
8. The process includes a final human go/no-go approval before `develop -> master` promotion.
9. The process explicitly states that a passing checklist permits promotion to `master`, after which existing automation may run.

## 9. Recommended Implementation Scope

Implementation should stay bounded to:
- writing the promotion checklist artifact/template
- documenting how endpoint classification maps to expected status-code proof
- documenting how the checklist is used during `develop -> master` promotion
- documenting the final Claude verdict + operator approval step
- optionally adding a lightweight helper/mapping check only if needed to keep the checklist aligned with OpenAPI inventory

Implementation should not automatically expand into:
- full payload-schema verification
- complete verification harness automation
- deploy workflow redesign
- Postman collection redesign
- deep business-rule audit

## 10. Recommendation

Proceed with a checklist-first MVP promotion gate.

That means the next implementation phase should produce:
- a concrete promotion checklist artifact that operators can use
- a clear status-code proof model per endpoint category
- a clear blocking rule for missing evidence
- a documented hybrid decision step
- and a defined handoff from `PASS` verdict to `develop -> master` promotion
