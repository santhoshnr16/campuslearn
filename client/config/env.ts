/**
 * Environment Configuration
 * Values from root .env file
 * 
 * For Expo development:
 * - Set these values from the root .env file using EXPO_PUBLIC_ prefix
 * - They will be injected into process.env during the build
 * 
 * To use: npm install expo-dotenv (or use .env.local for Expo)
 * Then restart the dev server: npm start
 */

// These values should come from the root .env file
// For Expo, use EXPO_PUBLIC_ prefix so they're available in the client
export const ENV_CONFIG = {
  // Development machine IP address (for physical device testing)
  // Default: 10.141.7.200
  DEV_MACHINE_IP: process.env.EXPO_PUBLIC_DEV_MACHINE_IP || 'host.docker.internal',
  
  // Use iOS Simulator (set to 'true' for simulator, 'false' for physical device)
  // Default: false
  USE_SIMULATOR: process.env.EXPO_PUBLIC_USE_SIMULATOR || 'false',

  // Production API URL (configurable via .env)
  PRODUCTION_API_URL: process.env.EXPO_PUBLIC_PRODUCTION_API_URL || '',

  // Set to 'true' to use production API even in dev mode
  USE_PRODUCTION_API: process.env.EXPO_PUBLIC_USE_PRODUCTION_API || 'false',
};

// Utility function to check if simulator is enabled
export const isSimulator = (): boolean => {
  const simulatorStr = ENV_CONFIG.USE_SIMULATOR;
  return simulatorStr !== undefined && 
         simulatorStr !== 'false' && 
         simulatorStr !== '0';
};
