import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const resolveEnvPath = (startDir = process.cwd()) => {
  for (
    let currentDir = path.resolve(startDir), parentDir = '';
    currentDir !== parentDir;
    parentDir = currentDir, currentDir = path.dirname(currentDir)
  ) {
    const candidate = path.join(currentDir, '.env');

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
};

const envPath = resolveEnvPath();

dotenv.config(envPath ? { path: envPath } : undefined);

export { resolveEnvPath, envPath };
