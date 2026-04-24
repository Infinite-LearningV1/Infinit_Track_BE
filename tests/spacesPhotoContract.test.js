import { jest } from '@jest/globals';

describe('photo storage contract', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...envBackup,
      SPACES_ENDPOINT: 'sgp1.digitaloceanspaces.com',
      SPACES_REGION: 'sgp1',
      SPACES_BUCKET: 'infinite-track-staging-sgp1',
      SPACES_ACCESS_KEY_ID: 'test-access-key',
      SPACES_SECRET_ACCESS_KEY: 'test-secret-key'
    };
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  test('photo model exposes photo_url + storage_provider + storage_key', async () => {
    const { default: Photo } = await import('../src/models/photo.model.js');

    expect(Photo.rawAttributes.photo_url).toBeDefined();
    expect(Photo.rawAttributes.storage_provider).toBeDefined();
    expect(Photo.rawAttributes.storage_key).toBeDefined();
  });

  test('spaces helpers produce storage key and public url contract for new writes', async () => {
    const { buildUserProfilePhotoKey, buildSpacesUrl } = await import('../src/config/spaces.js');

    const storageKey = buildUserProfilePhotoKey(1, 'profile photo.jpg');
    const photoUrl = buildSpacesUrl(storageKey);

    expect(storageKey).toMatch(/^users\/1\/profile\//);
    expect(storageKey).toContain('profile-photo.jpg');
    expect(photoUrl).toContain('digitaloceanspaces.com');
    expect(photoUrl).toContain(storageKey);
  });
});
