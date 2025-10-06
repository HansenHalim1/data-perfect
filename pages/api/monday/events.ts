// pages/api/monday/events.ts (DIAGNOSTIC VERSION)

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabaseClient';
import { callMondayApi } from '../../../lib/mondayApi';
import crypto from 'crypto';

function verifyMondaySignature(authorization: string, body: any) {
  const signingSecret = process.env.MONDAY_SIGNING_SECRET;
  if (!signingSecret) return false;
  const requestBody = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', signingSecret).update(requestBody).digest('hex');
  return signature === authorization;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("--- [1] MONDAY EVENT RECEIVED ---");

  const { authorization } = req.headers;
  if (!authorization || !verifyMondaySignature(authorization, req.body)) {
    console.error("--- [ERROR] SECURITY SIGNATURE VERIFICATION FAILED ---");
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  console.log("--- [2] SECURITY SIGNATURE VERIFIED ---");

  if (req.body.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  if (!req.body.event) {
    return res.status(200).send({});
  }

  const { type, payload } = req.body.event;
  console.log(`--- [3] Event type is '${type}' ---`);

  try {
    switch (type) {
      case 'subscribe':
        console.log("--- [4] ENTERING 'subscribe' CASE ---");
        console.log("Received payload:", JSON.stringify(payload, null, 2));

        const { webhookId, boardId, accountId } = payload;
        
        const { error: insertError } = await supabase.from('automation_rules').insert({
          webhook_id: webhookId,
          board_id: boardId,
          account_id: accountId,
          rule_type: 'TO_UPPERCASE',
        });

        if (insertError) {
            console.error("--- [ERROR] Supabase insert failed in 'subscribe' case ---", insertError);
            throw insertError;
        }
        
        console.log("--- [5] SUCCESSFULLY INSERTED RULE INTO SUPABASE ---");
        return res.status(200).send({ webhookId });

      case 'execute_action':
        // This part is not being tested right now
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
    console.error(`--- [FATAL ERROR] The handler crashed for event type '${type}' ---`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}


// The handleExecuteAction function remains the same as before
async function handleExecuteAction(payload: any) {
    const { webhookId, boardId, itemId, columnId } = payload.inboundFieldValues;
    try {
      const { data: rule } = await supabase.from('automation_rules').select('account_id').eq('webhook_id', webhookId).single();
      if (!rule) return;
      const { data: account } = await supabase.from('accounts').select('access_token').eq('account_id', rule.account_id).single();
      if (!account) return;
      const token = account.access_token;
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
    } catch (error) {
      console.error("Error in handleExecuteAction:", error);
    }
}