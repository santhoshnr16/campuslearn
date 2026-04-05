/**
 * Network connectivity utilities
 */

import axios from 'axios';
import { API_BASE_URL } from '@/services/api';

export const testConnectivity = async (): Promise<boolean> => {
  try {
    console.log('[Connectivity] Testing connection to:', API_BASE_URL);
    
    // Test basic connectivity to the server
    const response = await axios.get(`${API_BASE_URL.replace('/api/v1', '')}/health`, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    console.log('[Connectivity] Health check response:', response.data);
    return response.status === 200;
  } catch (error) {
    console.error('[Connectivity] Health check failed:', error);
    
    if (axios.isAxiosError(error)) {
      console.error('[Connectivity] Error details:', {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        url: error.config?.url,
      });
    }
    
    return false;
  }
};

export const testApiEndpoint = async (): Promise<boolean> => {
  try {
    console.log('[Connectivity] Testing API endpoint:', API_BASE_URL);
    
    // Test the actual API endpoint
    const response = await axios.get(`${API_BASE_URL}/learn/profile`, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    console.log('[Connectivity] API test response:', response.status);
    return true;
  } catch (error) {
    console.error('[Connectivity] API test failed:', error);
    
    if (axios.isAxiosError(error)) {
      console.error('[Connectivity] API Error details:', {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        url: error.config?.url,
        response: error.response?.data,
      });
    }
    
    return false;
  }
};
