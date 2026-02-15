import type { ParsedEmail, OpenClawWebhookPayload } from './types';

/**
 * Transform a single Gmail message to OpenClaw webhook payload
 * @param email - Parsed email data
 * @returns OpenClaw webhook payload
 */
export function transformToOpenClaw(email: ParsedEmail): OpenClawWebhookPayload {
  // Use full body instead of snippet
  const message = `New email from ${email.from}
Subject: ${email.subject}

${email.body || email.snippet}`;

  return {
    message,
    name: 'gmail-notification',
    channel: 'last',
    wakeMode: 'now'
  };
}
