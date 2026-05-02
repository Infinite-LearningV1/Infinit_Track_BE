# api.infinite-track.tech Deploy Notes

Date: 2026-04-27

## Target

Backend base URL: https://api.infinite-track.tech  
Droplet: it-backend-staging-sgp1 / 168.144.33.33  
Runtime: Docker container behind host Nginx  
Database: DigitalOcean managed MySQL cluster it-mysql-staging-sgp1

## Verification Evidence

DNS verification:

```text
A record: api.infinite-track.tech -> 168.144.33.33
DigitalOcean domain record present for host `api`
verify-droplet-api.sh:
Resolved IPv4: 168.144.33.33
DNS_OK
```

Container verification:

```text
NAMES               STATUS                       PORTS
infinit-track-app   Up About an hour (healthy)
```

Internal health verification:

```text
curl http://127.0.0.1:3005/health
{"status":"OK","timestamp":"2026-04-27T12:15:48.209Z"}
```

Nginx verification:

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
HTTP redirect:
HTTP/1.1 301 Moved Permanently
Location: https://api.infinite-track.tech/health
```

Public HTTPS health verification:

```text
curl https://api.infinite-track.tech/health
{"status":"OK","timestamp":"2026-04-27T10:15:55.953Z"}
```

Non-health endpoint verification:

```text
curl --include https://api.infinite-track.tech/api
HTTP/1.1 404 Not Found
{"message":"Route not found"}
```

Database connectivity verification:

```text
DNS_OK 10.104.0.3 4
TCP_OK private-it-mysql-staging-sgp1-do-user-35565539-0.i.db.ondigitalocean.com 25060
MYSQL_OK [{"ok":1}]
```

Verification script result:

```text
DNS_OK
LOCAL_HEALTH_OK
NGINX_CONFIG_OK
PUBLIC_HEALTH_OK
```

## Runtime Notes

- Droplet-side Docker bridge DNS could not reliably resolve external or private hostnames.
- As a deployment workaround, the running container uses `network_mode: host` on the droplet.
- The repository Nginx template is intentionally HTTP-only for first bootstrap; Certbot augments the active host config with the final HTTPS server block and redirect.
- The active container inspect result reported:

```text
host
```

- Managed MySQL connectivity succeeded only after setting:

```text
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
```

This is a staging workaround for DigitalOcean managed MySQL TLS chain handling inside the current image/runtime.

## Migration Status

Baseline bootstrap result:

```text
Imported /opt/infinite-track/backend/v1_infinite_track.sql into defaultdb
Session override used during import:
SET SESSION sql_require_primary_key=0
```

Final migration status:

```text
up 20240525120000-create-user.cjs
up 20240619000000-update-photos-for-cloudinary.cjs
up 20260403000000-add-unique-constraint-attendance.cjs
up 20260422000000-add-photo-storage-metadata.cjs
up 20260423010000-add-attendance-date-index.cjs
up 20260424000000-bootstrap-operational-settings.cjs
```

Migration root-cause summary:

```text
1. Managed MySQL target was initially empty except SequelizeMeta.
2. Deploy source had to be normalized to CommonJS migration artifacts (.cjs, no export default).
3. Baseline SQL import needed a session-level sql_require_primary_key=0 override because the dump adds some primary keys later via ALTER TABLE.
```

## Risk Notes

1. **Service availability:** SUCCESS — public HTTPS base URL is online and `/health` is healthy.
2. **Database connectivity:** SUCCESS — MySQL DNS/TCP/query path is proven.
3. **Schema convergence:** SUCCESS — baseline import completed and all tracked migrations are now `up`.
4. **Docker runtime design drift:** NEEDS FOLLOW-UP — deployment currently relies on `network_mode: host` as a workaround for Docker bridge DNS failure on the droplet.
5. **TLS hardening:** NEEDS FOLLOW-UP — `DB_SSL_REJECT_UNAUTHORIZED=false` is a temporary staging compromise; proper CA trust should replace this.
6. **Baseline import method:** NEEDS DOCUMENTATION — this staging bootstrap used `v1_infinite_track.sql` plus a session-level `sql_require_primary_key=0` override; this should be documented as an explicit bootstrap path or replaced with a formal bootstrap migration.
7. **Secret rotation:** REQUIRED FOLLOW-UP — secrets exposed earlier in session/chat should be rotated after deployment stabilization.

## Client-Critical Smoke Gate

Latest run timestamp: 2026-05-02 (live rerun after the attendance-readiness and WFA branch orchestration fixes)  
Collection: `Infinite Track - Client Critical Smoke Gate (Staging)` (`postman/client-critical-smoke-gate.collection.json`)  
Environment: `Infinite Track - Staging Live Gate` (`postman/infinite-track-staging-live-gate.environment.template.json`; runtime values supplied via a temporary ignored Newman environment file)  
Runner: `npx --yes newman` 6.2.2 against `https://api.infinite-track.tech`

