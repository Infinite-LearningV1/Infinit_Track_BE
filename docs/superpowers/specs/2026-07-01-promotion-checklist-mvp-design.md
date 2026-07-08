# Promotion Checklist MVP Design

**Date:** 2026-07-01  
**Repo:** `Infinit_Track_BE`  
**Status:** Draft for user review  
**Scope:** Promotion-process documentation and checklist design only

## 1. Purpose

Define a minimum viable promotion checklist that is used before promoting backend changes from `develop` to `master`.

This checklist is intentionally designed for the current operating model:

```text
develop -> review -> QA -> master -> deploy
```

The checklist’s purpose is to answer one practical question:

> Is the current `develop` state ready to be promoted to `master`?

## 2. Problem Statement

The backend now has a clearer release path, but promotion readiness is still too easy to interpret loosely.

Without an explicit checklist, different operators can make different assumptions about:
- which endpoints must be checked before promotion
- what source of truth defines “all available endpoints”
- what level of proof is sufficient for QA
- what is required before `develop -> master`

This creates risk that promotion decisions are made from partial confidence rather than a consistent release gate.

## 3. Design Goal

Create a lightweight but explicit MVP checklist that:
- uses `docs/openapi.yaml` as the official endpoint inventory
- requires status-code proof for every currently available endpoint in that inventory
- is usable by humans before promotion to `master`
- does not overclaim deeper payload or business-rule verification

## 4. Non-Goals

This design does not attempt to:
- validate full response payload schemas for every endpoint
- validate all business rules and data semantics
- replace the Jest test suite
- replace runtime smoke verification
- redesign deploy workflows
- automate every check immediately
- redefine OpenAPI itself in this phase

## 5. Chosen Design

### 5.1 Inventory source rule

The endpoint inventory for promotion readiness comes from:

- `docs/openapi.yaml`

This file is treated as the canonical list of endpoints that must be considered in the checklist.

### 5.2 Verification depth rule

For this MVP, the minimum required QA proof per endpoint is:

- **status-code contract only**

This means the checklist is concerned with whether the endpoint behaves at the access/contract boundary as expected, not whether every response body field is deeply validated.

### 5.3 Endpoint classification rule

Each endpoint in the checklist should be classified into one of these operational buckets:

- public route
- authenticated route
- role-restricted route
- admin/management-only route
- intentionally absent/deprecated route (if still represented for compatibility checks)

The point of this classification is to define what status-code proof is expected when the endpoint is exercised.

### 5.4 Evidence rule

Each endpoint should have a minimum expected proof outcome such as:

- public endpoint returns success-path status (`200`, `201`, etc.) or documented validation status (`400`) when called without auth, depending on the endpoint contract
- authenticated endpoint returns `401` when called anonymously
- role-restricted endpoint returns `403` when called with insufficient privilege
- intentionally absent route returns `404`

The checklist should require enough evidence to show the status-code contract matches the expected access behavior.

### 5.5 Promotion decision rule

A `develop` state is promotion-ready only when:
- every endpoint currently represented in `docs/openapi.yaml` is accounted for in the checklist
- every checklist entry has status-code proof or an explicit exception note
- unresolved mismatches are surfaced as blockers or `Needs Verification`

If an endpoint is not covered, the promotion candidate is incomplete.
If an endpoint behaves differently from the documented expectation, the promotion candidate is not ready.

## 6. Operational Consequences

### 6.1 What this checklist guarantees
- endpoint inventory is explicit
- promotion readiness is judged against a single source of truth
- QA has a minimum consistent rule for endpoint coverage
- promotion to `master` is less likely to skip unverified contract surfaces

### 6.2 What this checklist does not guarantee
- complete response-shape correctness
- deep business-rule correctness
- complete runtime rollout safety
- absence of all backend defects
- full integration correctness for every client behavior

### 6.3 Why this is acceptable for MVP

This is acceptable because the goal is not to build a perfect verification system in one step.
The goal is to ensure that promotion decisions stop being loose and start being traceable against a real endpoint checklist.

## 7. Risks and Trade-offs

### Benefits
- clear promotion gate
- easy to explain to operators
- tied to OpenAPI contract truth
- minimal enough to adopt now

### Costs
- still manual or semi-manual unless later automated
- status-code-only checks can miss deeper payload regressions
- if OpenAPI drifts from route reality, the checklist will inherit that drift unless the mismatch is surfaced

### Main risk
If people overinterpret the checklist as “full backend quality proof,” they may promote with too much confidence. The checklist must stay clearly labeled as a minimum MVP gate.

## 8. Acceptance Criteria

This design is considered implemented when all of the following are true:

1. A promotion-checklist artifact exists.
2. The artifact explicitly states that `docs/openapi.yaml` is the endpoint inventory source.
3. The artifact explicitly states that this MVP requires status-code contract proof only.
4. Every endpoint in the OpenAPI inventory has a place in the checklist.
5. The checklist defines expected status-code proof by endpoint classification.
6. The checklist explains how missing coverage or mismatches block promotion to `master`.

## 9. Recommended Implementation Scope

Implementation should stay bounded to:
- writing the promotion checklist artifact
- documenting how endpoint classification maps to expected status-code proof
- documenting how the checklist is used in the `develop -> master` promotion step
- optionally adding a lightweight mapping/check test or helper only if needed to keep the checklist honest

Implementation should not automatically expand into:
- full payload-schema verification
- complete automation harness
- deploy workflow redesign
- Postman collection redesign
- end-to-end business-rule audit

## 10. Recommendation

Proceed with a checklist-first MVP.

That means the next implementation phase should produce a concrete promotion artifact that operators can actually use, while keeping the scope honest:

- OpenAPI is the inventory source
- status-code proof is the minimum gate
- promotion to `master` should stop if any listed endpoint lacks proof or has a contract mismatch
