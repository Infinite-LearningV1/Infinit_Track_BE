import { jest } from '@jest/globals';

describe('env loading from git worktree cwd', () => {
  const originalCloudinaryEnv = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET
  };

  beforeEach(() => {
    jest.resetModules();
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalCloudinaryEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test('imports cloudinary config without throwing when cwd is a worktree', async () => {
    expect(process.cwd()).toContain('.worktrees');

    await expect(import('../src/config/cloudinary.js')).resolves.toBeDefined();

    expect(process.env.CLOUDINARY_CLOUD_NAME).toBeTruthy();
    expect(process.env.CLOUDINARY_API_KEY).toBeTruthy();
    expect(process.env.CLOUDINARY_API_SECRET).toBeTruthy();
  });
});
