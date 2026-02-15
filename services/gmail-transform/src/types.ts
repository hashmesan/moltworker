/**
 * Google Cloud Pub/Sub push notification payload
 * @see https://cloud.google.com/pubsub/docs/push
 */
export interface PubSubPushPayload {
  message: {
    data: string; // Base64-encoded string
    messageId: string;
    publishTime: string;
    attributes?: Record<string, string>;
  };
  subscription: string;
}

/**
 * Decoded Gmail notification data
 * @see https://developers.google.com/workspace/gmail/api/guides/push
 */
export interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

/**
 * Gmail API message header
 */
export interface GmailMessageHeader {
  name: string;
  value: string;
}

/**
 * Gmail API message part
 */
export interface GmailMessagePart {
  mimeType?: string;
  body?: {
    data?: string;
    size?: number;
  };
  parts?: GmailMessagePart[];
}

/**
 * Gmail API message format
 * @see https://developers.google.com/gmail/api/reference/rest/v1/users.messages#Message
 */
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: {
    headers?: GmailMessageHeader[];
    body?: {
      data?: string;
      size?: number;
    };
    parts?: GmailMessagePart[];
    mimeType?: string;
  };
  sizeEstimate?: number;
  raw?: string;
}

/**
 * Gmail API history list response
 * @see https://developers.google.com/gmail/api/reference/rest/v1/users.history/list
 */
export interface GmailHistoryResponse {
  history?: Array<{
    id: string;
    messages?: GmailMessage[];
    messagesAdded?: Array<{
      message: GmailMessage;
    }>;
    messagesDeleted?: Array<{
      message: GmailMessage;
    }>;
    labelsAdded?: Array<{
      message: GmailMessage;
      labelIds: string[];
    }>;
    labelsRemoved?: Array<{
      message: GmailMessage;
      labelIds: string[];
    }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
}

/**
 * Parsed email data for transformation
 */
export interface ParsedEmail {
  messageId: string;
  from: string;
  to?: string;
  subject: string;
  snippet: string;
  body: string;  // Full message body (plain text)
  labels?: string[];
  threadId: string;
  internalDate?: string;
}

/**
 * OpenClaw webhook payload for /hooks/agent endpoint
 * @see https://docs.openclaw.ai/automation/webhook
 */
export interface OpenClawWebhookPayload {
  message: string; // Required: prompt for agent processing
  name?: string; // Human-readable hook identifier
  agentId?: string; // Routes to specific agent
  sessionKey?: string; // Session identifier
  wakeMode?: 'now' | 'next-heartbeat'; // Delivery timing
  deliver?: boolean; // Send response to messaging channel
  channel?: 'last' | 'whatsapp' | 'telegram' | 'discord' | 'slack' | 'mattermost' | 'signal' | 'imessage' | 'msteams';
  to?: string; // Recipient identifier
  model?: string; // Model override
  thinking?: 'low' | 'medium' | 'high'; // Thinking level
  timeoutSeconds?: number; // Maximum execution duration
}

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  // Environment variables
  OPENCLAW_WEBHOOK_URL: string;
  ALLOWED_SENDERS: string; // Comma-separated email addresses (empty = allow all)

  // Secrets
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  OPENCLAW_HOOK_TOKEN: string;

  // KV namespace for storing last processed historyId
  GMAIL_STATE: KVNamespace;

  // Service binding to dvb-clawbot worker (avoids error 1042 with worker-to-worker fetch)
  DVB_CLAWBOT: Fetcher;
}
