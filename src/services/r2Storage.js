const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl: createPresignedUrl } = require('@aws-sdk/s3-request-presigner');
const r2 = require('../config/r2');

const BUCKET = process.env.R2_BUCKET_NAME;

/**
 * Uploads a buffer to R2.
 * @param {Buffer} buffer
 * @param {string} key          Object key (path within the bucket)
 * @param {string} contentType
 * @returns {Promise<string>}   The key that was stored
 */
async function uploadImage(buffer, key, contentType = 'image/png') {
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return key;
}

/**
 * Creates a time-limited presigned GET URL for private objects.
 * @param {string} key
 * @param {number} [expiresIn=86400]  Seconds until expiry (default 24 h)
 * @returns {Promise<string>}
 */
async function getSignedUrl(key, expiresIn = 86_400) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return createPresignedUrl(r2, command, { expiresIn });
}

/**
 * Returns the public CDN URL for an object.
 * Only use this when the bucket / folder is configured for public access.
 * @param {string} key
 * @returns {string}
 */
function getPublicUrl(key) {
  const base = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
  return `${base}/${key}`;
}

/**
 * Returns the best available URL for a generated image:
 * - Public CDN URL if R2_PUBLIC_URL is configured
 * - Otherwise a 24-hour presigned URL
 * @param {string} key
 * @returns {Promise<string>}
 */
async function getBestUrl(key) {
  if (process.env.R2_PUBLIC_URL) {
    return getPublicUrl(key);
  }
  return getSignedUrl(key);
}

/**
 * Deletes an object from R2.
 */
async function deleteObject(key) {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { uploadImage, getSignedUrl, getPublicUrl, getBestUrl, deleteObject };
