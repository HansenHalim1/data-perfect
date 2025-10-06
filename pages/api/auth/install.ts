// pages/api/auth/install.ts

import { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.NEXT_PUBLIC_MONDAY_CLIENT_ID;

  if (!clientId) {
    return res.status(500).json({ error: 'Monday.com Client ID is not configured.' });
  }
  
  const authUrl = `https://auth.monday.com/oauth2/authorize?client_id=${clientId}`;
  res.redirect(authUrl);
}