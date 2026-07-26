import { Sequelize } from 'sequelize';

/**
 * Integration coverage against a real MySQL schema (INF-252 Phase 0c).
 *
 * The rest of the suite mocks Sequelize, which means it cannot detect SQL
 * regressions when queries move into repositories and query objects during
 * Phases 2-5. This file is the seam that can.
 *
 * Requires a disposable database that has had `db/baseline/schema.sql` applied
 * and then `npm run migrate` run against it. Invoke via
 * `npm run test:integration`; it is excluded from the default `npm test`.
 *
 * STATUS: cannot pass until the baseline dump is committed. The migration set
 * contains no createTable calls (finding F13), so migrations alone leave an
 * empty database holding only `sequelizemeta`. See db/baseline/README.md for
 * the procedure and INF-254 for the decision.
 *
 * This file is the seam Phases 2-5 extend as queries move into repositories.
 * CI does not run it yet -- wiring a step that cannot pass would break the
 * pipeline for everyone.
 */

const {
  TEST_DB_HOST = '127.0.0.1',
  TEST_DB_PORT = '3306',
  TEST_DB_USER = 'root',
  TEST_DB_PASS = 'root',
  TEST_DB_NAME = 'infinite_track_test'
} = process.env;

let sequelize;

beforeAll(async () => {
  sequelize = new Sequelize(TEST_DB_NAME, TEST_DB_USER, TEST_DB_PASS, {
    host: TEST_DB_HOST,
    port: Number(TEST_DB_PORT),
    dialect: 'mysql',
    timezone: '+07:00',
    logging: false
  });
  await sequelize.authenticate();

  // Fail with something actionable rather than a bare "table doesn't exist".
  const [tables] = await sequelize.query(
    'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
    { replacements: [TEST_DB_NAME] }
  );

  if (Number(tables[0].n) <= 1) {
    throw new Error(
      `Database "${TEST_DB_NAME}" has no schema (only ${tables[0].n} table). ` +
        'Apply db/baseline/schema.sql before running migrations -- see ' +
        'db/baseline/README.md. Migrations alone cannot create the schema (F13).'
    );
  }
});

afterAll(async () => {
  if (sequelize) {
    await sequelize.close();
  }
});

describe('users list query against real MySQL', () => {
  it('connects to the migrated test schema', async () => {
    const [rows] = await sequelize.query('SELECT DATABASE() AS db');
    expect(rows[0].db).toBe(TEST_DB_NAME);
  });

  it('exposes the users table with the columns the list endpoint selects', async () => {
    const [columns] = await sequelize.query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      { replacements: [TEST_DB_NAME, 'users'] }
    );
    const names = columns.map((c) => c.COLUMN_NAME);
    expect(names).toEqual(
      expect.arrayContaining(['id_users', 'full_name', 'nip_nim', 'email'])
    );
  });

  it('runs the LIKE search shape the list endpoint uses', async () => {
    const [rows] = await sequelize.query(
      'SELECT id_users FROM users WHERE full_name LIKE ? LIMIT 10',
      { replacements: ['%zzz-no-match-zzz%'] }
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  it('honours the Asia/Jakarta offset on the connection', async () => {
    const [rows] = await sequelize.query("SELECT TIME_FORMAT(TIMEDIFF(NOW(), UTC_TIMESTAMP()), '%H:%i') AS offset");
    expect(rows[0].offset).toBe('07:00');
  });
});
