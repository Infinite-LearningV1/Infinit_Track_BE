# Baseline schema

**Status:** scaffold in place, **dump not yet committed**.
**Decision:** [INF-254](https://linear.app/infinite-track-palu/issue/INF-254/backendinfra-database-schema-cannot-be-built-from-the-repository) — finding F13.

## Why this directory exists

`src/models/migrations/` contains **zero `createTable` calls**. Every file there patches a schema that already exists; the first is an explicit stub:

```js
// 20240525120000-create-user.cjs
async up() {
  // Historical alignment stub: the users table already exists in the baseline schema.
}
```

Running `npm run migrate` against an empty database therefore produces exactly one table — `sequelizemeta` — and then fails on the first migration that assumes `attendance` exists.

Consequences, in order of how much they hurt:

1. **CI cannot build a schema**, so no test can exercise real SQL. Every one of the ~926 tests mocks Sequelize, which means none of them can catch a query regression when Phase 2–5 move queries into repositories.
2. A new environment cannot be bootstrapped from this repository.
3. Disaster recovery depends on an artifact nobody versions.

## What goes here

A single structure-only dump: `db/baseline/schema.sql`.

It is applied **before** migrations. Migrations then continue to do what they already do — patch that baseline forward.

```text
empty database
   └─ db/baseline/schema.sql        ← the tables as they exist today
        └─ npm run migrate          ← the 9 existing patch migrations
             └─ integration tests
```

## Producing the dump

Run against an environment whose schema you trust. **Structure only — never include data.**

```bash
mysqldump \
  --no-data \
  --skip-add-drop-table \
  --skip-comments \
  --single-transaction \
  --set-gtid-purged=OFF \
  -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p "$DB_NAME" \
  > db/baseline/schema.sql
```

Flag by flag, because each one matters:

| Flag | Why |
|---|---|
| `--no-data` | This is a schema artifact. **Never commit production rows.** |
| `--skip-add-drop-table` | The target database is empty; `DROP TABLE` statements only add risk if someone runs this against the wrong host |
| `--skip-comments` | Removes the dump timestamp and server version, so re-dumping an unchanged schema produces an identical file and the diff stays reviewable |
| `--single-transaction` | Consistent read without locking the source |
| `--set-gtid-purged=OFF` | Keeps replication metadata out of the file |

### Before committing it, check

- [ ] **No `INSERT` statements.** `grep -c INSERT db/baseline/schema.sql` must print `0`.
- [ ] **No credentials, hostnames, or `DEFINER=` clauses** naming a real user. Strip any `DEFINER=` with `sed -i 's/DEFINER=[^ ]* //g'`.
- [ ] The table list matches what the models expect — at minimum `users`, `attendance`, `bookings`, `locations`, `photos`, `roles`, `programs`, `positions`, `divisions`, `settings`, `auth_sessions`.
- [ ] It came from an environment you would be willing to reproduce, not from a developer laptop that has drifted.

### Verify it before trusting it

```bash
docker run --rm -d --name inf-baseline-check \
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=infinite_track_test \
  -p 3307:3306 mysql:8.0

# wait for it to accept connections, then:
docker exec -i inf-baseline-check mysql -uroot -proot infinite_track_test < db/baseline/schema.sql

DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASS=root \
DB_NAME=infinite_track_test NODE_ENV=test npm run migrate

TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_USER=root TEST_DB_PASS=root \
TEST_DB_NAME=infinite_track_test npm run test:integration

docker rm -f inf-baseline-check
```

All three steps must succeed. If `npm run migrate` still fails, the dump is missing a table a migration expects, and the dump source is wrong — not the migration.

> Port 3307 is used deliberately: 3306 is usually taken by a local MySQL, and pointing this at a real development database would run migrations against it.

## Once the dump exists

Two things follow, neither of which should land before it:

1. **Wire CI.** Add a MySQL service to `.github/workflows/ci.yml`, apply `schema.sql`, run `npm run migrate`, then `npm run test:integration`. This is deliberately not wired yet — a CI step that cannot pass would break the pipeline for everyone.
2. **Grow the integration suite.** `tests/integration/usersList.integration.test.js` is the seam. Phases 2–5 extend it as queries move into repositories and query objects.

## Keeping it honest

The dump is a **second source of truth** for the schema, and second sources drift. Whatever migration adds a table from now on must add it as a real `createTable`, not as another alignment stub — otherwise this file silently becomes the only place that knows about it, and the problem it solves comes straight back.
