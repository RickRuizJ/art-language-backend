const cloudinary = require('cloudinary').v2;

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Validate Cloudinary configuration
 * Throws error if any required env var is missing
 */
function validateConfig() {
  const required = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing Cloudinary configuration: ${missing.join(', ')}`);
  }
}

// Do not crash the entire LMS at boot if the upload integration is misconfigured.
// Upload endpoints call this validator and return a clear 503 instead.
cloudinary.assertConfigured = validateConfig;

module.exports = cloudinary;
