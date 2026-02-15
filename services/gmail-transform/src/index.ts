import type { Env, PubSubPushPayload, GmailNotification } from './types';
import { fetchNewEmails } from './gmail-client';
import { transformToOpenClaw } from './transformer';
import { sendToOpenClawWithRetry } from './openclaw-client';

/**
 * Decode base64url-encoded notification data
 * @param data - Base64url-encoded string
 * @returns Decoded Gmail notification
 */
function decodeNotification(data: string): GmailNotification {
  const decoded = atob(data);
  return JSON.parse(decoded);
}

/**
 * Check if an email sender is in the allowed list
 * @param fromAddress - Email FROM header (e.g., "Name <email@example.com>" or "email@example.com")
 * @param allowedSenders - Comma-separated list of allowed email addresses
 * @returns true if allowed (or if filter is empty), false otherwise
 */
function isAllowedSender(fromAddress: string, allowedSenders: string): boolean {
  // If no filter configured, allow all
  if (!allowedSenders || allowedSenders.trim() === '') {
    return true;
  }

  // Extract email address from "Name <email@example.com>" format
  const emailMatch = fromAddress.match(/<(.+?)>/) || [null, fromAddress];
  const email = emailMatch[1].trim().toLowerCase();

  // Parse allowed senders list
  const allowed = allowedSenders.split(',').map(s => s.trim().toLowerCase());

  // Check if email is in allowed list
  return allowed.includes(email);
}

/**
 * Process Gmail notification - fetch new email and send to OpenClaw
 * @param notification - Decoded Gmail notification
 * @param env - Cloudflare Worker environment
 */
async function processNotification(notification: GmailNotification, env: Env): Promise<void> {
  const { emailAddress, historyId } = notification;

  console.log(`New email notification for ${emailAddress}, historyId: ${historyId}`);

  try {
    // Get the last processed historyId from KV
    const lastHistoryId = await env.GMAIL_STATE.get(`last_history_${emailAddress}`);

    if (!lastHistoryId) {
      // First time setup - store current historyId as baseline without processing
      console.log('First notification - storing baseline historyId without processing');
      await env.GMAIL_STATE.put(`last_history_${emailAddress}`, historyId);
      return;
    }

    // Fetch all emails that changed since last historyId
    const emails = await fetchNewEmails(emailAddress, lastHistoryId, env);

    if (emails.length === 0) {
      console.log('No new messages found');
      // Still update the historyId to current
      await env.GMAIL_STATE.put(`last_history_${emailAddress}`, historyId);
      return;
    }

    console.log(`Processing ${emails.length} new email(s)`);

    // Process each email
    let processedCount = 0;
    let filteredCount = 0;

    for (const email of emails) {
      console.log(`Email from ${email.from}: ${email.subject}`);

      // Check if sender is allowed
      if (!isAllowedSender(email.from, env.ALLOWED_SENDERS)) {
        console.log(`  → Filtered out (not in allowed senders list)`);
        filteredCount++;
        continue; // Skip to next email
      }

      // Transform to OpenClaw webhook format
      const payload = transformToOpenClaw(email);

      // Send to OpenClaw via service binding (avoids error 1042)
      await sendToOpenClawWithRetry(payload, env.OPENCLAW_HOOK_TOKEN, env.DVB_CLAWBOT);
      console.log(`  → Sent to OpenClaw`);
      processedCount++;
    }

    console.log(`Summary: ${processedCount} sent to OpenClaw, ${filteredCount} filtered out`);

    // Update stored historyId to current (after processing all)
    await env.GMAIL_STATE.put(`last_history_${emailAddress}`, historyId);
  } catch (error) {
    console.error('Error processing notification:', error);
    // Don't throw - we don't want to retry on persistent errors
  }
}

/**
 * Cloudflare Worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Gmail webhook endpoint
    if (url.pathname === '/webhook/gmail' && request.method === 'POST') {
      try {
        // Parse Pub/Sub payload
        const payload: PubSubPushPayload = await request.json();

        // Decode notification
        const notification = decodeNotification(payload.message.data);

        // Process asynchronously (don't block response)
        ctx.waitUntil(processNotification(notification, env));

        // Respond immediately with 200 to acknowledge
        return new Response('OK', { status: 200 });
      } catch (error) {
        console.error('Error handling webhook:', error);
        // Still return 200 to avoid Pub/Sub retries for parsing errors
        return new Response('Error processing webhook', { status: 200 });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
