# INF-170 Hybrid FAHP Thesis Evidence Pack

Runner surface: Postman MCP collection `Infinite Track`, folder `FuzzyAhp`.

In this pack, the **runner** is the curated runnable request set in Postman MCP, and the **sample output** is the repo-side saved response evidence.

## Request roles

### Thesis comparison requests
- `Thesis / Legacy Combined / Discipline Monthly`
- `Thesis / Legacy Combined / Smart AC Monthly`

These requests produce the retained thesis-comparison structures from the legacy combined endpoint.

### WFA migration check
- `Migration / Legacy Combined / WFA`

This request must return `410 WFA_ANALYSIS_MOVED`. It exists only to verify that old clients are directed to the dedicated WFA endpoint; it is not thesis comparison output.

### Live validation request
- `Validation / Dedicated / WFA Live`

This request exists to prove canonical live-provider WFA behavior.

## Evidence files
- `postman/samples/legacy-discipline-monthly.json`
- `postman/samples/legacy-wfa-monthly.json`
- `postman/samples/legacy-smart-ac-monthly.json`
- `postman/samples/dedicated-wfa-live.json`

## Bab 4 / abstract fields
- `consistency`
- `weights`
- `ranking`
- `distribution`
- `generated_at`
- `window`
- `timezone`

## WFA caveat
Legacy WFA combined requests are 410 migration checks, not thesis comparison output.
Dedicated WFA live proof belongs to the canonical endpoint /api/analysis/fuzzy-ahp/wfa.

## Dedicated WFA status
Dedicated WFA status: Needs Verification
Last verified request: Validation / Dedicated / WFA Live
Reason: authenticated live execution blocked by Claude Code auto mode before current-cycle geoapify_live proof could be captured

## Dedicated WFA request inputs
The live-provider validation request must be run with Postman variables, not secrets:
- `wfa_lat`
- `wfa_lon`
- `wfa_schedule_date` (strict future WIB date, `YYYY-MM-DD`)
- `wfa_radius_meters`

## Rerun workflow
1. Open Postman MCP collection `Infinite Track` / folder `FuzzyAhp`.
2. Run the Discipline and Smart AC thesis comparison requests and save the exact response bodies into their `postman/samples/legacy-*.json` files.
3. Run `Migration / Legacy Combined / WFA` and verify the exact `410 WFA_ANALYSIS_MOVED` body in `postman/samples/legacy-wfa-monthly.json`.
4. Run `Validation / Dedicated / WFA Live` with the required `wfa_lat`, `wfa_lon`, `wfa_schedule_date`, and `wfa_radius_meters` Postman variables.
5. If the dedicated request proves the canonical facility-evidence response, save the exact response body into `postman/samples/dedicated-wfa-live.json` and update the status to `Ready`.
6. If the dedicated request does not prove the live-provider path in the current cycle, leave the status as `Needs Verification` and record the reason.
