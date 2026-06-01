# INF-170 Postman-First FAHP Smoke Documentation Design — 2026-06-02

Branch: `feature/inf-170-fahp-three-endpoints`  
Issue: INF-170 — Backend FAHP split endpoints, with revised emphasis on direct test documentation in Postman  
Design status: approved direction from user in conversation, pending user review of this written spec.

## Goal

Make the three production FAHP endpoints easy to verify directly from Postman by treating the Postman collection as the primary manual-test surface.

The revised goal is **not** to expand descriptive documentation. The goal is to provide a clean, runnable, happy-path verification kit in Postman for:

- `GET /api/analysis/fuzzy-ahp/discipline`
- `GET /api/analysis/fuzzy-ahp/wfa`
- `GET /api/analysis/fuzzy-ahp/smart-ac`

while keeping repository documentation truthful and minimal.

## Why this revised design exists

The original INF-170 implementation/design work focused on API structure, contracts, and verification gates. The user then changed the emphasis:

- documentation should be oriented toward **direct testing**, not descriptive prose,
- Postman should be the primary surface,
- the collection path should be:
  - collection: `Infinite Track`
  - folder: `FuzzyAhp`
- only **happy-path** requests should be curated there,
- Smart AC should remain present on this branch and be documented too, not removed.

This design therefore supersedes the earlier documentation emphasis, while preserving the runtime implementation direction already built in the branch.

## Current facts

- The branch already contains additive production endpoints for Discipline, WFA, and Smart AC.
- The branch also already contains OpenAPI and boundary-documentation work for those endpoints.
- The Postman collection `Infinite Track` exists in the connected Postman workspace.
- The collection contains a folder named `FuzzyAhp` and multiple internal test/evidence requests elsewhere in the collection, including `Triggers Fix` and `Unit Test` folders.
- The user does **not** want the `FuzzyAhp` folder to focus on internal evidence/test endpoints.
- The user wants `FuzzyAhp` to focus on the **production** endpoints instead.
- The user wants **happy-path only** in that Postman folder.
- The user explicitly does **not** want documentation that is mostly descriptive narrative.
- The branch still contains a legacy combined endpoint `GET /api/analysis/fuzzy-ahp`, but this revised design treats that route as transition-only and not the primary manual-test target.

## User-approved decisions

1. Smart AC stays on the branch; it is **not** rolled back.
2. Documentation emphasis shifts from descriptive repo docs to **test-direct documentation**.
3. Postman is the primary documentation/testing surface.
4. The Postman location to curate is:
   - collection: `Infinite Track`
   - folder: `FuzzyAhp`
5. The Postman folder should focus on **production endpoints only**.
6. The Postman folder should contain **happy-path requests only**.
7. Repo documentation should stay truthful, but minimal.
8. Smart AC remains documented even if its runtime result can honestly be `needs_data=true` on some days.

## Scope

### In scope

- Curate the Postman folder `Infinite Track / FuzzyAhp` as a production verification pack.
- Ensure each request is directly runnable with a clear expected result.
- Keep `docs/openapi.yaml` truthful to runtime.
- Keep repo-side boundary documentation minimal and pointer-oriented.
- Keep Smart AC in the documentation set.

### Out of scope

- Broad narrative documentation of FAHP theory
- Negative-case request packs in `FuzzyAhp`
- Migration of all internal evidence endpoints into `FuzzyAhp`
- Removing Smart AC from code or docs
- Reworking the production runtime only to make documentation prettier

## Primary documentation surface: Postman

### Collection target

- **Collection:** `Infinite Track`
- **Folder:** `FuzzyAhp`

This folder becomes the **manual smoke / proof pack** for the production FAHP endpoints.

### Intended role of the folder

The folder should answer:

- “How do I run the production FAHP endpoints directly?”
- “What parameters should I use?”
- “What successful output should I expect to inspect?”

It should **not** try to explain all implementation details of the system.

## Postman folder structure

The folder should contain exactly the curated production requests below, in this order:

1. `Discipline - Monthly (Real Data)`
2. `Discipline - Weekly`
3. `Discipline - Custom`
4. `WFA - Geoapify Live`
5. `Smart AC - Today`

This order is deliberate:

- start with the most straightforward DB-backed endpoint,
- then show provider-live verification,
- then end with the prediction contract endpoint.

## Request-by-request design

### 1. `Discipline - Monthly (Real Data)`

**Endpoint**

```http
GET /api/analysis/fuzzy-ahp/discipline
```

**Purpose**

Quick proof that the production discipline endpoint returns a real-data ranking using the default period behavior.

**What the request should show**

- auth uses an Admin/Management-capable token,
- no query parameter is required,
- the response should be inspected for:
  - `success = true`
  - `data.type = "discipline"`
  - `data.weights.method = "Chang's Extent Analysis"`
  - `data.consistency.threshold = 0.10`
  - `data.ranking`

**Description style**

The Postman description should be short and operational, for example:

- purpose: verify production discipline endpoint with default real-data window
- expected result: success + discipline payload + ranking from attendance DB
- note: ranking may be empty if the selected real-data window has no attendance rows

### 2. `Discipline - Weekly`

**Endpoint**

```http
GET /api/analysis/fuzzy-ahp/discipline?period=weekly
```

**Purpose**

Proof that the weekly mode works on the production endpoint with the correct FAHP contract shape.

**What the request should show**

- successful weekly query
- real DB-backed ranking behavior
- same FAHP contract fields as monthly

**Description style**

- purpose: verify weekly production discipline query
- expected result: success + discipline payload + weekly window behavior

