const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Cache Apple's public keys for 24 hours to avoid hammering their endpoint
const appleJwksClient = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  cacheMaxAge: 24 * 60 * 60 * 1000,
  rateLimit: true,
  jwksRequestsPerMinute: 5,
});

/**
 * Verifies an Apple identity token (signed JWT from ASAuthorizationAppleIDCredential).
 *
 * @param {string} identityToken  - Base64-encoded JWT from the iOS SDK
 * @returns {Promise<object>}       JWT payload including sub (Apple user ID), email, etc.
 * @throws if token is invalid, expired, or doesn't match this app
 */
async function verifyAppleIdentityToken(identityToken) {
  return new Promise((resolve, reject) => {
    const getKey = (header, callback) => {
      appleJwksClient.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        callback(null, key.getPublicKey());
      });
    };

    jwt.verify(
      identityToken,
      getKey,
      {
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
        audience: process.env.APPLE_APP_BUNDLE_ID,
      },
      (err, payload) => {
        if (err) return reject(err);
        resolve(payload);
      }
    );
  });
}

module.exports = { verifyAppleIdentityToken };
