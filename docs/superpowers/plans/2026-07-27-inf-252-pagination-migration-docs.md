# INF-252 Pagination Migration Documentation Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stale pre-INF-262 migration guidance with an explicit Phase A/B/C pagination lifecycle and Modular MVC ownership map without changing runtime behavior.

**Architecture:** Preserve the old Phase 2 list-query design as historical evidence and add a superseding post-INF-262 design as the migration source of truth. Update the Users migration plan, target architecture, and API inventory to distinguish current compatibility behavior from the approved always-paginated target while leaving OpenAPI aligned with the current runtime.

**Tech Stack:** Markdown architecture documents, OpenAPI YAML as a read-only runtime-contract reference, Git, ripgrep, ESLint, Jest.

## Global Constraints

- Baseline is `develop` at merge commit `df5a491` from PR #129.
- This delivery changes documentation only; it must not modify runtime, routes, response shapes, database, Docker, or Linear state.
- Phase A is current: pagination is opt-in and omission of `page`/`limit` preserves the full-array response.
- Phase B is INF-263: Web FE always sends pagination and consumes server metadata without a second client-side pagination layer.
- Phase C is target: backend always paginates with defaults `page=1`, `limit=20`, and maximum `limit=100`.
- Phase C requires a separate backend contract issue and PR after INF-263 deployment evidence exists.
- OpenAPI continues to describe Phase A until the Phase C runtime change lands.
- The canonical pagination object is `{ page, limit, total, totalPages }`, as a sibling of `data`.
- ADR-009 remains `Proposed`; this delivery must not imply acceptance.
- Attendance and summary-report pagination unification remains out of scope.
- Preserve the historical body of the superseded Phase 2 design.

---

## File responsibility map

| File | Responsibility after this plan |
|---|---|
| `docs/superpowers/specs/2026-07-27-inf-252-list-query-post-inf262-design.md` | Binding post-INF-262 list-query and Users extraction design |
| `docs/superpowers/specs/2026-07-27-inf-252-phase2-list-query-design.md` | Historical pre-INF-262 decision record with a superseded banner |
| `docs/superpowers/plans/2026-07-27-inf-252-phase2-users-module.md` | Executable module-migration sequence based on the live Phase A contract |
| `docs/architecture/target-modular-mvc.md` | Stable architecture rules and worked Users directory ownership example |
| `docs/architecture/api-contract-inventory.md` | Current contract and findings truth at `df5a491` |
| `docs/openapi.yaml` | Unmodified live Phase A API description |

---

### Task 1: Establish the superseding post-INF-262 design

**Files:**
- Create: `docs/superpowers/specs/2026-07-27-inf-252-list-query-post-inf262-design.md`
- Modify: `docs/superpowers/specs/2026-07-27-inf-252-phase2-list-query-design.md:1-7`
- Reference: `docs/superpowers/specs/2026-07-27-inf-252-pagination-migration-docs-design.md`

**Interfaces:**
- Consumes: Approved Phase A/B/C lifecycle and ownership boundaries from the binding documentation-refresh design.
- Produces: One linkable source of truth used by the Users plan and target architecture.

- [ ] **Step 1: Confirm the stale design still presents INF-250 decisions as unresolved**

Run:

```powershell
rg -n 'Pagination \| \*\*none\*\*|Decisions required before implementation|D1 —|D2 —|D3 —|blocked on two decisions' docs/superpowers/specs/2026-07-27-inf-252-phase2-list-query-design.md
```

Expected: matches show the pre-INF-262 state and unresolved D1/D2/D3 sections.

- [ ] **Step 2: Create the replacement design with resolved decisions**

Create `docs/superpowers/specs/2026-07-27-inf-252-list-query-post-inf262-design.md` with these exact top-level sections:

```markdown
# INF-252 Phase 2 — List Query Foundation after INF-262

**Status:** Approved migration source of truth
**Supersedes:** [2026-07-27-inf-252-phase2-list-query-design.md](2026-07-27-inf-252-phase2-list-query-design.md)
**Baseline:** `develop` at `df5a491`

## 1. Resolved decisions
## 2. Current contract — Phase A
## 3. Client migration — Phase B
## 4. Target contract — Phase C
## 5. Modular MVC ownership
## 6. Shared list-query boundary
## 7. Extraction invariants
## 8. Verification gates
## 9. Risks
## 10. Out of scope
```

The resolved-decision table must contain:

