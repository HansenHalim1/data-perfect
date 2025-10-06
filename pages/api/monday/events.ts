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

/**
 * Decodes the JWT from the authorization header to get the account ID.
 * This is necessary because the event payload does not contain the account ID.
 */
function getAccountIdFromToken(token: string): number | null {
    try {
        const decodedToken = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
        return decodedToken.acc_id;
    } catch (error) {
        console.error("Error decoding token:", error);
        return null;
    }
}


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("--- MONDAY.COM WEBHOOK RECEIVED ---");

  // Re-enable the security check
  const { authorization } = req.headers;
  if (!authorization || !verifyMondaySignature(authorization, req.body)) {
    console.error("Authorization failed. Invalid signature.");
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Handle the one-time security challenge
  if (req.body.challenge) {
    console.log("Received monday.com challenge. Responding.");
    return res.status(200).json({ challenge: req.body.challenge });
  }

  if (!req.body.event) {
    return res.status(200).send({});
  }

  const { type, payload } = req.body.event;

  try {
    const accountId = getAccountIdFromToken(authorization);
    if (!accountId) {
        throw new Error("Could not extract accountId from token.");
    }

    switch (type) {
      case 'subscribe':
        const { webhookId, boardId } = payload;
        await supabase.from('automation_rules').insert({
          webhook_id: webhookId,
          board_id: boardId,
          account_id: accountId,
          rule_type: 'TO_UPPERCASE',
        });
        return res.status(200).send({ webhookId });

      case 'execute_action':
        await handleExecuteAction(payload, accountId);
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


async function handleExecuteAction(payload: any, accountId: number) {
  const { boardId, itemId, columnId } = payload.inboundFieldValues;
  console.log(`Executing action for account: ${accountId}, item: ${itemId}`);

  try {
    const { data: account } = await supabase.from('accounts').select('access_token').eq('account_id', accountId).single();
    if (!account) {
      console.error(`Account not found for ID: ${accountId}`);
      return;
    }
    const token = account.access_token;
    
    const getColumnValueQuery = `query($itemId: [ID!], $columnId: [String!]) { items (ids: $itemId) { column_values (ids: $columnId) { text } } }`;
    const getVariables = { itemId: [itemId], columnId: [columnId] };
    const mondayRes = await callMondayApi(JSON.stringify({ query: getColumnValueQuery, variables: getVariables }), token);
    const originalText = mondayRes?.data?.items?.[0]?.column_values?.[0]?.text;

    if (originalText === null || originalText === undefined) {
      console.log(`Column ${columnId} for item ${itemId} is empty. Nothing to format.`);
      return;
    }
    const formattedText = originalText.toUpperCase();
    if (originalText === formattedText) {
      console.log(`Text for item ${itemId} is already formatted. Skipping update.`);
      return;
    }
    
    const updateColumnValueQuery = `mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) { change_simple_column_value (board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id } }`;
    const updateVariables = { boardId, itemId, columnId, value: formattedText };
    await callMondayApi(JSON.stringify({ query: updateColumnValueQuery, variables: updateVariables }), token);
    
    console.log(`Successfully updated item ${itemId} on board ${boardId}.`);
  } catch (error) {
    console.error("Error in handleExecuteAction:", error);
  }
}