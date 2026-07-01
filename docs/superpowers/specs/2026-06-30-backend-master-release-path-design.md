# Backend Master Release Path Design

**Date:** 2026-06-30  
**Repo:** `Infinit_Track_BE`  
**Status:** Draft for user review  
**Scope:** Backend deploy/release-path alignment only

## 1. Purpose

Lock a single official backend release path so branch policy, runtime policy, and operator expectations stop drifting.

Target operating model:

```text
develop -> review -> master -> deploy
```

In this model:
- `develop` is the integration and review surface.
- `master` is the release branch.
- deployment is only legitimate from `master`.
- both staging and production are deployed automatically from `master`.
- merge into `master` is only allowed after all required evidence is green.

This design is intentionally bounded. It does not redesign the backend application itself, database schema, auth/session semantics, attendance final-state semantics, scheduler semantics, or FAHP behavior.

## 2. Problem Statement

The current backend deploy story is technically functional but operationally ambiguous.

Confirmed facts from repo and runtime evidence:
- canonical backend runtime is droplet-based, not Kubernetes.
- DOCR exists and is part of the active backend release story.
- the public staging host is alive and healthy.
- the repository still contains multiple historical or parallel-looking deploy surfaces.
- repo governance states `develop` is the integration/review surface and `master` is the release-ready branch.
- current deploy workflow behavior has historically been easier to read as `master`-centric than `develop`-centric.

This creates a risk that different operators infer different release rules from the same repository.

The issue is not “backend cannot deploy.”
The issue is “backend deploy authority can still be read in more than one way.”

## 3. Design Goal

Establish one release-path truth for backend deployment:

```text
feature/fix work -> develop -> review and verification -> master -> automatic staging deploy -> automatic production deploy
```

This does **not** mean every GitHub workflow must collapse into one file.
It means all valid release behavior must point back to the same branch/release rule.

## 4. Non-Goals

This design does not attempt to:
- merge staging and production workflows into a single YAML file.
- redesign DigitalOcean infrastructure.
- introduce a new environment topology.
- move staging deployment authority back to `develop`.
- introduce App Platform as an active backend runtime path.
- preserve local build-in-place as an equal release path to DOCR image deployment.

## 5. Chosen Design

### 5.1 Branch and release model

The official backend release path is:

```text
develop -> review -> master -> deploy
```

Rules:
- all normal implementation work lands in feature/fix branches and returns to `develop` first.
- `develop` is where integration and review confidence is built.
- promotion to `master` is a release act, not a normal feature-development act.
- `master` is the only branch that can legitimately trigger deployment behavior.

### 5.2 Deployment trigger model

Deployment remains `master`-driven.

Rules:
- staging deploy is automatic from `master`.
- production deploy is automatic from `master`.
- no other branch should be treated as a valid deploy source.
- if separate workflows remain, they must still be unambiguous about `master` being the only release source branch.

### 5.3 Verification gate before `master`

Merge into `master` is only valid when all required evidence is green.

Minimum gate:
- review approval exists.
- backend lint is green.
- backend test suite is green.
- required smoke/runtime verification evidence exists.
- deploy/runtime contract changes are explicitly called out when touched.
- unresolved risk is named rather than silently ignored.

This means `master` is not a test playground.
It is a promotion branch that should only receive reviewed, verified release candidates.

### 5.4 Runtime-path rule

The backend runtime path must remain singular in meaning even if the repo contains multiple historical artifacts.

Canonical backend runtime:
- droplet-hosted Docker Compose
- DOCR-backed image pull
- managed MySQL behind the runtime
- host-level ingress in front of the containerized app

Implications:
- App Platform backend artifacts are historical unless intentionally reactivated later.
- Kubernetes backend artifacts are historical/non-active unless intentionally reactivated later.
- local build-in-place may remain possible for local/operator scenarios, but it is not a peer release path.
- release documentation and contract tests should reinforce that the release runtime is image-first and tag-driven.

### 5.5 Contract interpretation rule

"Only one deploy path" in this design means:
- one official release branch path
- one official runtime meaning
- one official deploy-source branch

It does **not** require:
- one workflow file only
- one environment only
- one host only

As long as all valid deployment behavior resolves to the same release truth, the design is satisfied.

## 6. Operational Consequences

### 6.1 For developers
- normal work should stop at `develop`.
- no one should think of `develop` as a release branch.
- promotion to `master` becomes an explicit release step.

### 6.2 For reviewers/operators
- review confidence is accumulated before `master`, not after.
- if evidence is incomplete, the correct action is to block promotion to `master`.
- post-merge runtime failures from `master` are treated as release failures, not ordinary integration noise.

### 6.3 For workflow maintenance
- workflow files may stay separate for staging and production.
- but their branch trigger semantics, summary text, and surrounding docs must not imply alternative release paths.
- if a workflow can be triggered manually, it still must not undermine the rule that `master` is the only legitimate deploy source branch.

## 7. Risks and Trade-offs

### Benefits
- simpler operator mental model
- stronger release discipline
- better alignment between docs, policy, and runtime evidence
- fewer accidental “is staging from develop or master?” questions

### Costs
- slower promotion to `master` because evidence must be ready first
- less flexibility for ad-hoc branch-based deployment experiments
- any remaining workflow ambiguity becomes more visible and must be cleaned up

### Main risk
If workflow files, repo docs, and human habits are not aligned after this design is adopted, the team may continue following mixed release behavior despite the documented rule.

## 8. Acceptance Criteria

This design is considered successfully implemented when all of the following are true:

1. backend repo guidance consistently states:
   - `develop` = integration/review
   - `master` = release/deploy source
2. no active backend deploy workflow implies another branch as an equal deploy source.
3. canonical backend runtime documentation clearly points to droplet + DOCR + managed DB.
4. the compose/runtime contract does not silently encourage non-canonical release behavior.
5. promotion to `master` is described as evidence-gated.
6. staging and production deployment behavior both clearly derive from `master`.

## 9. Recommended Implementation Scope

The implementation plan for this design should focus on:
- workflow trigger and wording alignment
- release-policy doc alignment
- runtime-path doc alignment
- contract test alignment where deploy behavior is asserted
- avoiding broad unrelated infra refactors

The implementation plan should **not** automatically expand into:
- secret rotation work
- infra redesign
- database migration redesign
- application behavior changes outside deploy/runtime contract surfaces

## 10. Open Questions Resolved in This Design

Resolved choices:
- official release path = `develop -> review -> master -> deploy`
- `master` deploys to staging automatically
- `master` deploys to production automatically
- all evidence must be green before merge into `master`
- “single deploy path” means one branch/release truth, not necessarily one workflow file

## 11. Recommendation

Proceed with a contract-first implementation.

That means the next planning phase should make the smallest set of changes necessary to ensure:
- branch policy,
- workflow semantics,
- runtime contract,
- and deploy documentation

all say the same thing without introducing broader system redesign.