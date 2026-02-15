# Cloudflare serverless function

## Purpose

Transform Gmail [pubsub](https://developers.google.com/workspace/gmail/api/guides/push) to Openclaw Webhook(https://docs.openclaw.ai/automation/webhook)

https://docs.cloud.google.com/pubsub/docs/push

1. Gmail will send webhook to our service 
2. our service transform message to openclaw destination path
curl -X POST http://127.0.0.1:18789/hooks/gmail \
  -H 'Authorization: Bearer SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"source":"gmail","messages":[{"from":"Ada","subject":"Hello","snippet":"Hi"}]}'

## Architecture

### Simple Flow

```
New Gmail Email → Pub/Sub → Cloudflare Worker → Fetch Email → Send to OpenClaw
```

### How It Works

1. Gmail sends push notification when new email arrives
2. Worker gets the message ID from Pub/Sub
3. Worker fetches email details from Gmail API (from, subject, snippet)
4. Worker sends to OpenClaw webhook
5. Done!

**Note**: Gmail Pub/Sub only sends a notification with historyId, not the actual email. We must call Gmail API to get the email content.


## Setup Instructions

### 1. Deploy the Cloudflare Worker

**Important**: Always run wrangler commands from the `services/gmail-transform` directory to avoid picking up the parent project's wrangler config.

```bash
cd services/gmail-transform
npm install
wrangler deploy
```

Or use the `-c` flag to explicitly specify the config:

```bash
wrangler deploy -c services/gmail-transform/wrangler.toml
```

Note the deployed URL (e.g., `https://gmail-transform.deepvaluebagger.workers.dev`)

### 2. Get Gmail OAuth Refresh Token (One-Time Setup)

You need to get a refresh token from Google OAuth Playground. This is a **one-time** setup - the worker will handle token refresh automatically after this.

#### Step-by-Step Instructions:

1. Go to [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)

2. Click the **gear icon** (⚙️) in the top right corner

3. Check ☑ **"Use your own OAuth credentials"**

4. Enter your credentials from Google Cloud Console:
   - **OAuth Client ID**: (your client ID)
   - **OAuth Client secret**: (your client secret)

5. Close the settings

6. On the left side, scroll to **"Gmail API v1"** and select:
   - ☑ `https://www.googleapis.com/auth/gmail.readonly`

7. Click **"Authorize APIs"**

8. Sign in with your Gmail account when prompted

9. Click **"Allow"** to grant permissions

10. In **Step 2**, click **"Exchange authorization code for tokens"**

11. **Copy the "Refresh token"** (you'll need this for the next step)
    - ⚠️ **Important**: Save this refresh token securely - you only get it once!

### 3. Configure Worker Secrets

Now set all the required secrets:

```bash
cd services/gmail-transform

# Set Gmail OAuth credentials
npx wrangler secret put GMAIL_CLIENT_ID
# Paste your OAuth Client ID

npx wrangler secret put GMAIL_CLIENT_SECRET
# Paste your OAuth Client Secret

npx wrangler secret put GMAIL_REFRESH_TOKEN
# Paste the Refresh Token from OAuth Playground (Step 2.11)

# Set OpenClaw webhook token
npx wrangler secret put OPENCLAW_HOOK_TOKEN
# Paste your OpenClaw hooks token from openclaw.json
```

**How it works**: The worker uses your refresh token to automatically get new access tokens whenever needed. You'll never need to manually update tokens again!

### 4. Google Cloud Pub/Sub Setup

#### Create a Topic

```bash
gcloud pubsub topics create gmail-notifications
```

#### Grant Gmail Permission

```bash
gcloud pubsub topics add-iam-policy-binding gmail-notifications \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
```

#### Create Push Subscription

```bash
gcloud pubsub subscriptions create gmail-push-sub \
  --topic=gmail-notifications \
  --push-endpoint=https://gmail-transform.deepvaluebagger.workers.dev/webhook/gmail
```

### 5. Set Up Gmail Watch

After configuring your secrets, you need to tell Gmail to start sending notifications:

Call the Gmail API to watch for new emails:

```bash
curl -X POST \
  'https://gmail.googleapis.com/gmail/v1/users/me/watch' \
  -H 'Authorization: Bearer secret
  -H 'Content-Type: application/json' \
  -d '{
    "topicName": "projects/visionarybits/topics/gmail-notifications",
    "labelIds": ["INBOX"]
  }'
```

**Important**: Gmail watch expires after 7 days. You need to renew it regularly or set up a cron job to auto-renew.

### 6. OpenClaw Configuration

#### Get Your Webhook Token

Open your OpenClaw config file at `/root/.openclaw/openclaw.json` (or `~/.openclaw/openclaw.json`) and find the hooks token:

```json
{
  "hooks": {
    "token": "your-secret-token-here"
  }
}
```

If the hooks section doesn't exist, add it:

```json
{
  "hooks": {
    "token": "generate-a-random-secure-token",
    "allowedAgentIds": []
  }
}
```

#### Test OpenClaw Webhook

Verify OpenClaw is accepting webhooks:

```bash
curl -X POST https://dvb-clawbot.deepvaluebagger.workers.dev/hooks/agent \
  -H 'Authorization: Bearer secret
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Test message from Gmail transform service",
    "name": "gmail-notification"
  }'
```

You should receive a 202 response, and OpenClaw should process the message.

## Testing

### Send a Test Email

Send an email to your Gmail account and check the logs:

```bash
# View worker logs
wrangler tail

# Or check OpenClaw logs
tail -f ~/.openclaw/logs/gateway.log
```

### Manual Pub/Sub Test

You can manually trigger the worker with a test Pub/Sub message:

```bash
# Encode test notification data
echo '{"emailAddress":"your-email@gmail.com","historyId":"12345"}' | base64

# Send test message
gcloud pubsub topics publish gmail-notifications \
  --message='{"message":{"data":"BASE64_ENCODED_DATA","messageId":"test-123"}}'
```

## Troubleshooting

### Worker Not Receiving Notifications

- Check Pub/Sub subscription push endpoint URL is correct
- View worker logs: `wrangler tail`
- Verify Gmail watch is still active (expires after 7 days)

### Gmail API Errors

- Ensure OAuth token has `gmail.readonly` scope
- Check token hasn't expired (refresh if needed)
- Verify Gmail API is enabled in Google Cloud Console

### OpenClaw Not Receiving Messages

- Verify `OPENCLAW_WEBHOOK_URL` in wrangler.toml is correct
- Check OpenClaw is running: `curl http://127.0.0.1:18789/health`
- Confirm webhook token matches OpenClaw config
- Check OpenClaw logs for errors

## Configs