```markdown
| Former decision | Resolution |
|---|---|
| D1 — pagination envelope | Users uses the canonical `{ page, limit, total, totalPages }` object as a sibling of `data`; attendance and reports migrate separately |
| D2 — paginate users | Yes; opt-in in Phase A, always paginated only after INF-263 in Phase C |
| D3 — search fields | Per-endpoint allowlist; Users searches `full_name`, `nip_nim`, and `email` |
```

The ownership section must map `user.validation.js`, `user.controller.js`, `user.service.js`, `user.query.js`, and `user.mapper.js` exactly as specified in the approved design. It must state that extraction preserves both the Phase A `findAll` compatibility path and the paginated `findAndCountAll` path.

- [ ] **Step 3: Mark the old design as historical without rewriting its body**

Change its metadata to:

```markdown
**Status:** Superseded — historical pre-INF-262 decision record
**Superseded by:** [2026-07-27-inf-252-list-query-post-inf262-design.md](2026-07-27-inf-252-list-query-post-inf262-design.md)
```

Add this note immediately before the first horizontal rule:

```markdown
> Historical boundary: the facts and recommendations below describe the repository before INF-250 was decided and INF-262 landed in PR #129. Do not use this document to implement the Users query extraction.
```

Do not modify sections 1 through 8.

- [ ] **Step 4: Verify the replacement and supersession relationship**

Run:

```powershell
rg -n 'Approved migration source of truth|Phase A|Phase B|Phase C|user\.query\.js|findAndCountAll|findAll' docs/superpowers/specs/2026-07-27-inf-252-list-query-post-inf262-design.md
rg -n 'Status:.*Superseded|Superseded by:|Historical boundary:' docs/superpowers/specs/2026-07-27-inf-252-phase2-list-query-design.md
```

Expected: the replacement contains all lifecycle and ownership markers; the old design contains all three historical markers.

- [ ] **Step 5: Commit the superseding design**

```powershell
git add docs/superpowers/specs/2026-07-27-inf-252-list-query-post-inf262-design.md docs/superpowers/specs/2026-07-27-inf-252-phase2-list-query-design.md
git diff --cached --check
git commit -m "docs(inf-252): supersede pre-INF262 list query design"
```

Expected: one documentation-only commit with no files outside `docs/superpowers/specs/`.

---

### Task 2: Align the Users migration plan and target architecture

**Files:**
- Modify: `docs/superpowers/plans/2026-07-27-inf-252-phase2-users-module.md:3-150`
- Modify: `docs/architecture/target-modular-mvc.md:92-176`
- Reference: `docs/superpowers/specs/2026-07-27-inf-252-list-query-post-inf262-design.md`

**Interfaces:**
- Consumes: Phase A/B/C terminology and ownership rules from Task 1.
- Produces: Migration instructions that preserve current behavior and a worked architecture example future modules can follow.

- [ ] **Step 1: Record the stale Users-plan assumptions before editing**

Run:

```powershell
rg -n 'Op\.or.*full_name.*nip_nim|move a `LIKE` search|sort allowlist \(F49\)|Slice 3' docs/superpowers/plans/2026-07-27-inf-252-phase2-users-module.md
```

Expected: matches show the pre-INF-262 two-field query description and the INF-251/INF-261-only amendment.

- [ ] **Step 2: Add the binding post-INF-262 design to the Users plan**

Below the existing binding-spec metadata, add:

```markdown
**Binding list-query design:** [2026-07-27-inf-252-list-query-post-inf262-design.md](../specs/2026-07-27-inf-252-list-query-post-inf262-design.md)
```

Add a new section after the INF-251/INF-261 amendment:

```markdown
### Amended 2026-07-27 — INF-250 / INF-262 landed in PR #129

Slice 3 now extracts the Phase A dual-mode contract. It does not introduce Phase C.
```

The section must enumerate:

- pagination trigger, defaults, cap, count, and empty-page behavior;
- three search fields and wildcard escaping;
- five filters;
- five sort fields and deterministic validation;
- `location_status` integrity semantics;
- `UserListItem` projection boundary;
- Phase B dependency on INF-263;
- Phase C as a separate contract PR.

- [ ] **Step 3: Replace the stale Slice 3 responsibility paragraph**

Replace the paragraph beginning `**Slice 3** carries the real risk` with:

```markdown
**Slice 3** carries the highest read-path risk. It moves the complete Phase A query matrix into `user.query.js`: the `findAll` compatibility path; the `findAndCountAll` paginated path; pagination defaults and cap; escaped three-field search; five filters; allowlisted sorting; left-joined WFH location integrity; `distinct: true`; and `subQuery: false`. `user.validation.js` owns transport validation, `user.service.js` owns integrity warnings, and `user.mapper.js` owns the slim list projection. The extraction must preserve both response modes exactly.
```

