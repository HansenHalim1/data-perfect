// pages/api/monday/events.ts

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabaseClient';
import { callMondayApi } from '../../../lib/mondayApi';
import crypto from 'crypto';

// Security function to verify requests are from monday.com
function verifyMondaySignature(authorization: string, body: any) {
  const signingSecret = process.env.MONDAY_SIGNING_SECRET;
  if (!signingSecret) return false;
  const requestBody = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', signingSecret).update(requestBody).digest('hex');
  return signature === authorization;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // You should re-enable this security check once you confirm everything is working
  // const { authorization } = req.headers;
  // if (!authorization || !verifyMondaySignature(authorization, req.body)) {
  //   return res.status(401).json({ error: 'Invalid signature' });
  // }
  
  // Handle the security challenge from monday.com
  if (req.body.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  const { type, payload } = req.body.event;

  try {
    switch (type) {
      case 'subscribe':
        const { webhookId, boardId } = payload;
        const token = req.headers.authorization || '';
        const decodedToken = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
        const accountId = decodedToken.acc_id;

        await supabase.from('automation_rules').insert({
          webhook_id: webhookId,
          board_id: boardId,
          account_id: accountId,
          rule_type: 'TO_UPPERCASE',
        });
        
        return res.status(200).send({ webhookId });

      case 'execute_action':
        await handleExecuteAction(payload);
        return res.status(200).send({});

      case 'unsubscribe':
        const { webhookId: unsubWebhookId } = payload;
        await supabase.from('automation_rules').delete().eq('webhook_id', unsubWebhookId);
        return res.status(200).send({});

      default:
        return res.status(200).send({}); // Always respond 200 to avoid monday re-sends
    }
  } catch (error) {
    console.error('[HANDLER_ERROR]', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function handleExecuteAction(payload: any) {
  const { webhookId, boardId, itemId, columnId } = payload.inboundFieldValues;

  const { data: rule } = await supabase.from('automation_rules').select('account_id').eq('webhook_id', webhookId).single();
  if (!rule) return;

  const { data: account } = await supabase.from('accounts').select('access_token').eq('account_id', rule.account_id).single();
  if (!account) return;
  
  const token = account.access_token;
  
  const query = `query { items(ids: [${itemId}]) { column_values(ids: ["${columnId}"]) { text } } }`;
  const mondayRes = await callMondayApi(query, token);
  const originalText = mondayRes?.data?.items?.[0]?.column_values?.[0]?.text;

  if (!originalText) return;

  const formattedText = originalText.toUpperCase();
  const updateQuery = `mutation { change_simple_column_value(board_id: ${boardId}, item_id: ${itemId}, column_id: "${columnId}", value: "${formattedText}") { id } }`;
  
  await callMondayApi(updateQuery, token);
}