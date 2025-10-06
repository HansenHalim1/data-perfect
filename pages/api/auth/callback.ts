// pages/api/auth/callback.ts

import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { supabase } from '../../../lib/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("--- AUTH CALLBACK RECEIVED ---");

  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    console.error("Authorization code is missing.");
    return res.status(400).send('Authorization code is missing.');
  }

  const clientId = process.env.NEXT_PUBLIC_MONDAY_CLIENT_ID;
  const clientSecret = process.env.MONDAY_CLIENT_SECRET;
  const host = req.headers.host;
  const redirectUri = `https://${host}/api/auth/callback`;

  try {
    const tokenResponse = await axios.post('https://auth.monday.com/oauth2/token', {
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    
    const accessToken = tokenResponse.data.access_token;
    console.log("Successfully received access token.");

    const query = 'query { me { account { id } } }';
    const accountResponse = await axios.post(
      'https://api.monday.com/v2',
      { query },
      { headers: { Authorization: accessToken, 'Content-Type': 'application/json' } }
    );

    // --- NEW ROBUST ERROR CHECKING ---
    // Log the entire response from monday.com for debugging
    console.log("Monday API 'me' response:", JSON.stringify(accountResponse.data, null, 2));

    if (accountResponse.data.errors) {
      throw new Error(`Monday API returned errors: ${JSON.stringify(accountResponse.data.errors)}`);
    }

    const accountId = accountResponse.data?.data?.me?.account?.id;
    if (!accountId) {
      throw new Error('Could not retrieve monday.com account ID from API response.');
    }
    console.log(`Successfully retrieved accountId: ${accountId}`);

    const { error } = await supabase
      .from('accounts')
      .upsert({ account_id: accountId, access_token: accessToken }, { onConflict: 'account_id' });

    if (error) {
      console.error('Supabase error during upsert:', error);
      throw error;
    }
    console.log(`Successfully saved credentials for accountId: ${accountId} to Supabase.`);

    res.redirect(`https://auth.monday.com/oauth2/authorize/success`);

  } catch (error: any) {
    if (error.response) {
      console.error('API Error during token exchange:', error.response.data);
    } else {
      console.error('An error occurred during the OAuth callback:', error.message);
    }
    res.status(500).send('An error occurred during authentication.');
  }
}