// lib/mondayApi.ts

import axios from 'axios';

const MONDAY_API_URL = 'https://api.monday.com/v2';

export async function callMondayApi(query: string, token: string) {
  try {
    const response = await axios.post(
      MONDAY_API_URL,
      { query },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error calling Monday.com API:', error.response?.data || error.message);
    throw new Error('Failed to call Monday.com API');
  }
}