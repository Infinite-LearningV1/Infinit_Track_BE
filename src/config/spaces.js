const getRequiredEnv = (name) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required Spaces env: ${name}`);
  }

  return value;
};

export const getSpacesConfig = () => ({
  endpoint: getRequiredEnv('SPACES_ENDPOINT'),
  region: getRequiredEnv('SPACES_REGION'),
  bucket: getRequiredEnv('SPACES_BUCKET'),
  accessKeyId: getRequiredEnv('SPACES_ACCESS_KEY_ID'),
  secretAccessKey: getRequiredEnv('SPACES_SECRET_ACCESS_KEY')
});

let clientPromise;

const awsS3ModuleName = '@aws-sdk/client-s3';

const createClient = async () => {
  const { S3Client } = await import(awsS3ModuleName);
  const config = getSpacesConfig();

  return new S3Client({
    region: config.region,
    endpoint: `https://${config.endpoint}`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
};

const getClient = async () => {
  if (!clientPromise) {
    clientPromise = createClient();
  }

  return clientPromise;
};

const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/');

export const buildSpacesUrl = (key) => {
  const { endpoint, bucket } = getSpacesConfig();
  return `https://${bucket}.${endpoint}/${encodeKey(key)}`;
};

const sanitizeFilename = (filename = 'photo.jpg') =>
  filename
    .split(/[\\/]/)
    .pop()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '') || 'photo.jpg';

export const buildUserProfilePhotoKey = (userId, originalName) => {
  const timestamp = Date.now();
  const safeName = sanitizeFilename(originalName);
  return `users/${userId}/profile/${timestamp}-${safeName}`;
};

export const putSpacesObject = async ({ key, body, contentType }) => {
  const client = await getClient();
  const { PutObjectCommand } = await import(awsS3ModuleName);
  const { bucket } = getSpacesConfig();

  return client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
};

export const uploadBufferToSpaces = async ({ key, buffer, contentType }) => {
  await putSpacesObject({
    key,
    body: buffer,
    contentType
  });

  return {
    key,
    url: buildSpacesUrl(key)
  };
};

export const deleteSpacesObject = async (key) => {
  const client = await getClient();
  const { DeleteObjectCommand } = await import(awsS3ModuleName);
  const { bucket } = getSpacesConfig();

  return client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );
};

export default {
  buildSpacesUrl,
  buildUserProfilePhotoKey,
  putSpacesObject,
  uploadBufferToSpaces,
  deleteSpacesObject
};
