import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repositoryRoot, 'deploy', 'scripts', 'persist-backend-image-tag.sh');

const resolveBash = () => {
  if (process.platform !== 'win32') {
    return 'bash';
  }

  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? 'bash';
};

const toBashPath = (value) => {
  if (process.platform !== 'win32') {
    return value;
  }

  return value
    .replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`)
    .replaceAll('\\', '/');
};

test('persisted backend image tag survives a future Docker Compose restart', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-image-tag-'));
  const environmentPath = path.join(temporaryDirectory, '.env');
  const releaseSha = '555f9b2a160c93b5e535aaefb07445b9ae98b884';

  fs.writeFileSync(
    environmentPath,
    [
      'NODE_ENV=production',
      'BACKEND_IMAGE_TAG=1b16d917f4fdaccc8ed4f053ce152b0dab0ef15f',
      'CORS_ORIGIN=https://infinite-track.tech',
      '',
    ].join('\n'),
  );

  try {
    const result = spawnSync(
      resolveBash(),
      [toBashPath(scriptPath), toBashPath(environmentPath), releaseSha],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(fs.readFileSync(environmentPath, 'utf8')).toBe(
      [
        'NODE_ENV=production',
        `BACKEND_IMAGE_TAG=${releaseSha}`,
        'CORS_ORIGIN=https://infinite-track.tech',
        '',
      ].join('\n'),
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
