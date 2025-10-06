// pages/api/auth/callback.ts

import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { supabase } from '../../../lib/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("--- AUTH CALLBACK RECEIVED ---"); // Heartbeat log for this endpoint

  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    console.error("Authorization code is missing from callback request.");
    return res.status(400).send('Authorization code is missing.');
  }

  const clientId = process.env.NEXT_PUBLIC_MONDAY_CLIENT_ID;
  const clientSecret = process.env.MONDAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Server configuration error: Client ID or Secret is not set.");
    return res.status(500).send('Server configuration error.');
  }

  // CRITICAL: Construct the exact Redirect URL that is configured in your monday.com app settings.
  // We need the protocol and hostname, which we can get from Vercel's headers.
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const host = req.headers.host;
  const redirectUri = `${protocol}://${host}/api/auth/callback`;

  console.log("Attempting to exchange code for a token with redirect URI:", redirectUri);

  try {
    // 1. Exchange the code for a permanent access token
    const tokenResponse = await axios.post('https://auth.monday.com/oauth2/token', {
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri, // <-- THE CRITICAL MISSING PARAMETER
    });
    
    const accessToken = tokenResponse.data.access_token;
    console.log("Successfully received access token.");

    // 2. Use the token to get the user's account ID
    const query = 'query { me { account { id } } }';
    const accountResponse = await axios.post(
      'https://api.monday.com/v2',
      { query },
      { headers: { Authorization: accessToken, 'Content-Type': 'application/json' } }
    );

    const accountId = accountResponse.data.data.me.account.id;
    if (!accountId) {
      throw new Error('Could not retrieve monday.com account ID from API.');
    }
    console.log(`Successfully retrieved accountId: ${accountId}`);

    // 3. Save the credentials securely to Supabase
    const { error } = await supabase
      .from('accounts')
      .upsert({ account_id: accountId, access_token: accessToken }, { onConflict: 'account_id' });

    if (error) {
      console.error('Supabase error during upsert:', error);
      throw error;
    }
    console.log(`Successfully saved credentials for accountId: ${accountId} to Supabase.`);

    // 4. Redirect to the success page
    res.redirect(`https://auth.monday.com/oauth2/authorize/success`);

  } catch (error: any) {
    // Log detailed error information from the API call if available
    if (error.response) {
      console.error('API Error during token exchange:', error.response.data);
    } else {
      console.error('An error occurred during the OAuth callback:', error.message);
    }
    res.status(500).send('An error occurred during authentication.');
  }
}