import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const readScript = (name) => fs.readFileSync(path.join(repoRoot, 'deploy/scripts', name), 'utf8');

describe('INF-278 deployment verification contract', () => {
  test('droplet verifier gates reload on syntax and proves loopback health/listener state', () => {
    const script = readScript('verify-droplet-api.sh');

    expect(script).toContain('nginx -t');
    expect(script).toContain('127.0.0.1:3005');
    expect(script).toMatch(/ss\s+-ltn/);
    expect(script).toContain('PUBLIC_LIVEZ');
    expect(script).toContain('PUBLIC_DOCS');
  });

  test('external verifier treats public port 3005 reachability as a release blocker', () => {
    const script = readScript('verify-public-ingress.sh');

    expect(script).toContain('PUBLIC_IP');
    expect(script).toContain('3005');
    expect(script).toMatch(/release blocker|must be blocked/i);
  });
});
