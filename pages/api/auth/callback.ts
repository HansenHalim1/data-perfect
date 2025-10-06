// pages/api/auth/callback.ts

import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { supabase } from '../../../lib/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("--- AUTH CALLBACK RECEIVED ---");

  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    console.error("Callback requested without a code.");
    return res.status(400).send("Authorization code is missing.");
  }
  
  const clientId = process.env.NEXT_PUBLIC_MONDAY_CLIENT_ID;
  const clientSecret = process.env.MONDAY_CLIENT_SECRET;
  const host = req.headers.host;
  const redirectUri = `https://${host}/api/auth/callback`;

  // --- AGGRESSIVE LOGGING FOR DIAGNOSTICS ---
  console.log("Preparing to exchange token with the following parameters:");
  console.log(`Received code: ${code}`);
  console.log(`Using client_id: ${clientId}`);
  // Good practice: never log the full client secret.
  console.log(`Using client_secret: ${clientSecret ? 'Exists' : 'MISSING!'}`);
  console.log(`Using redirect_uri: ${redirectUri}`);
  
  try {
    const tokenResponse = await axios.post('https://auth.monday.com/oauth2/token', {
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    
    const accessToken = tokenResponse.data.access_token;
    console.log("Successfully exchanged code for access token.");
    
    const query = 'query { me { account { id } } }';
    const accountResponse = await axios.post(
      'https://api.monday.com/v2',
      { query },
      { headers: { Authorization: accessToken, 'Content-Type': 'application/json' } }
    );

    const accountId = accountResponse.data?.data?.me?.account?.id;
    if (!accountId) {
      console.error("API response from 'me' query was missing account ID.", accountResponse.data);
      throw new Error("Could not retrieve account ID from monday API.");
    }
    console.log(`Successfully retrieved accountId: ${accountId}`);

    await supabase
      .from('accounts')
      .upsert({ account_id: accountId, access_token: accessToken }, { onConflict: 'account_id' });
    
    console.log(`SUCCESS: Credentials for account ${accountId} saved to Supabase.`);

    // If everything above worked, NOW we redirect to the real success page.
    res.redirect('/success.html');

  } catch (error: any) {
    console.error("--- FATAL ERROR DURING AUTHENTICATION ---");
    // This is the most important log. It will tell us exactly what failed.
    if (error.response) {
      console.error("Monday.com API responded with an error:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error("A non-API error occurred:", error.message);
    }
    res.status(500).send(`An error occurred during authentication. Check the Vercel logs for details. Error: ${error.message}`);
  }
}