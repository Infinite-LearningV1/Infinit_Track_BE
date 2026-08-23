import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productionWorkflowPath = path.join(repositoryRoot, '.github', 'workflows', 'deploy-production.yml');

test('production image publication uses only the immutable commit tag', () => {
  const workflow = fs.readFileSync(productionWorkflowPath, 'utf8');

  expect(workflow).toContain('${{ env.DOCKER_IMAGE }}:${{ github.sha }}');
  expect(workflow).not.toMatch(/\$\{\{\s*env\.DOCKER_IMAGE\s*\}\}:latest/);
  expect(workflow).not.toContain('Published rolling tag');
});