Result: **ASSERTION PASS WITH LIVE-FIXTURE CAVEAT**

Resolved setup-blocker evidence:

```text
Original blocked path:
PATCH https://api.infinite-track.tech/api/bookings/{id}
with stale Employee cookie + explicit Management Bearer token
returned 403 Forbidden as Employee.

Runtime fixes now live in staging:
1. verifyToken prefers Authorization Bearer token over cookie token.
2. login no longer reuses a valid cookie token when it belongs to a different authenticated user.

Fresh live repro after patch:
- Employee created booking_id=104
- Management login returned a Management token
- PATCH /api/bookings/104 with stale Employee cookie + explicit Management bearer token returned 200 OK
- Response:
{"success":true,"message":"Booking berhasil di-approved.","data":{"booking_id":104,"status":"approved"}}
```

Attendance-readiness blocker status:

```text
The earlier WFO blocker on 2026-05-01 was not a broken attendance contract.
`GET /api/attendance/status-today` showed:
- `can_check_in=false`
- `holiday_checkin_enabled=false`
- `is_holiday=[{"name":"Hari Buruh Internasional"}]`

Manual live repro of the same mutation returned:
{"success":false,"message":"Check-in tidak diizinkan pada hari libur."}

Collection orchestration has since been updated so WFO/WFH mutation paths no longer treat
that readiness state as a contract failure.
```

Latest live rerun evidence:

```text
Run summary:
- iterations: 1 executed / 0 failed
- requests: 41 executed / 0 failed
- test-scripts: 41 executed / 0 failed
- prerequest-scripts: 50 executed / 0 failed
- assertions: 70 executed / 0 failed
- total run duration: 18.7s

Earlier intermediate rerun before the final WFA branch fix:
- requests: 32
- assertions: 55
- failed assertions: 5
- all failures were isolated to `05 WFA - New Booking`
```

What changed in the smoke gate collection:

- Negative duplicate/fixture-dependent checks now skip only after a proven holiday-blocked WFO readiness path; they no longer treat any missing live fixture as an acceptable skip reason.
- WFO/WFH attendance mutation paths now treat skip as valid only for the known holiday-readiness contract (`400`, `success=false`, exact holiday message), not for generic `can_check_in=false` outcomes.
- `05 WFA - New Booking` no longer corrupts downstream steps when the live seed booking cannot be created, but the skip path is now limited to known duplicate-style `409` conflicts with allowlisted backend messages.
- Approval/check-in steps in the new-booking branch now skip forward explicitly when `newBookingId` was never created.
- Cleanup delete steps no longer accept `500` as a normal outcome; only explicit non-residue outcomes (`200`, `404`, `409`) are accepted.
- Residue verification now checks tracked booking and attendance IDs against history responses instead of only proving that the history endpoints are reachable.

Live caveat that still matters:

