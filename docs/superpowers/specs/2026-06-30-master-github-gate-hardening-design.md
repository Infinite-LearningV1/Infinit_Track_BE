# Master GitHub Gate Hardening Design

**Date:** 2026-06-30  
**Repo:** `Infinit_Track_BE`  
**Status:** Draft for user review  
**Scope:** GitHub-only hardening for the `master` release gate

## 1. Purpose

Define the minimum GitHub governance required for `master` now that the backend release path has been normalized to:

```text
develop -> review -> master -> deploy
```

This design intentionally hardens only the GitHub merge gate. It does not redesign runtime workflows, environment approvals, or broader release process layers.

## 2. Problem Statement

We verified that:
- `master` had disappeared from GitHub and was recreated from current `develop`.
- active repository rulesets exist for `master`.
- the effective rules for `master` currently require pull-request review and a required check named `build`.
- the `build` check is meaningful because the CI workflow job named `build` runs `npm ci`, `npm run lint`, and `npm test`.

The remaining issue is not absence of governance, but ambiguity about what that governance does and does not guarantee.

Without an explicit design, future operators may incorrectly assume that:
- smoke/runtime verification is already enforced by GitHub merge policy, or
- release safety is stronger than the actual configured gate.

## 3. Design Goal

Lock an explicit and honest GitHub-only merge gate for `master`:

- `master` exists as the release branch.
- merge to `master` requires PR-based review.
- merge to `master` requires the `build` check to pass.
- `build` is explicitly defined as the CI job that performs install + lint + test.
- no stronger guarantee is implied.

## 4. Non-Goals

This design does not attempt to:
- add smoke/runtime verification as a required GitHub check.
- add environment approval gates.
- redesign staging/production workflow topology.
- add new deployment workflows.
- replace operational verification with GitHub policy.
- change backend runtime behavior.

## 5. Chosen Design

### 5.1 Branch existence rule

`master` must continue to exist as a first-class remote branch because release governance and auto-deploy semantics now depend on it.

### 5.2 Merge policy rule

The minimum acceptable GitHub gate for `master` is:
- pull request review required
- required status check `build`

That is the only merge gate this design intends to enforce.

### 5.3 Meaning of `build`

`build` is not a generic label.
In this repository it maps to the CI workflow job that runs:
- `npm ci`
- `npm run lint`
- `npm test`

This mapping must remain true if the repository continues to rely on `build` as the only required check for `master`.

### 5.4 Honesty rule

Documentation and operator guidance must not imply that `master` merge is protected by smoke/runtime verification if GitHub does not actually enforce that.

The correct interpretation is:
- GitHub enforces review + `build`
- operational/runtime verification may still exist as process evidence, but not as a required GitHub merge check

### 5.5 Release-surface rule

Because staging and production now derive from `master`, weakening `master` governance would directly weaken release safety.

Therefore:
- `master` merge gate must stay explicit
- branch/ruleset drift must be treated as a release risk
- repo docs should reflect the real GitHub gate, not an imagined one

## 6. Operational Consequences

### 6.1 What this gate guarantees
- code entering `master` has passed PR review
- code entering `master` has passed install + lint + test through `build`

### 6.2 What this gate does not guarantee
- successful smoke test against a live runtime
- successful droplet rollout
- environment approval or human release signoff beyond PR review
- protection from all accidental release risk if GitHub admin settings are later weakened

### 6.3 Why this is still acceptable

This is acceptable because the chosen scope is intentionally minimal.
The goal is not to solve all release governance at once.
The goal is to ensure GitHub’s actual merge gate is explicit, meaningful, and not overstated.

## 7. Risks and Trade-offs

### Benefits
- smallest possible hardening step
- no workflow redesign required
- keeps release gate understandable
- makes `build` enforcement explicit and auditable

### Costs
- smoke/runtime verification is still outside the required GitHub gate
- operational discipline is still needed after merge to `master`
- if CI job naming changes, the meaning of `build` can drift unless tests/docs are kept aligned

### Main risk
If the repo continues to say or imply that `master` is fully release-safe just because GitHub enforces `build`, operators may overtrust the merge gate and skip runtime verification.

## 8. Acceptance Criteria

This design is considered implemented when all of the following are true:

1. `master` exists remotely.
2. GitHub ruleset for `master` remains active.
3. `master` requires PR review.
4. `master` requires the `build` check.
5. repository docs/specs describe `build` honestly as install + lint + test, not as a smoke/runtime gate.
6. no repository guidance falsely claims that smoke/runtime verification is GitHub-enforced if it is not.

## 9. Recommended Implementation Scope

Implementation should stay bounded to:
- GitHub-side verification/audit of `master` rules
- repo docs/spec wording where merge-gate meaning is described
- contract tests if needed to lock the `build` check meaning or branch gate assumptions

Implementation should not automatically expand into:
- smoke check enforcement redesign
- deploy workflow redesign
- infra approval layers
- broader release orchestration changes

## 10. Recommendation

Proceed with minimal GitHub-only hardening.

The repository should explicitly state that:
- `master` is the release branch
- GitHub enforces PR review + `build`
- `build` means install + lint + test
- runtime/smoke safety is still an operational verification concern, not part of the enforced GitHub merge gate today
