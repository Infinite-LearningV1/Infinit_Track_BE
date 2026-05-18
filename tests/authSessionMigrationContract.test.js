import path from 'path';
import { pathToFileURL } from 'url';

const migrationsDir = path.resolve('src/models/migrations');
const authSessionMigrationFile = '20260511000000-create-auth-sessions.cjs';

describe('Auth session migration contract', () => {
  it('provides the auth session migration with executable up and down handlers', async () => {
    const migrationPath = path.join(migrationsDir, authSessionMigrationFile);
    const migrationModule = await import(pathToFileURL(migrationPath).href);
    const migration = migrationModule.default || migrationModule;

    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });
});
