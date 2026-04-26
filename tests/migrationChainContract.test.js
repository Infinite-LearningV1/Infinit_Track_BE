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

  test('legacy cloudinary migrations export callable up/down methods', async () => {
    const migrationCjs = await import('../src/models/migrations/20240619000000-update-photos-for-cloudinary.cjs');
    const migrationJs = await import('../src/models/migrations/20240619000000-update-photos-for-cloudinary.js');

    expect(typeof migrationCjs.default?.up || typeof migrationCjs.up).toBe('function');
    expect(typeof migrationCjs.default?.down || typeof migrationCjs.down).toBe('function');
    expect(typeof migrationJs.default?.up || typeof migrationJs.up).toBe('function');
    expect(typeof migrationJs.default?.down || typeof migrationJs.down).toBe('function');
  });

  test('legacy create-user migration is documented as a no-op stub rather than an empty commented file', () => {
    const source = readFile('20240525120000-create-user.cjs');

    expect(source).toContain('module.exports');
    expect(source).toContain('async up');
    expect(source).toContain('async down');
  });

  test('legacy cloudinary JS migration keeps the guarded ESM/CommonJS export pattern', () => {
    const source = readFile('20240619000000-update-photos-for-cloudinary.js');

    expect(source).toContain('export default migration');
    expect(source).toContain("typeof module !== 'undefined'");
  });

  test('modern JS migrations keep the guarded ESM/CommonJS export pattern', () => {
    const uniqueAttendance = readFile('20260403000000-add-unique-constraint-attendance.js');
    const photoMetadata = readFile('20260422000000-add-photo-storage-metadata.js');
    const operationalSettings = readFile('20260424000000-bootstrap-operational-settings.js');

    expect(uniqueAttendance).toContain('export default migration');
    expect(uniqueAttendance).toContain("typeof module !== 'undefined'");
    expect(photoMetadata).toContain('export default migration');
    expect(photoMetadata).toContain("typeof module !== 'undefined'");
    expect(operationalSettings).toContain('export default migration');
    expect(operationalSettings).toContain("typeof module !== 'undefined'");
  });
});
