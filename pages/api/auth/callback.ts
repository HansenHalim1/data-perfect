// pages/api/auth/callback.ts

import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { supabase } from '../../../lib/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("--- AUTH CALLBACK RECEIVED (Supabase First Diagnostic) ---");

  // --- STEP 1: TEST SUPABASE CONNECTION IMMEDIATELY ---
  try {
    const testAccountId = 12345; // A fake account ID for testing
    const testToken = 'test_token';
    console.log(`Attempting to write a test row to Supabase for account ${testAccountId}...`);
    
    const { error: supabaseError } = await supabase
      .from('accounts')
      .upsert({ account_id: testAccountId, access_token: testToken }, { onConflict: 'account_id' });

    if (supabaseError) {
      // If there's a Supabase error, throw it immediately so we can see it.
      console.error("--- SUPABASE CONNECTION FAILED ---", supabaseError);
      throw new Error(`Supabase error: ${supabaseError.message}`);
    }
    
    console.log("--- SUPABASE CONNECTION SUCCESSFUL --- Test row written.");
    // For this test, we will stop here. The goal is just to see if the write works.
    res.redirect('/success.html');
    return;

  } catch (error: any) {
    console.error("--- FATAL ERROR DURING SUPABASE TEST ---");
    console.error(error.message);
    res.status(500).send(`A fatal error occurred during the Supabase connection test. Check Vercel logs.`);
    return;
  }
  
  // The rest of the monday.com logic is temporarily disabled for this test.
}