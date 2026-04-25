import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const resolveEnvPath = (startDir = process.cwd()) => {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, '.env');

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
};

const envPath = resolveEnvPath();

dotenv.config(envPath ? { path: envPath } : undefined);

export { resolveEnvPath, envPath };