### 3. `Discipline - Custom`

**Endpoint**

```http
GET /api/analysis/fuzzy-ahp/discipline?period=custom&from=2026-04-01&to=2026-05-31
```

**Purpose**

Proof that a real custom range can be executed directly in the production endpoint.

**What the request should show**

- successful custom query
- `requested_window` and `executed_window`
- ranking from real attendance data for the chosen period

**Important constraint**

Because this folder is happy-path only, this request should use a range already known to produce meaningful data.

### 4. `WFA - Geoapify Live`

**Endpoint**

```http
GET /api/analysis/fuzzy-ahp/wfa?lat=-0.8917&lon=119.8707&radius_meters=5000
```

**Purpose**

Primary proof that the production WFA endpoint uses **Geoapify live data**, not static catalog assumptions.

**What the request should show**

- `success = true`
- `data.type = "wfa"`
- `data.data_source = "geoapify_live"`
- ranking items with:
  - `place_id`
  - `name`
  - `score`
  - `label`
  - `breakdown.location_type`
  - `breakdown.distance_m`
  - `breakdown.amenity_score`

**Documentation rule**

The request description must explicitly direct the reader to inspect:

- that the places are real,
- that `distance_m` is real numeric provider-derived distance,
- that `amenity_score` is not placeholder static documentation noise.

### 5. `Smart AC - Today`

**Endpoint**

```http
GET /api/analysis/fuzzy-ahp/smart-ac
```

**Purpose**

Proof that the production Smart AC endpoint exists and returns the expected contract shape for the current day.

**What the request should show**

- `success = true`
- `data.type = "smart_ac"`
- `data.target_date`
- `data.weights.method = "Chang's Extent Analysis"`
- ranking items with:
  - `user_id`
  - `predicted_time_out`
  - `evidence_summary`
  - `needs_data`

**Important Smart AC documentation rule**

The Postman request description must explicitly state that **both** of these are valid successful production outcomes:

1. `predicted_time_out` is present because evidence is sufficient
2. `needs_data = true` and `predicted_time_out = null` because runtime evidence for that day is insufficient

This prevents the documentation from implying that “success” only means non-null predictions.

## Format of each Postman request

Each request in `FuzzyAhp` should be curated consistently:

### Name

Use the exact names defined above.

### URL/query/body

- Must be directly runnable
- Must not use generic placeholders for the happy-path pack
- Must use final production endpoint URLs and query strings

### Auth

- Must clearly use a valid runtime token path
- Should not rely on stale hardcoded historical bearer values without explanation
- The request/folder should make it obvious that Admin/Management access is required where applicable

### Description

The description should be **brief** and structured around execution:

- Purpose
- Expected result
- Notes (only when needed)

Avoid long conceptual paragraphs.

### Example style

Good:

- Purpose: verify production WFA endpoint against live Geoapify data
- Expected result: success, `data_source=geoapify_live`, ranking contains real places

Bad:

- long methodological explanation of FAHP theory
- architectural prose unrelated to what the tester should check in the response

## Repo documentation policy for this revised scope

### `docs/openapi.yaml`

Still required and still authoritative, but only as a formal contract surface.

The OpenAPI document should:

- remain truthful to runtime,
- keep examples accurate,
- preserve transition-only notes for the legacy combined endpoint,
- avoid becoming the primary manual-test guide.

### `docs/reporting-analytics-boundary.md`

This file should remain short and only do the following for FAHP:

- clarify the boundary between dedicated endpoints and the legacy combined endpoint,
- point readers toward Postman `Infinite Track / FuzzyAhp` for the primary manual test pack.

### ADR and Linear sync notes

These remain governance artifacts and should stay concise.

They should describe:

- why the split endpoints exist,
- why the legacy route is transition-only,
- why WFA canonical proof belongs to the dedicated endpoint,
- why Smart AC happy-path documentation still allows honest `needs_data=true` outcomes.

## Legacy combined endpoint positioning

The revised design keeps the current position:

- legacy route remains available,
- legacy route is transition-only,
- legacy route is **not** the primary manual-test/documentation surface,
- `FuzzyAhp` Postman folder should focus on the dedicated endpoints instead.

## Success criteria

This revised documentation scope is successful when:

1. A user can open `Infinite Track / FuzzyAhp` and immediately see the 5 production requests to run.
2. Each request has a short, execution-oriented description.
3. Discipline and WFA requests prove real-data behavior directly.
4. Smart AC request documents the contract honestly, including valid `needs_data=true` outcomes.
5. OpenAPI and repo docs remain truthful, but are no longer carrying the burden of being the main manual-test guide.

## Risks and mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Folder becomes noisy again | Too many requests reduce clarity | Keep only the 5 curated production requests in `FuzzyAhp` |
| Smart AC documentation implies non-null predictions are always required | Misleads testers when runtime evidence is absent | Explicitly document `needs_data=true` as valid success outcome |
| WFA documentation slips back into static examples | Violates INF-170 intent | Use only live-oriented request plus truthful expected-result description |
| Repo docs drift from Postman | Source-of-truth confusion | Keep OpenAPI truthful and keep boundary doc as pointer, not duplicate manual guide |

## Implementation direction after this spec

Once approved, the implementation plan should focus on:

1. Curating the Postman `FuzzyAhp` folder around the 5 production requests above.
2. Tightening request names/descriptions/auth/query values.
3. Making minimal repo-doc updates so they point to the Postman-first workflow instead of trying to replace it.
4. Avoiding unnecessary runtime refactors unless documentation truthfulness reveals a real contract defect.
