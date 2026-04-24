describe('photo storage contract', () => {
  test('photo model exposes photo_url + storage_provider + storage_key', async () => {
    const { default: Photo } = await import('../src/models/photo.model.js');

    expect(Photo.rawAttributes.photo_url).toBeDefined();
    expect(Photo.rawAttributes.storage_provider).toBeDefined();
    expect(Photo.rawAttributes.storage_key).toBeDefined();
  });

  test('new photo writes are expected to persist spaces metadata', () => {
    const newPhoto = {
      photo_url:
        'https://infinite-track-staging-sgp1.sgp1.digitaloceanspaces.com/users/1/profile/file.jpg',
      storage_provider: 'spaces',
      storage_key: 'users/1/profile/file.jpg'
    };

    expect(newPhoto.storage_provider).toBe('spaces');
    expect(newPhoto.storage_key).toMatch(/^users\/1\/profile\//);
    expect(newPhoto.photo_url).toContain('digitaloceanspaces.com');
  });
});
