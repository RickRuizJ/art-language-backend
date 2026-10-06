const cloudinary = require('cloudinary').v2;

function cleanEnv(name) {
  const value = process.env[name];
  if (!value) return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('\"') && trimmed.endsWith('\"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

// Configure Cloudinary with sanitized environment variables. Copy/paste into
// hosting dashboards can accidentally add whitespace or wrapping quotes, which
// makes Cloudinary signatures invalid even though all 3 variables are present.
cloudinary.config({
  cloud_name: cleanEnv('CLOUDINARY_CLOUD_NAME'),
  api_key: cleanEnv('CLOUDINARY_API_KEY'),
  api_secret: cleanEnv('CLOUDINARY_API_SECRET')
});

/**
 * Validate Cloudinary configuration
 * Throws error if any required env var is missing
 */
function validateConfig() {
  const required = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = required.filter(key => !cleanEnv(key));
  
  if (missing.length > 0) {
    throw new Error(`Missing Cloudinary configuration: ${missing.join(', ')}`);
  }
}

// Do not crash the entire LMS at boot if the upload integration is misconfigured.
// Upload endpoints call this validator and return a clear 503 instead.
cloudinary.assertConfigured = validateConfig;

module.exports = cloudinary;
