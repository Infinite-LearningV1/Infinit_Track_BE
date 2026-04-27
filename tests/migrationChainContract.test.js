import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';

const migrationsDir = path.resolve(process.cwd(), 'src/models/migrations');
const readFile = (name) => fs.readFileSync(path.join(migrationsDir, name), 'utf8');

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
    const source = readFile('20240525120000-create-user.cjs');

    expect(source).toContain('module.exports');
    expect(source).toContain('async up');
    expect(source).toContain('async down');
  });

  test('migration files use CommonJS-only exports for sequelize-cli compatibility', () => {
    const cloudinary = readFile('20240619000000-update-photos-for-cloudinary.cjs');
    const uniqueAttendance = readFile('20260403000000-add-unique-constraint-attendance.cjs');
    const photoMetadata = readFile('20260422000000-add-photo-storage-metadata.cjs');

    expect(cloudinary).toContain('module.exports');
    expect(cloudinary).not.toContain('export default');
    expect(uniqueAttendance).toContain('module.exports');
    expect(uniqueAttendance).not.toContain('export default');
    expect(photoMetadata).toContain('module.exports');
    expect(photoMetadata).not.toContain('export default');
  });
});