```text
`05 WFA - New Booking / Create Booking - New` can still hit a live-state conflict
depending on fixture availability for the target day. The current collection only treats
that as a valid skip when the backend returns HTTP 409 with one of the known duplicate-style
messages (`Booking WFA sudah ada untuk tanggal tersebut.` or `Anda sudah memiliki booking
pada tanggal tersebut.`). In that condition, the collection skips the dependent approval and
check-in happy-path steps instead of producing false downstream failures.
```

Operational conclusion from the latest rerun:

- The stale-cookie auth blocker is resolved in live staging.
- The earlier attendance-readiness holiday blocker has been converted from a false failure into readiness-aware orchestration.
- The smoke gate now completes without failed assertions.
- However, the latest green rerun is not the same as full proof that the WFA new-booking happy path always executes end-to-end on the current live fixture state.

Repo-side regression verification:

```text
Command:
npm test -- --runInBand --testPathIgnorePatterns='[]' --runTestsByPath tests/authJwtTokenPrecedence.test.js tests/authLoginCookieReuse.test.js tests/attendanceStatusCurrentAttendance.test.js tests/geofenceJakartaDateString.test.js tests/clientCriticalSmokeGateCollectionContract.test.js

Result:
PASS tests/authJwtTokenPrecedence.test.js
PASS tests/authLoginCookieReuse.test.js
PASS tests/attendanceStatusCurrentAttendance.test.js
PASS tests/geofenceJakartaDateString.test.js
PASS tests/clientCriticalSmokeGateCollectionContract.test.js
Test Suites: 5 passed, 5 total
Tests: 29 passed, 29 total
```

Notes:

- The repository Jest config ignores `/.worktrees/` by default, so worktree-local test execution required a CLI override for `testPathIgnorePatterns`.
- These tests verify the auth regressions that blocked the earlier approval path, plus the runtime attendance/date and smoke-gate orchestration contracts, but they do not replace live fixture proof for every business path.
- Full repo verification after the final auth error-handling patch passed: 30 test suites / 122 tests, plus ESLint with the explicit worktree config.
- The active blocker is no longer attendance readiness; the remaining uncertainty is live WFA new-booking fixture availability at rerun time.

Cleanup / residue notes:

- Prior failed-run residue cleanup remained valid:

```text
API cleanup executed for failed setup residue:
- DELETE /api/bookings/103 returned 200

Post-cleanup API residue check:
{"bookingsStatus":200,"smokeBookings":[],"attendanceStatus":200,"smokeAttendance":[]}
```

- No smoke-gate booking residue remained visible in Management booking history after cleanup.
- No smoke-gate attendance residue remained visible in Management attendance history after cleanup.
- Temporary Newman runtime artifacts were removed and must not be committed.

Final recommendation: **NEEDS VERIFICATION FOR PROMOTION DECISIONS**

Interpretation:

- If the release question is “does the client-critical suite still fall over because of stale-cookie auth or holiday-readiness orchestration?” the answer is **no**.
- If the release question is “do we already have clean live proof that every intended happy-path, including WFA new booking creation, executed end-to-end without skip conditions?” the answer is **not yet**.

Promotion guidance:

1. Treat the current gate as **operationally stable** for detecting the earlier false blockers.
2. Before using this artifact as final promotion proof, rerun once more on a day/fixture state where `05 WFA - New Booking` can create a fresh booking without conflict, then capture that artifact timestamp exactly.
3. If that proof is not required for the immediate decision, document explicitly that the current green run is assertion-clean but includes readiness/fixture-aware skip behavior.
## Docs / ADR Update Note

This deployment introduced two architecture-significant operational deviations that should be documented before production promotion:

- Docker runtime on droplet currently depends on `network_mode: host` due to Docker bridge DNS failure.
- Managed MySQL TLS verification is temporarily relaxed with `DB_SSL_REJECT_UNAUTHORIZED=false`.
