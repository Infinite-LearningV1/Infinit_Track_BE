import fs from 'fs';
import os from 'os';
import path from 'path';

describe('worktree-aware env path resolution', () => {
  test('resolveEnvPath finds parent .env from nested worktree-like directory', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'env-loader-'));

    try {
      const repoRoot = path.join(tempRoot, 'repo-root');
      const worktreeDir = path.join(repoRoot, '.worktrees', 'feature-branch');

      fs.mkdirSync(worktreeDir, { recursive: true });
      fs.writeFileSync(path.join(repoRoot, '.env'), 'TEST_SHARED_ENV=from-parent\n', 'utf8');

      const { resolveEnvPath } = await import('../src/config/loadEnv.js');

      const resolved = resolveEnvPath(worktreeDir);

      expect(resolved).toBe(path.join(repoRoot, '.env'));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
