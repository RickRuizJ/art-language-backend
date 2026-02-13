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

// Validate on module load
if (process.env.NODE_ENV === 'production') {
  validateConfig();
}

module.exports = cloudinary;
