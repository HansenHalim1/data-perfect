// pages/api/auth/callback.ts

import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { supabase } from '../../../lib/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    return res.status(400).send('Authorization code is missing.');
  }

  const clientId = process.env.NEXT_PUBLIC_MONDAY_CLIENT_ID;
  const clientSecret = process.env.MONDAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).send('Server configuration error.');
  }

  try {
    const tokenResponse = await axios.post('https://auth.monday.com/oauth2/token', {
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
    });
    
    const accessToken = tokenResponse.data.access_token;
    const query = 'query { me { account { id } } }';
    
    const accountResponse = await axios.post(
      'https://api.monday.com/v2',
      { query },
      { headers: { Authorization: accessToken, 'Content-Type': 'application/json' } }
    );

    const accountId = accountResponse.data.data.me.account.id;
    if (!accountId) {
      throw new Error('Could not retrieve monday.com account ID.');
    }

    const { error } = await supabase
      .from('accounts')
      .upsert({ account_id: accountId, access_token: accessToken }, { onConflict: 'account_id' });

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    res.redirect(`https://auth.monday.com/oauth2/authorize/success`);

  } catch (error) {
    console.error('An error occurred during the OAuth callback:', error);
    res.status(500).send('An error occurred during authentication.');
  }
}