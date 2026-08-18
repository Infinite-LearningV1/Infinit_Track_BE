import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const nginxRoot = path.join(repoRoot, 'deploy/nginx');
const read = (file) => fs.readFileSync(path.join(nginxRoot, file), 'utf8').replace(/\r\n/g, '\n');

describe('INF-278 tracked Nginx ingress contract', () => {
  test('tracks bootstrap and final vhosts with shared proxy directives', () => {
    const bootstrap = read('api.infinite-track.tech.bootstrap.conf');
    const finalVhost = read('api.infinite-track.tech.conf');
    const snippet = read('snippets/infinite-track-api-proxy.conf');

    expect(bootstrap).toContain('location /.well-known/acme-challenge/');
    expect(finalVhost).toContain('return 301 https://$host$request_uri;');
    expect(finalVhost).toContain('listen 443 ssl;');
    expect(finalVhost).toContain('ssl_protocols TLSv1.2 TLSv1.3;');
    expect(finalVhost).toContain('include snippets/infinite-track-api-proxy.conf;');
    expect(snippet).toContain('proxy_pass http://127.0.0.1:3005;');
    expect(snippet).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
  });

  test('uses narrow transport envelopes and no unconditional upgrade headers', () => {
    const finalVhost = read('api.infinite-track.tech.conf');
    const snippet = read('snippets/infinite-track-api-proxy.conf');

    expect(finalVhost).toContain('client_max_body_size 1m;');
    expect(finalVhost).toMatch(/location = \/api\/users\s*\{[\s\S]*client_max_body_size 25m;/);
    expect(finalVhost).toMatch(/location ~ \^\/api\/users\/[^ ]+\/photo\$\s*\{[\s\S]*client_max_body_size 25m;/);
    expect(`${finalVhost}\n${snippet}`).not.toMatch(/proxy_set_header\s+(Upgrade|Connection)\b/);
  });
});
