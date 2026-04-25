import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';

describe('config env loading in worktree-like cwd', () => {
  test('config/index.js consumes env from parent repo .env via shared loader path', async () => {
    const envBackup = { ...process.env };
    const cwdBackup = process.cwd();

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'config-env-'));

    try {
      const repoRoot = path.join(tempRoot, 'repo-root');
      const worktreeDir = path.join(repoRoot, '.worktrees', 'feature-branch');

      fs.mkdirSync(worktreeDir, { recursive: true });
      fs.writeFileSync(
        path.join(repoRoot, '.env'),
        [
          'JWT_SECRET=from-parent-env',
          'DB_HOST=parent-host',
          'DB_NAME=parent-db',
          'DB_USER=parent-user',
          'DB_PASS=parent-pass'
        ].join('\n') + '\n',
        'utf8'
      );

      delete process.env.JWT_SECRET;
      delete process.env.DB_HOST;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASS;

      process.chdir(worktreeDir);
      jest.resetModules();

      const { default: config } = await import('../src/config/index.js');

      expect(config.jwt.secret).toBe('from-parent-env');
      expect(config.db.host).toBe('parent-host');
    } finally {
      process.chdir(cwdBackup);
      process.env = { ...envBackup };
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
