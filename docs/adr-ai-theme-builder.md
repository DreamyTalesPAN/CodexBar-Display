# AI Theme Builder architecture decision

Status: Beta, disabled by default

The AI Theme Builder runs provider requests only in the local Go Companion bound to `127.0.0.1:47832`. The hosted Control Center has no AI provider route. The MVP uses fixed OpenAI HTTPS endpoints and models: `gpt-5.6-terra` plans a strict visual blueprint, while `gpt-image-2` generates or edits the text-free illustration. Redirects are disabled.

Provider keys are accessed through the `SecretStore` interface. The current implementation uses `github.com/zalando/go-keyring` v0.2.8, which maps to macOS Keychain now and keeps the AI core compatible with Windows Credential Manager. Keys never cross back to the browser. The browser stores at most 20 prompt/assistant messages per theme and non-secret timestamps; only the newest 10 turns are sent to a provider.

Concept generation is non-streaming and limited to one active request, five starts per ten minutes, 2,000 prompt characters, 120 seconds, 128 KiB of blueprint data, and 8 MiB of image response data. One semantic blueprint repair is allowed. The browser immediately scales the returned illustration to 240x128, quantizes it to at most 26 colors, and encodes one 30,720-pixel `CBI1` asset. A fixed layout adds Session and Weekly Remaining values and both progress bars, so the generated result is already a theme draft. The editor keeps the draft outside its document history until Apply; Apply creates one undo step, while Start over creates none.

Concept images and blueprints are session-only. Prompt history stores only bounded text messages; AI image data is excluded from `localStorage`, including Theme Studio recovery after Apply.

Windows app shell and installer work remains tracked separately in #217. The HTTP AI core and SecretStore boundary are platform-neutral; this decision does not add a Windows shell.
