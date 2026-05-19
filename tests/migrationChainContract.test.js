import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';

const migrationsDir = path.resolve(process.cwd(), 'src/models/migrations');

function readMigrationFile(name) {
  return fs.readFileSync(path.join(migrationsDir, name), 'utf8');
}

describe('migration chain contract', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('database-cli targets the lower-case sequelizemeta table used by the local DB snapshot', async () => {
    const config = await import('../src/config/database-cli.cjs');

    expect(config.default?.development?.migrationStorageTableName || config.development?.migrationStorageTableName).toBe('sequelizemeta');
  });

  test('legacy create-user migration exports callable up/down methods', async () => {
    const migration = await import('../src/models/migrations/20240525120000-create-user.cjs');

    expect(typeof migration.default?.up || typeof migration.up).toBe('function');
    expect(typeof migration.default?.down || typeof migration.down).toBe('function');
  });

  test('legacy cloudinary migration exports callable up/down methods through the CommonJS file', async () => {
    const migration = await import('../src/models/migrations/20240619000000-update-photos-for-cloudinary.cjs');

    expect(typeof migration.default?.up || typeof migration.up).toBe('function');
    expect(typeof migration.default?.down || typeof migration.down).toBe('function');
  });

  test('legacy create-user migration is documented as a no-op stub rather than an empty commented file', () => {
    const source = readMigrationFile('20240525120000-create-user.cjs');

    expect(source).toContain('module.exports');
    expect(source).toContain('async up');
    expect(source).toContain('async down');
  });

  test('migration files use CommonJS-only exports for sequelize-cli compatibility', () => {
    const cloudinary = readMigrationFile('20240619000000-update-photos-for-cloudinary.cjs');
    const uniqueAttendance = readMigrationFile('20260403000000-add-unique-constraint-attendance.cjs');
    const photoMetadata = readMigrationFile('20260422000000-add-photo-storage-metadata.cjs');
    const attendanceDateIndex = readMigrationFile('20260423010000-add-attendance-date-index.cjs');
    const operationalSettings = readMigrationFile('20260424000000-bootstrap-operational-settings.cjs');
    const authSessions = readMigrationFile('20260511000000-create-auth-sessions.cjs');

    expect(cloudinary).toContain('module.exports');
    expect(cloudinary).not.toContain('export default');
    expect(uniqueAttendance).toContain('module.exports');
    expect(uniqueAttendance).not.toContain('export default');
    expect(photoMetadata).toContain('module.exports');
    expect(photoMetadata).not.toContain('export default');
    expect(attendanceDateIndex).toContain('module.exports');
    expect(attendanceDateIndex).not.toContain('export default');
    expect(operationalSettings).toContain('module.exports');
    expect(operationalSettings).not.toContain('export default');
    expect(authSessions).toContain('module.exports');
    expect(authSessions).not.toContain('export default');
  });
});
