# Customer Service Chat

The VibeTV Control Center embeds the official `@n8n/chat` client in the local
Control Center, hosted setup, and recovery surfaces. The feature is disabled by
default and connects directly to a published n8n Chat Trigger. The n8n workflow
and support agent are managed separately from this repository.

## Control Center configuration

Set these public build-time variables before building the Control Center:

```text
NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_ENABLED=1
NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_WEBHOOK_URL=https://n8n.example.com/webhook/...
NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_STREAMING_ENABLED=1
```

The button is not rendered unless the enabled flag is `1` and the webhook URL
is valid. HTTPS is required outside loopback development. Streaming is enabled
unless its flag is `0`; the client does not retry automatically in another mode.
The streaming flag and the Chat Trigger response mode must always match.

These values are public browser configuration. Never put Basic Auth, API keys,
tokens, or other secrets in them.

## Client request contract

The client uses the n8n defaults `sessionId` and `chatInput`. It persists the
official `n8n-chat/sessionId` local-storage key across reloads. **New
conversation** removes only that key and lets the chat client create a new
session.

Each request contains only this metadata:

```json
{
  "source": "vibetv-control-center",
  "surface": "local-control-center | hosted-setup | recovery",
  "platform": "macos | windows | web | unknown",
  "appVersion": "optional",
  "companionVersion": "optional",
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
belong in the n8n workflow. The agent may collect contact information and create
a support ticket or email only after the customer explicitly confirms it. Wire
error outputs for every fallible ticket or email node and attach a workflow-level
error workflow so a production failure is visible in n8n instead of timing out
silently.

## Release check

Keep the feature disabled until a production test URL is available. Before
enabling it, test session restore, new-conversation reset, streaming or
non-streaming response handling, all allowed origins, network-error fallback,
small Windows WebView sizes, and the absence of sensitive request fields.
