import type { OpenClawWebhookPayload } from './types';

/**
 * Send webhook to OpenClaw /hooks/agent endpoint via service binding
 * @param payload - The webhook payload
 * @param token - Authentication token
 * @param clawbotService - Service binding to dvb-clawbot worker
 * @returns Response from OpenClaw
 */
export async function sendToOpenClaw(
  payload: OpenClawWebhookPayload,
  token: string,
  clawbotService: Fetcher
): Promise<Response> {
  // Note: With service bindings, the hostname is ignored - only the path matters
  const request = new Request('http://dvb-clawbot/hooks/agent', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  // Use service binding instead of external fetch (avoids error 1042)
  const response = await clawbotService.fetch(request);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenClaw webhook failed: ${response.status} ${errorText} (via service binding)`);
  }

  return response;
}

/**
 * Send webhook with retry logic
 * @param payload - The webhook payload
 * @param token - Authentication token
 * @param clawbotService - Service binding to dvb-clawbot worker
 * @param maxRetries - Maximum number of retries (default: 3)
 * @returns Response from OpenClaw
 */
export async function sendToOpenClawWithRetry(
  payload: OpenClawWebhookPayload,
  token: string,
  clawbotService: Fetcher,
  maxRetries: number = 1
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sendToOpenClaw(payload, token, clawbotService);
    } catch (error) {
      lastError = error as Error;
      console.error(`OpenClaw webhook attempt ${attempt + 1} failed:`, error);

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries - 1) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error('OpenClaw webhook failed after retries');
}
