import type { GmailHistoryResponse, ParsedEmail, Env } from './types';
import { simpleParser } from 'mailparser';
import { htmlToText } from 'html-to-text';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';
const OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * Refresh Gmail OAuth access token using refresh token
 * @param clientId - OAuth2 client ID
 * @param clientSecret - OAuth2 client secret
 * @param refreshToken - OAuth2 refresh token
 * @returns New access token
 */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const response = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
  }

  const data: { access_token: string } = await response.json();
  return data.access_token;
}

/**
 * Fetch all new messages from Gmail history with automatic token refresh
 * @param emailAddress - The Gmail email address
 * @param startHistoryId - The history ID to start from
 * @param env - Cloudflare Worker environment (for OAuth credentials)
 * @returns Array of parsed email data (empty array if no new messages)
 */
export async function fetchNewEmails(
  emailAddress: string,
  startHistoryId: string,
  env: Env
): Promise<ParsedEmail[]> {
  // Get fresh access token
  let accessToken = await refreshAccessToken(
    env.GMAIL_CLIENT_ID,
    env.GMAIL_CLIENT_SECRET,
    env.GMAIL_REFRESH_TOKEN
  );

  // Fetch history changes since last historyId
  const historyUrl = `${GMAIL_API_BASE}/users/${encodeURIComponent(emailAddress)}/history?startHistoryId=${startHistoryId}`;

  let historyResponse = await fetch(historyUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // If 401 Unauthorized, refresh token and retry once
  if (historyResponse.status === 401) {
    console.log('Access token expired, refreshing...');
    accessToken = await refreshAccessToken(
      env.GMAIL_CLIENT_ID,
      env.GMAIL_CLIENT_SECRET,
      env.GMAIL_REFRESH_TOKEN
    );

    historyResponse = await fetch(historyUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  if (!historyResponse.ok) {
    const errorText = await historyResponse.text();
    throw new Error(`Gmail API history.list failed: ${historyResponse.status} ${errorText}`);
  }

  const historyData: GmailHistoryResponse = await historyResponse.json();

  // Collect all new message IDs from history
  const messageIds: string[] = [];
  if (historyData.history) {
    for (const historyItem of historyData.history) {
      if (historyItem.messagesAdded) {
        for (const added of historyItem.messagesAdded) {
          messageIds.push(added.message.id);
        }
      }
    }
  }

  if (messageIds.length === 0) {
    return []; // No new messages
  }

  console.log(`Found ${messageIds.length} new message(s)`);

  // Fetch all messages
  const emails: ParsedEmail[] = [];

  for (const messageId of messageIds) {
    const messageUrl = `${GMAIL_API_BASE}/users/${encodeURIComponent(emailAddress)}/messages/${messageId}?format=raw`;

    const messageResponse = await fetch(messageUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!messageResponse.ok) {
      console.error(`Failed to fetch message ${messageId}: ${messageResponse.status}`);
      continue; // Skip this message, continue with others
    }

    const message: { id: string; raw?: string; threadId: string; labelIds?: string[] } = await messageResponse.json();

    // Skip if no raw data
    if (!message.raw) {
      console.error(`Message ${messageId} has no raw data`);
      continue;
    }

    // Parse the raw MIME message
    const rawBuffer = Buffer.from(message.raw, 'base64url');
    const parsed = await simpleParser(rawBuffer);

    // Extract plain text or convert HTML
    let body = '';
    if (parsed.text) {
      // Prefer plain text if available
      body = parsed.text;
    } else if (parsed.html) {
      // Convert HTML to plain text
      body = htmlToText(parsed.html, {
        wordwrap: false,
        preserveNewlines: true,
      });
    }

    // Extract headers - handle AddressObject format
    const getAddress = (addr: typeof parsed.from | typeof parsed.to): string => {
      if (!addr) return '';
      if (Array.isArray(addr)) return addr[0]?.value?.[0]?.address || '';
      return addr.value?.[0]?.address || '';
    };

    const from = getAddress(parsed.from);
    const to = getAddress(parsed.to);
    const subject = parsed.subject || '';

    emails.push({
      messageId: message.id,
      from,
      to,
      subject,
      snippet: body.substring(0, 200), // First 200 chars for snippet
      body,
      labels: message.labelIds,
      threadId: message.threadId,
      internalDate: parsed.date?.toISOString(),
    });
  }

  return emails;
}
