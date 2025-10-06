// pages/api/auth/callback.ts

import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { supabase } from '../../../lib/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.query;

  // If there is no code, it might be the start of the flow, or an error.
  // We will redirect to a success page immediately to get off this URL.
  if (!code || typeof code !== 'string') {
    res.redirect('/success.html');
    return;
  }

  // Immediately redirect the user's browser to the success page.
  // This gets them off the URL with the sensitive 'code' and prevents refreshes.
  res.redirect('/success.html');

  // NOW, with the user safely redirected, we do the server-to-server work in the background.
  try {
    const clientId = process.env.NEXT_PUBLIC_MONDAY_CLIENT_ID;
    const clientSecret = process.env.MONDAY_CLIENT_SECRET;
    const host = req.headers.host;
    const redirectUri = `https://${host}/api/auth/callback`;

    const tokenResponse = await axios.post('https://auth.monday.com/oauth2/token', {
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    
    const accessToken = tokenResponse.data.access_token;
    
    const query = 'query { me { account { id } } }';
    const accountResponse = await axios.post(
      'https://api.monday.com/v2',
      { query },
      { headers: { Authorization: accessToken, 'Content-Type': 'application/json' } }
    );

    const accountId = accountResponse.data?.data?.me?.account?.id;
    if (!accountId) {
      throw new Error('Could not retrieve account ID from monday API.');
    }

    await supabase
      .from('accounts')
      .upsert({ account_id: accountId, access_token: accessToken }, { onConflict: 'account_id' });

    console.log(`SUCCESS: Credentials for account ${accountId} saved.`);

  } catch (error: any) {
    if (error.response) {
      console.error('API Error during token exchange:', error.response.data);
    } else {
      console.error('An error occurred during the OAuth callback background process:', error.message);
    }
  }
}