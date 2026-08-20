# INF-279 Runtime Contract Alignment Verification

## Repository Evidence

- `npm run lint`: PASS (exit code `0`).
- Focused INF-279/configuration contracts: PASS (`42/42` tests).
- Inherited INF-278 deployment verification contracts: PASS (`9/9` tests in the combined focused run).
- Full non-integration regression suite: PASS (`162` suites, `1547` tests, `0` failures).
- Generic `.env.example` uses `SPACES_BUCKET=your_spaces_bucket`; it no longer promotes the staging bucket identifier.
- The initial implementation evidence was captured before the follow-up generic-env correction; the follow-up is included in the final branch state below.
- Final worktree state after the follow-up documentation update: clean; branch state includes the implementation and runtime-evidence commits.

## Staging Runtime Evidence

- Read-only runtime verification against `https://api.infinite-track.tech` reached `168.144.33.33` and passed DNS resolution, HTTP `301` redirect to HTTPS, `/livez`, and `/health` readiness.
- Direct public access to `168.144.33.33:3005` timed out, which is the expected negative TCP/HTTP result for the blocked application port.
- `WEB_ORIGIN=https://infinite-track.tech npm run smoke-test https://api.infinite-track.tech` passed `16/16` checks, including credentialed CORS/session, database/scheduler readiness, and auth protection.
- The repository `verify-public-ingress.sh` could not be invoked directly in this Windows worktree because Bash is unavailable; its TCP, HTTP redirect, and direct-port checks were run equivalently with proxy bypass.
- GitHub `staging` environment inspection found no `STAGING_WEB_ORIGIN` variable.
- The deployed staging Web FE browser origin could not be established from the available evidence. The observed runtime currently answers with the production origin `https://infinite-track.tech`, but that does not prove it is the intended staging Web FE origin.
- Required follow-up before staging rollout: configure `STAGING_WEB_ORIGIN` from the observed staging Web FE origin, then verify it equals the running container `CORS_ORIGIN` and run the blocking credentialed Web smoke.

## Production Runtime Evidence

- No separate production runtime was found: the DigitalOcean account exposes only `it-backend-staging-sgp1` at `168.144.33.33`, and GitHub production variables point to the same IP and API URL as staging.
- The successful public smoke above therefore cannot be claimed as production evidence.
- GitHub `production` environment inspection found no `PRODUCTION_WEB_ORIGIN` variable.
- The existing GitHub `CORS_ORIGIN` variable still contains the legacy origin together with the canonical origin; this is not proof of the exact single-origin runtime contract.
- Required follow-up before production rollout: identify/provision the separate production Droplet, configure `PRODUCTION_WEB_ORIGIN=https://infinite-track.tech`, reconcile the production host-local runtime `CORS_ORIGIN`, and run the workflow's deployed-container comparison, credentialed Web smoke, ingress, liveness, and readiness gates.

## Release Protection Evidence

- `NEEDS VERIFICATION / NEEDS DECISION`: the `production` GitHub environment currently reports no protection rules.
- The active `master-protection` ruleset requires one pull-request approval, resolved review threads, and the `build` status check, but it does not prove staging-before-production ordering.
- Staging and production remain independently triggered from `master` in repository YAML; an explicit promotion-ordering decision or verified external protection rule is still required.

## Audit Cross-check

- Active documentation uses `api.infinite-track.tech` as the canonical production API endpoint; no active note was found that assigns it to the staging Droplet or staging database.
- `docs/infra-config-truth-audit.md` is explicitly labeled as a historical snapshot and is not an active deployment instruction.
- INF-279 does not define a separate staging env filename. The existing `BACKEND_ENV_FILE` Compose override remains the host-local operator boundary; no new path was invented without verified Droplet evidence.