Update the verification section to require these existing tests by name:

```markdown
- `tests/usersListPaginationContract.test.js`
- `tests/usersListQueryValidationContract.test.js`
- `tests/usersListSortContract.test.js`
- `tests/usersPayloadContract.test.js`
- `tests/openApiRuntimeDriftContract.test.js`
```

- [ ] **Step 4: Add the worked Users directory example to target architecture**

After `### Query object`, add `#### Worked example — Users directory` containing:

```text
user.routes.js
  -> user.validation.js
  -> user.controller.js
  -> user.service.js
  -> user.query.js
  -> Sequelize models
  -> user.mapper.js
  -> HTTP response
```

State these invariants:

1. Validation owns scalar shape, ranges, enums, and the sort allowlist.
2. Controller contains no Sequelize concepts.
3. Service owns integrity-warning orchestration.
4. Query owns associations, predicates, ordering, pagination, and both Phase A fetch paths.
5. Mapper owns the stable slim response item.
6. Feature-specific fields and joins remain in Users.
7. Shared pagination/search mechanisms require two real consumers.
8. Phase C is not part of the extraction.

Add a Phase 2 migration-order note linking to the post-INF-262 design.

- [ ] **Step 5: Verify migration ownership and lifecycle terms**

Run:

```powershell
rg -n 'INF-250 / INF-262|Phase A|Phase B|Phase C|three-field|five filters|findAll|findAndCountAll|usersListPaginationContract' docs/superpowers/plans/2026-07-27-inf-252-phase2-users-module.md
rg -n 'Worked example — Users directory|user\.validation\.js|user\.query\.js|integrity-warning|Phase C|two real consumers' docs/architecture/target-modular-mvc.md
```

Expected: both files name the complete ownership split and distinguish extraction from the later breaking contract change.

- [ ] **Step 6: Commit the migration guidance**

```powershell
git add docs/superpowers/plans/2026-07-27-inf-252-phase2-users-module.md docs/architecture/target-modular-mvc.md
git diff --cached --check
git commit -m "docs(inf-252): align users migration with pagination contract"
```

Expected: one commit modifying only the Users plan and target architecture.

---

### Task 3: Reconcile the API contract inventory

**Files:**
- Modify: `docs/architecture/api-contract-inventory.md:65-134`
- Modify: `docs/architecture/api-contract-inventory.md:304-326`
- Modify: `docs/architecture/api-contract-inventory.md:396-557`
- Reference: `docs/openapi.yaml:2810-2905`

**Interfaces:**
- Consumes: Current Phase A facts from PR #129 and the lifecycle terminology from Task 1.
- Produces: A non-contradictory current-state inventory while leaving attendance/reporting findings open.

- [ ] **Step 1: Prove the inventory currently contradicts itself**

Run:

```powershell
rg -n 'query: `search`, `sortBy`, `sortOrder` — \*\*no pagination\*\*|none of them fixed|documented almost entirely wrong|data: \[ … \], no pagination|query `search`/`sortBy`/`sortOrder`' docs/architecture/api-contract-inventory.md
```

Expected: stale statements appear alongside later F20/F49 closure text.

- [ ] **Step 2: Correct the `/api/users` endpoint table**

Replace the list row with:

```markdown
| GET | `/api/users` | Admin, Management | query: `page`, `limit`, `search`, `role`, `program`, `division`, `position`, `location_status`, `sortBy`, `sortOrder`; pagination opt-in in Phase A | 400, 401, 403 | covered | covered | covered |
```

Keep the request-shape correction, but append:

```markdown
**Migration target.** INF-263 is Phase B: Web FE always sends pagination. Phase C later makes pagination the backend default and removes the full-array path in a separate contract PR.
```

- [ ] **Step 3: Reconcile historical progress and findings text**

Change the sentence saying all eight Users findings remain unfixed so it explicitly records:

```markdown
F20 is closed by INF-262; F49, recorded later during characterization, is also closed by INF-262. The remaining Users findings stay open unless their own entries say otherwise.
```

Update the F35 row in the active inconsistency table to:

```markdown
| **F35** | **Users half CLOSED by INF-251/INF-261/INF-262.** OpenAPI now documents the slim projection and the full Phase A query/pagination matrix. The historical mismatch is preserved below; F36 remains the attendance-only open half | `docs/openapi.yaml`; `user.controller.js` |
```

Replace the historical F35/F36 comparison table Users rows with current Phase A values:

