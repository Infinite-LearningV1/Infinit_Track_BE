# INF-252 Phase 2 — Allowlisted List-Query Foundation: Design Spec

**Linear:** [INF-252](https://linear.app/infinite-track-palu/issue/INF-252/backendarchitecture-adopt-modular-mvc-per-feature-with-safe), [INF-250](https://linear.app/infinite-track-palu/issue/INF-250/cross-repo-define-scalable-user-directory-search-filter-sort-and)
**Date:** 2026-07-27
**Status:** Superseded — historical pre-INF-262 decision record
**Superseded by:** [2026-07-27-inf-252-list-query-post-inf262-design.md](2026-07-27-inf-252-list-query-post-inf262-design.md)
**Scope:** the shared list-query foundation only. No module extraction; that is Phase 3 onwards.

> Historical boundary: the facts and recommendations below describe the repository before INF-250 was decided and INF-262 landed in PR #129. Do not use this document to implement the Users query extraction.

---

## 1. Why this document exists now

Phase 0 characterized every endpoint. That turned the list-query problem from a vague intention into a measured one: there are **three list surfaces in this codebase and three different contracts**, and no document previously said so.

This spec does not decide between them. It lays out what each choice costs, so [INF-250](https://linear.app/infinite-track-palu/issue/INF-250/cross-repo-define-scalable-user-directory-search-filter-sort-and) can be settled with the facts in view.

## 2. Fact base

All verified against `develop`, and pinned by the Phase 0b test suite.

### 2.1 Three surfaces, three contracts

| | `GET /api/users` | `GET /api/attendance` | `GET /api/summary/reports` |
|---|---|---|---|
| Pagination | **none** | full | full |
| Count key | — | `total_records` | `total_items` |
| Page-size key | — | `records_per_page` | `items_per_page` |
| `pagination` position | — | sibling of `data` | sibling of `data` |
| Search fields | `full_name`, `nip_nim` | `$user.full_name$`, `$user.nip_nim$` | **six**, incl. `$user.email$`, `$user.role.role_name$`, `$status.attendance_status_name$`, `$attendance_category.category_name$` |
| Sort | `sortBy` + `sortOrder`, unvalidated | fixed `id_attendance DESC` | — |

**The two paginated surfaces use different key names for the same two concepts.** A client consuming both must handle `total_records` *and* `total_items`, `records_per_page` *and* `items_per_page`. Recorded as F39.

`/api/users` returns every non-deleted user in one response (F20).

### 2.2 The shared primitive is defective

`src/utils/searchHelper.js` backs all three. `tests/searchHelperContract.test.js` pins three defects:

| | |
|---|---|
| F2 | Mutates the caller's options in place and returns the same reference |
| F3 | Does not escape LIKE metacharacters — `%` searches match every row |
| F37 | A **second** call silently discards the first predicate, because the predicate lives under the symbol key `Op.or` and the guard uses `Object.keys` |

F37 is latent today — every call site invokes it once. **Composition is exactly what this phase introduces**, so it becomes live the moment the foundation layers a search onto a filter.

### 2.3 The documented contract matches none of them

`docs/openapi.yaml` describes both `/api/users` and `/api/attendance` as returning `data: { <items>, pagination }`. Both actually return `data` as a flat array. Four documented filters do not exist. Recorded as F35/F36 and pinned by `tests/openApiRuntimeDriftContract.test.js`.

Whatever this phase produces, the spec has to be rewritten to match — it is currently wrong for every surface.

## 3. Decisions required before implementation

### D1 — which pagination envelope wins

| Option | Cost |
|---|---|
| **Adopt the attendance shape** (`total_records`, `records_per_page`) | Summary reports change key names; any client reading `total_items` breaks |
| **Adopt the summary shape** (`total_items`, `items_per_page`) | Attendance changes key names; the larger of the two consumer surfaces breaks |
| **Introduce a third, neutral shape** | Both change; one migration instead of two half-migrations, but nothing is spared |

There is no option where nobody changes, because the two existing shapes disagree. **Recommendation: adopt the attendance shape.** It is the busiest admin list, its envelope is already pinned by tests, and `total_records`/`records_per_page` describe rows rather than abstract "items", which matches what these endpoints return.

### D2 — does `/api/users` gain pagination

INF-250 exists to answer this. It is not a free change: the endpoint currently returns everything, so any client that renders the full directory without paging will silently start showing only the first page.

**Recommendation: yes, with an opt-out.** Default to a page size, and treat the absence of `page`/`limit` as page 1 — but publish the change loudly, because it is a behavioral break disguised as an improvement.

### D3 — what `search` covers

Three surfaces search two, two, and six fields respectively. The OpenAPI spec claims all of them search email; two do not.

**Recommendation: per-endpoint allowlists, not one global list.** A user directory searching `role_name` is surprising; a report search that cannot filter by status is useless. The mechanism is shared; the field list belongs to the feature.

## 4. Target design

### 4.1 Shape

```text
src/shared/query/
├── listQuery.js        # buildListQuery({ page, limit, sort, search }, spec) -> options
├── pagination.js       # buildPagination({ count, page, limit }) -> envelope
└── searchPredicate.js  # buildSearchPredicate(term, fields) -> a value, never a mutation
```

Each feature supplies a **spec object**, not free-form input:

```js
// src/modules/users/user.query.js
export const USER_LIST_SPEC = {
  searchable: ['full_name', 'nip_nim'],
  sortable: ['created_at', 'full_name', 'nip_nim'],
  defaultSort: ['created_at', 'DESC'],
  maxLimit: 100
};
```

### 4.2 Rules

1. **Nothing client-supplied reaches Sequelize unmapped.** A `sortBy` outside `sortable` is rejected, not passed through. This closes the hole that `sortBy`/`sortOrder` currently has on `/api/users`.
2. **`buildSearchPredicate` returns a value.** It never receives or edits query options. That removes F2 by construction and makes F37 impossible — there is no second call to a mutating function, because there is no mutating function.
3. **LIKE metacharacters are escaped.** `%` and `_` in a search term match literal characters. Fixes F3.
4. **`limit` is clamped to `maxLimit`.** F30 showed `parseInt('abc')` producing `NaN` past the guard; parsing and clamping happen in one place that rejects non-numeric input.
5. **The pagination envelope is built by one function.** Two surfaces cannot drift into different key names again.

### 4.3 What replaces `searchHelper.js`

`applySearch` and `applyMultipleSearch` are deleted once all three call sites move. `applyMultipleSearch` is already unused (F38), so it can go immediately and independently.

## 5. Verification strategy

`tests/searchHelperContract.test.js` pins current behavior including the three defects. The replacement gets its own contract test asserting the **opposite** on F2, F3 and F37 — value returned rather than mutated, wildcards escaped, composition preserving both predicates.

The Phase 0b endpoint tests are the safety net: each list surface has its envelope pinned, so a cutover that changes a response shape fails immediately rather than at review.

## 6. What blocks execution

| Blocker | Why it blocks |
|---|---|
| **`db/baseline/schema.sql`** | This phase moves query construction. Every test in the suite mocks Sequelize, so **no existing test can catch a change in the SQL that results.** Moving queries without a live-SQL harness is the one thing Phase 0 was built to avoid |
| **D1 and D2 above** | The foundation's envelope and the users pagination decision determine its shape. Building first and deciding later means building twice |

D3 can be decided during implementation; the others cannot.

## 7. Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Unifying the envelope breaks a client silently | Both current shapes are pinned by tests; the change is visible in the diff and must be announced cross-repo |
| R2 | Adding pagination to `/api/users` truncates a directory a client renders whole | D2 recommends an explicit, announced break rather than a quiet default |
| R3 | The allowlist rejects a sort field some client already sends | `/api/users` currently accepts any `sortBy` unvalidated — the allowlist has to be built from observed usage, not guessed |
| R4 | Escaping wildcards changes results for users who typed `%` deliberately | Unlikely but real; worth a line in release notes |

## 8. Out of scope

Module extraction. Repository and mapper layers. Any change to the FAHP engine or reporting logic. Fixing F35/F36 in `docs/openapi.yaml` — that follows this phase, since the spec should be rewritten once against the final shape rather than twice.
