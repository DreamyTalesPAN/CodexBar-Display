# AI Theme Builder architecture decision

Status: Beta, disabled by default

The AI Theme Builder runs provider requests only in the local Go Companion bound to `127.0.0.1:47832`. The hosted Control Center has no AI provider route. OpenAI and Anthropic use small, explicit HTTP adapters with fixed HTTPS endpoints and fixed models (`gpt-5.6-terra` and `claude-sonnet-5`); redirects are disabled.

Provider keys are accessed through the `SecretStore` interface. The current implementation uses `github.com/zalando/go-keyring` v0.2.8, which maps to macOS Keychain now and keeps the AI core compatible with Windows Credential Manager. Keys never cross back to the browser. The browser stores at most 20 prompt/assistant messages per theme and non-secret timestamps; only the newest 10 turns are sent to a provider.

Generation is non-streaming and limited to one active request, five starts per ten minutes, 2,000 prompt characters, 4,096 output tokens, 45 seconds, 128 KiB of response data, and 16 generated primitives. The provider returns a candidate that is validated against the existing ThemeSpec rules and AI restrictions. One semantic repair request is allowed. The editor keeps the candidate outside its document history until Apply; Apply creates one undo step, while Discard creates none.

Windows app shell and installer work remains tracked separately in #217. The HTTP AI core and SecretStore boundary are platform-neutral; this decision does not add a Windows shell.
