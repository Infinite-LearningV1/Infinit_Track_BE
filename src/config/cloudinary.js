import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

// Validate required environment variables
const requiredEnvVars = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
};

// Check if all required variables are present
const missingVars = Object.entries(requiredEnvVars)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.error('Missing Cloudinary environment variables:', missingVars);
  throw new Error(`Missing required Cloudinary environment variables: ${missingVars.join(', ')}`);
}

// Configure Cloudinary
cloudinary.config({
  cloud_name: requiredEnvVars.cloud_name,
  api_key: requiredEnvVars.api_key,
  api_secret: requiredEnvVars.api_secret,
  secure: true
});

// Verify configuration (without exposing sensitive data)
console.log('Cloudinary configured successfully with cloud_name:', requiredEnvVars.cloud_name);

export default cloudinary;
