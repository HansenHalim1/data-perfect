// pages/api/monday/events.ts

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../lib/supabaseClient';
import { callMondayApi } from '../../../lib/mondayApi';
import crypto from 'crypto';

// Security function to verify requests are from monday.com
function verifyMondaySignature(authorization: string, body: any) {
  const signingSecret = process.env.MONDAY_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("Signing secret is not configured.");
    return false;
  }
  const requestBody = JSON.stringify(body);
  const signature = crypto.createHmac('sha256', signingSecret).update(requestBody).digest('hex');
  return signature === authorization;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // IMPORTANT: Once your app is stable, re-enable this security check.
  // const { authorization } = req.headers;
  // if (!authorization || !verifyMondaySignature(authorization, req.body)) {
  //   return res.status(401).json({ error: 'Invalid signature' });
  // }
  
  // Handle the one-time security challenge from monday.com
  if (req.body.challenge) {
    console.log("Received monday.com challenge. Responding.");
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // All other events will have this structure
  if (!req.body.event) {
    console.warn("Received request without an event body.");
    return res.status(200).send({}); // Respond 200 to prevent retries
  }

  const { type, payload } = req.body.event;

  try {
    switch (type) {
      case 'subscribe':
        console.log("Received 'subscribe' event:", payload);
        const { webhookId, boardId } = payload;
        // The JWT in the auth header contains the account ID
        const token = req.headers.authorization || '';
        const decodedToken = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
        const accountId = decodedToken.acc_id;

        await supabase.from('automation_rules').insert({
          webhook_id: webhookId,
          board_id: boardId,
          account_id: accountId,
          rule_type: 'TO_UPPERCASE', // In the future, this could be dynamic
        });
        
        return res.status(200).send({ webhookId });

      case 'execute_action':
        console.log("Received 'execute_action' event:", payload);
        await handleExecuteAction(payload);
        return res.status(200).send({});

      case 'unsubscribe':
        console.log("Received 'unsubscribe' event:", payload);
        const { webhookId: unsubWebhookId } = payload;
        await supabase.from('automation_rules').delete().eq('webhook_id', unsubWebhookId);
        return res.status(200).send({});

      default:
        console.warn(`Received unknown event type: ${type}`);
        return res.status(200).send({});
    }
  } catch (error) {
    console.error(`[HANDLER_ERROR] Failed to process event type ${type}:`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * Handles the core logic when an automation is triggered.
 * @param payload The event payload from monday.com
 */
async function handleExecuteAction(payload: any) {
  const { webhookId, boardId, itemId, columnId } = payload.inboundFieldValues;
  console.log(`Executing action for webhook: ${webhookId}, item: ${itemId}`);

  try {
    const { data: rule } = await supabase.from('automation_rules').select('account_id').eq('webhook_id', webhookId).single();
    if (!rule) {
      console.error(`Rule not found for webhook: ${webhookId}`);
      return;
    }

    const { data: account } = await supabase.from('accounts').select('access_token').eq('account_id', rule.account_id).single();
    if (!account) {
      console.error(`Account not found for ID: ${rule.account_id}`);
      return;
    }
  
    const token = account.access_token;
    
    // --- CORRECT GRAPHQL QUERY ---
    const getColumnValueQuery = `query($itemId: [ID!], $columnId: [String!]) {
      items (ids: $itemId) {
        column_values (ids: $columnId) {
          text
        }
      }
    }`;
    const getVariables = { itemId: [itemId], columnId: [columnId] };
    
    const mondayRes = await callMondayApi(JSON.stringify({ query: getColumnValueQuery, variables: getVariables }), token);
    const originalText = mondayRes?.data?.items?.[0]?.column_values?.[0]?.text;

    if (originalText === null || originalText === undefined) {
      console.log(`Column ${columnId} for item ${itemId} is empty. Nothing to format.`);
      return;
    }

    const formattedText = originalText.toUpperCase();

    // Optimization: Don't run the update if the text is already uppercase
    if (originalText === formattedText) {
      console.log(`Text for item ${itemId} is already formatted. Skipping update.`);
      return;
    }

    // --- CORRECT GRAPHQL MUTATION ---
    const updateColumnValueQuery = `mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value (board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
        id
      }
    }`;
    const updateVariables = { boardId, itemId, columnId, value: formattedText };
  
    await callMondayApi(JSON.stringify({ query: updateColumnValueQuery, variables: updateVariables }), token);
    console.log(`Successfully updated item ${itemId} on board ${boardId}.`);

  } catch (error) {
    console.error("Error in handleExecuteAction:", error);
  }
}