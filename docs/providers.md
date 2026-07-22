# VibeTV Provider Support

VibeTV displays AI usage data through CodexBar. That means VibeTV does not have
one custom parser per provider. It reads the normalized provider data that
CodexBar exposes and renders whatever fields are available.

The short version: if CodexBar can return a provider in `codexbar usage --json`,
VibeTV can usually show that provider on the device and in Control Center.

## What VibeTV Can Render

Provider data is uneven. VibeTV supports these fields when CodexBar exposes
them:

- provider label
- session usage
- weekly or monthly usage
- reset time
- token counts
- credit or spend usage
- current provider selection
- provider status or stale-data state

If a provider does not expose one of those fields, VibeTV skips that field
instead of guessing.

## Common AI Builder Providers

These are the providers most relevant to the VibeTV desk-display story:

- Codex
- Claude / Claude Code
- Cursor
- Gemini
- Antigravity
- OpenCode
- OpenCode Go
- Droid / Factory
- Copilot
- Kimi
- Kimi K2
- Kilo
- Kiro
- Augment
- Amp
- JetBrains AI
- Zed
- Warp
- Codebuff
- Command Code
- Grok
- Devin
- Manus

## API, Credit, And Spend Providers

CodexBar also supports providers where the signal is more about credits, spend,
API usage, or account quota:

- OpenAI
- Azure OpenAI
- Claude Admin API
- z.ai
- MiniMax
- Vertex AI
- OpenRouter
- Mistral
- DeepSeek
- Moonshot / Kimi API
- AWS Bedrock
- LiteLLM
- LLM Proxy
- GroqCloud
- Deepgram
- ElevenLabs
- Poe
- Chutes
- Perplexity
- Ollama
- T3 Chat
- Synthetic
- Abacus AI
- Xiaomi MiMo
- Doubao
- Crof
- Venice
- StepFun
- Alibaba Coding Plan
- Alibaba Token Plan

## Current Activity Selection

When multiple providers are available, the Mac App tries to choose the one that
matters right now. It uses signals such as:

- recent local provider activity
- usage deltas
- token deltas
- sticky current provider
- CodexBar provider order

This is why VibeTV can stay useful even when a user moves between Codex, Claude,
Cursor, Gemini, and other tools during the same day.

## Token Stats

Token stats are read through:

```bash
codexbar cost --json
```

VibeTV maps reliable token stats to:

- session tokens
- week tokens
- total tokens

See [token-usage-support-matrix.md](token-usage-support-matrix.md) for the
details.

## Source Of Truth

The provider list changes as CodexBar changes. For implementation-level provider
details, use the upstream CodexBar docs:

- [CodexBar provider docs](https://github.com/steipete/CodexBar/blob/main/docs/providers.md)

For VibeTV behavior, use:

- [Usage polling architecture](usage-polling-architecture.md)
- [Token usage support matrix](token-usage-support-matrix.md)
- [Architecture](architecture.md)

## Provider Management

The Usage screen lists the complete provider inventory reported by the local
VibeTV Mac App, including disabled providers. Its switches change the real
CodexBar provider configuration; VibeTV does not keep a second provider list or
provider-selection setting.

The local API uses the typed [preferences registry](preferences.md). It returns
only safe health classifications. Raw provider errors and credentials never
reach the browser.
