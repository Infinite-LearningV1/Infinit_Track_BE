export const buildUserPhotoInclude = (PhotoModel) => ({
  model: PhotoModel,
  as: 'photo_file',
  attributes: ['photo_url', 'photo_updated_at'],
  required: false
});

export const mapUserPhotoProjection = (user) => ({
  photo: user?.photo_file?.photo_url ?? null,
  photo_updated_at: user?.photo_file?.photo_updated_at ?? null
});
