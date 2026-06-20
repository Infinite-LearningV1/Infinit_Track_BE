# INF-170 Hybrid FAHP Thesis Evidence Pack

Runner surface: Postman MCP collection `Infinite Track`, folder `FuzzyAhp`.

In this pack, the **runner** is the curated runnable request set in Postman MCP, and the **sample output** is the repo-side saved response evidence.

## Request roles

### Thesis comparison requests
- `Thesis / Legacy Combined / Discipline Monthly`
- `Thesis / Legacy Combined / WFA Monthly`
- `Thesis / Legacy Combined / Smart AC Monthly`

These requests exist to produce a uniform thesis-comparison structure using the legacy combined endpoint.

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
Legacy WFA comparison output is not live telemetry.
Dedicated WFA live proof belongs to the canonical endpoint /api/analysis/fuzzy-ahp/wfa.

## Dedicated WFA status
Dedicated WFA status: Needs Verification

## Dedicated WFA request inputs
The live-provider validation request must be run with Postman variables, not secrets:
- `wfa_lat`
- `wfa_lon`
- `wfa_radius_meters`

## Rerun workflow
1. Open Postman MCP collection `Infinite Track` / folder `FuzzyAhp`.
2. Run the three thesis comparison requests and save the exact response bodies into `postman/samples/legacy-*.json`.
3. Run `Validation / Dedicated / WFA Live` with the required `wfa_lat`, `wfa_lon`, and `wfa_radius_meters` Postman variables.
4. If the dedicated request proves `geoapify_live`, save the exact response body into `postman/samples/dedicated-wfa-live.json` and update the status to `Ready`.
5. If the dedicated request does not prove the live-provider path in the current cycle, leave the status as `Needs Verification` and record the reason.
