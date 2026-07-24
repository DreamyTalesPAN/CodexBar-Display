# Customer Service Chat

The VibeTV Control Center embeds the official `@n8n/chat` client in the local
Control Center, hosted setup, and recovery surfaces. The feature is disabled by
default and connects directly to a published n8n Chat Trigger. The n8n workflow
and support agent are managed separately from this repository. Customer and
support replies are recorded in the `VibeTV Support` Airtable base.

## Control Center configuration

Set these public build-time variables before building the Control Center:

```text
NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_ENABLED=1
NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_WEBHOOK_URL=https://n8n.example.com/webhook/...
NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_LOG_WEBHOOK_URL=https://n8n.example.com/webhook/...
NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_STREAMING_ENABLED=1
```

The button is not rendered unless the enabled flag is `1` and the webhook URL
is valid. HTTPS is required outside loopback development. Streaming is enabled
unless its flag is `0`; the client does not retry automatically in another mode.
The streaming flag and the Chat Trigger response mode must always match.
The optional log webhook receives the completed bot message after streaming
finishes. Logging is best-effort and never replaces or delays the visible chat
answer. n8n deduplicates it by message ID before writing to Airtable.

These values are public browser configuration. Never put Basic Auth, API keys,
tokens, or other secrets in them.

## Client request contract

The client uses the n8n defaults `sessionId` and `chatInput`. It persists the
official `n8n-chat/sessionId` local-storage key across reloads. An optional
customer email is stored under `vibetv-support/customerEmail` for the same
conversation. **New conversation** removes both values and lets the chat client
create a new session.

Each request contains only this metadata:

```json
{
  "source": "vibetv-control-center",
  "surface": "local-control-center | hosted-setup | recovery",
  "platform": "macos | windows | web | unknown",
  "appVersion": "optional",
  "companionVersion": "optional",
  "customerEmail": "optional, explicitly entered by the customer",
  "deviceConnected": false
}
```

Do not add device IDs, IP addresses or targets, logs, provider data, usage data,
API keys, credentials, or authorization headers. File and screenshot uploads
are disabled in V1.

## n8n Chat Trigger handoff

Configure the current n8n Chat Trigger as follows:

- **Make Chat Publicly Available:** on
- **Mode:** `Embedded Chat`
- **Authentication:** `None`
- **Allowed Origins:** `https://app.vibetv.shop`,
  `http://127.0.0.1:47832`, and `http://localhost:47832`
- **Load Previous Session:** `From Memory`
- **Response Mode:** `Streaming`

Add `http://localhost:3000` only to a test workflow for local development. CORS
is not authentication. The workflow must be published and active, and the Chat
Trigger and AI Agent must use the same Memory instance and `sessionId`.

If streaming is disabled in the Control Center build, change the trigger to
**When Last Node Finishes** and return the agent answer in the expected
`output` field. Do not depend on a client fallback between response modes.
Keep logging and other side effects on a side branch; an inline ticket, email,
or database node after the agent would replace the last-node chat response.

Rate limits, prompt-length limits, abuse protection, and support-agent safety
belong in the n8n workflow. Once the problem and email address are known, the
agent creates a support ticket. n8n emails the internal review form to
`paulanduschus@dreamytales.de` with `marcushaas@dreamytales.de` in CC. The
reviewer can send the answer unchanged or have AI rewrite it in a friendly tone;
the result is then sent to the customer without a second approval. Customer,
agent, human, and outbound email messages are logged in Airtable.

The customer-facing Gmail credential must authenticate the exact sender
`hello@vibetv.shop`; a display name or Reply-To value is not a substitute for the
authenticated From address.

## Release check

Keep the feature disabled until a production test URL is available. Before
enabling it, test session restore, new-conversation reset, streaming or
non-streaming response handling, all allowed origins, network-error fallback,
small Windows WebView sizes, and the absence of sensitive request fields.
