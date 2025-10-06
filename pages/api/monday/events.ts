// pages/api/monday/events.ts

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabaseClient';
import { callMondayApi } from '../../../lib/mondayApi';
import crypto from 'crypto';

// Security function (no changes needed here)
function verifyMondaySignature(authorization: string, body: any) {
  // ... same as before
  const signingSecret = process.env.MONDAY_SIGNING_SECRET;
  if (!signingSecret) return false;
  const requestBody = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', signingSecret).update(requestBody).digest('hex');
  return signature === authorization;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Re-enable security
  const { authorization } = req.headers;
  if (!authorization || !verifyMondaySignature(authorization, req.body)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  if (req.body.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  if (!req.body.event) {
    return res.status(200).send({});
  }

  const { type, payload } = req.body.event;

  try {
    switch (type) {
      case 'subscribe':
        // --- CORRECTED SUBSCRIBE LOGIC ---
        // The accountId is reliably in the payload for this event.
        const { webhookId, boardId, accountId } = payload;
        console.log(`SUBSCRIBE event: Saving rule for accountId: ${accountId}`);

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
        return res.status(200).send({});
    }
  } catch (error) {
    console.error(`[HANDLER_ERROR]`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}


async function handleExecuteAction(payload: any) {
  // --- CORRECTED EXECUTE LOGIC ---
  const { webhookId, boardId, itemId, columnId } = payload.inboundFieldValues;
  console.log(`EXECUTE event for webhook: ${webhookId}`);

  try {
    // Look up the rule to find which account it belongs to.
    const { data: rule } = await supabase.from('automation_rules').select('account_id').eq('webhook_id', webhookId).single();
    if (!rule) {
      console.error(`Rule not found for webhook: ${webhookId}`);
      return;
    }

    // Now get the access token for that account.
    const { data: account } = await supabase.from('accounts').select('access_token').eq('account_id', rule.account_id).single();
    if (!account) {
      console.error(`Account not found for ID: ${rule.account_id}`);
      return;
    }
    const token = account.access_token;
    
    // The rest of the logic is the same and should now work.
    const getColumnValueQuery = `query($itemId: [ID!], $columnId: [String!]) { items (ids: $itemId) { column_values (ids: $columnId) { text } } }`;
    const getVariables = { itemId: [itemId], columnId: [columnId] };
    const mondayRes = await callMondayApi(JSON.stringify({ query: getColumnValueQuery, variables: getVariables }), token);
    const originalText = mondayRes?.data?.items?.[0]?.column_values?.[0]?.text;

    if (originalText === null || originalText === undefined) return;
    const formattedText = originalText.toUpperCase();
    if (originalText === formattedText) return;
    
    const updateColumnValueQuery = `mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) { change_simple_column_value (board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id } }`;
    const updateVariables = { boardId, itemId, columnId, value: formattedText };
    await callMondayApi(JSON.stringify({ query: updateColumnValueQuery, variables: updateVariables }), token);
    
    console.log(`Successfully updated item ${itemId}.`);
  } catch (error) {
    console.error("Error in handleExecuteAction:", error);
  }
}