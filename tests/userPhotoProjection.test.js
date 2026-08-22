import {
  buildUserPhotoInclude,
  mapUserPhotoProjection
} from '../src/utils/userPhotoProjection.js';

const Photo = { modelName: 'Photo' };

test('builds an explicit optional lightweight photo include', () => {
  expect(buildUserPhotoInclude(Photo)).toEqual({
    model: Photo,
    as: 'photo_file',
    attributes: ['photo_url', 'photo_updated_at'],
    required: false
  });
});

test('maps persisted photo evidence without rewriting it', () => {
  const photoUpdatedAt = new Date('2026-08-10T08:30:00.000Z');

  expect(mapUserPhotoProjection({
    photo_file: {
      photo_url: 'https://cdn.example.com/users/7/profile/photo.jpg',
      photo_updated_at: photoUpdatedAt
    }
  })).toEqual({
    photo: 'https://cdn.example.com/users/7/profile/photo.jpg',
    photo_updated_at: photoUpdatedAt
  });
});

test('returns explicit nulls when photo evidence is absent', () => {
  expect(mapUserPhotoProjection(null)).toEqual({
    photo: null,
    photo_updated_at: null
  });
  expect(mapUserPhotoProjection({ photo_file: null })).toEqual({
    photo: null,
    photo_updated_at: null
  });
});
