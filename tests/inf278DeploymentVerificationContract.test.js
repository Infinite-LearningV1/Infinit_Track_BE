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
    expect(script).toContain("$4 !~ /^127\\.0\\.0\\.1:3005$/");
    expect(script).not.toContain('0\\.0\\.0\\.0:3005');
  });

  test('external verifier treats public port 3005 reachability as a release blocker', () => {
    const script = readScript('verify-public-ingress.sh');

    expect(script).toContain('PUBLIC_IP');
    expect(script).toContain('DOMAIN');
    expect(script).toContain('3005');
    expect(script).toContain('--noproxy');
    expect(script).toMatch(/socket\.create_connection|nc\s+.*3005/);
    expect(script).toContain('HTTP_REDIRECT');
    expect(script).toContain('301');
    expect(script).toMatch(/release blocker|must be blocked/i);
  });

  test('production workflow runs the external ingress verifier before application smoke', () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, '.github/workflows/deploy-production.yml'),
      'utf8'
    );

    expect(workflow).toContain('verify-public-ingress.sh');
    expect(workflow).toMatch(/verify-public-ingress\.sh[\s\S]*npm run smoke-test/);
  });

  test('documents the external verifier domain and public IP inputs', () => {
    const guide = fs.readFileSync(
      path.join(repoRoot, 'docs/PRODUCTION_NGINX_INGRESS.md'),
      'utf8'
    );

    expect(guide).toContain('DOMAIN=api.infinite-track.tech PUBLIC_IP=<droplet-ip>');
    expect(guide).toContain('return `301` to the HTTPS domain');
  });
});
