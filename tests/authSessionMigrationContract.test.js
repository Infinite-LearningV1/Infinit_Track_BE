import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const migrationsDir = path.resolve('src/models/migrations');

describe('Auth session migration contract', () => {
  it('provides an auth session migration with executable up and down handlers', async () => {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((fileName) => /auth.*session/i.test(fileName));

    expect(files).toHaveLength(1);

    const migrationPath = path.join(migrationsDir, files[0]);
    const migrationModule = await import(pathToFileURL(migrationPath).href);
    const migration = migrationModule.default || migrationModule;

    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });
});
