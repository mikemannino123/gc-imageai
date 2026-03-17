const { S3Client } = require('@aws-sdk/client-s3');

// Cloudflare R2 uses an S3-compatible API.
// Endpoint format: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

module.exports = r2;