```markdown
| `GET /api/users` — query | Phase A: `page`, `limit`, `search`, `role`, `program`, `division`, `position`, `location_status`, `sortBy`, `sortOrder` | same |
| `GET /api/users` — body | Phase A paginated mode: flat `data` plus sibling `pagination`; legacy mode: flat `data` without pagination | same |
```

Change the F35 resolution paragraph to credit INF-262 and name pagination, filters, three-field search, and allowlisted sorting. Do not change the F36 attendance finding or F39.

- [ ] **Step 4: Verify stale active claims are gone and open findings remain**

Run:

```powershell
$file = 'docs/architecture/api-contract-inventory.md'
if (Select-String -Path $file -Pattern 'query: `search`, `sortBy`, `sortOrder` — \*\*no pagination\*\*|none of them fixed|data: \[ … \], no pagination') { exit 1 }
rg -n 'pagination opt-in in Phase A|Migration target|F20 is closed|Users half CLOSED|INF-251/INF-261/INF-262|F39|F36.*still open' $file
```

Expected: the first command exits successfully with no stale matches; the second shows corrected Users facts while F39 and F36 remain open.

- [ ] **Step 5: Confirm OpenAPI was not changed**

Run:

```powershell
git diff --exit-code refs/remotes/origin/develop -- docs/openapi.yaml
```

Expected: exit `0` and no output.

- [ ] **Step 6: Commit the inventory reconciliation**

```powershell
git add docs/architecture/api-contract-inventory.md
git diff --cached --check
git commit -m "docs(inf-252): reconcile users contract inventory"
```

Expected: one commit modifying only the API contract inventory.

---

### Task 4: Run final documentation and repository gates

**Files:**
- Verify: all files changed by Tasks 1 through 3
- Verify unchanged: `docs/openapi.yaml`
- Verify unchanged: `src/**`, `tests/**`, `docker-compose.yml`, `.github/workflows/**`

**Interfaces:**
- Consumes: All documentation changes from Tasks 1 through 3.
- Produces: Evidence that the documentation is internally consistent and did not alter runtime surfaces.

- [ ] **Step 1: Scan active migration docs for stale claims**

Run:

```powershell
$active = @(
  'docs/superpowers/specs/2026-07-27-inf-252-list-query-post-inf262-design.md',
  'docs/superpowers/plans/2026-07-27-inf-252-phase2-users-module.md',
  'docs/architecture/target-modular-mvc.md',
  'docs/architecture/api-contract-inventory.md'
)
$stale = Select-String -Path $active -Pattern 'Pagination \| \*\*none\*\*|blocked on two decisions|does `/api/users` gain pagination|searches `full_name` and `nip_nim` only|no pagination on `GET /api/users` \| \*\*unchanged'
if ($stale) { $stale; exit 1 }
```

Expected: exit `0` with no stale matches in active documents. The historical superseded file is intentionally excluded.

- [ ] **Step 2: Scan for placeholders and whitespace errors**

Run:

```powershell
$patterns = @(
  ('T' + 'BD'),
  ('T' + 'ODO'),
  ('FIX' + 'ME'),
  ('implement' + ' later'),
  ('fill in' + ' details')
)
$targets = @(
  'docs/superpowers/specs/2026-07-27-inf-252-list-query-post-inf262-design.md',
  'docs/superpowers/plans/2026-07-27-inf-252-phase2-users-module.md',
  'docs/architecture/target-modular-mvc.md',
  'docs/architecture/api-contract-inventory.md'
)
$placeholders = Select-String -Path $targets -Pattern $patterns
if ($placeholders) { $placeholders; exit 1 }
git diff --check refs/remotes/origin/develop...HEAD
```

Expected: no placeholders and no whitespace errors.

- [ ] **Step 3: Verify the diff is documentation-only**

Run:

```powershell
$changed = git diff --name-only refs/remotes/origin/develop...HEAD
$invalid = $changed | Where-Object { $_ -notmatch '^docs/' }
$changed
if ($invalid) { Write-Error "Non-doc files changed: $($invalid -join ', ')"; exit 1 }
```

Expected: every changed path begins with `docs/`.

- [ ] **Step 4: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit `0`, no ESLint errors.

- [ ] **Step 5: Run the full test suite**

Run:

```powershell
npm test
```

Expected: all suites and tests pass, including `openApiRuntimeDriftContract.test.js` and `findingsRegisterGuard.test.js`.

- [ ] **Step 6: Verify repository status and commit history**

Run:

```powershell
git status --short --branch
git log --oneline refs/remotes/origin/develop..HEAD
```

Expected: clean worktree; commits are documentation-only and include the approved design, superseding design, migration guidance, and inventory reconciliation.
