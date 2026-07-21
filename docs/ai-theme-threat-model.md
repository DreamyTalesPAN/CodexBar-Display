# AI Theme Builder threat model

## Assets and trust boundaries

Provider credentials, customer prompts, local ThemeSpecs, and usage bindings are sensitive. The browser UI is less trusted than the local Companion; providers are external systems. VibeTV hardware and firmware are outside this feature.

## Main threats and controls

- **Credential theft:** keys live in the OS credential store and are never returned, logged, serialized into ThemeSpec/ZIP, or persisted in browser storage. The password field is cleared after every credential response.
- **Public proxy or SSRF:** there is no public Next.js AI route. Sensitive Companion routes require a loopback Host and the Companion-served same origin. Development origins require an explicit environment switch. Provider URLs and models are constants, HTTPS-only, and redirects are disabled.
- **Resource abuse:** one active generation, five generations per ten minutes, bounded input/history/output, a 45-second timeout, cancellation, and a 128 KiB response cap.
- **Malicious or invalid output:** strict provider JSON schemas are followed by local parsing, existing ThemeSpec validation, 240x240 bounds, 4,096-byte and 16-primitive limits, and URL/Base64 rejection. Create mode permits only rect, text, progress, and pixels. Improve mode may retain existing asset references, but asset bytes are never sent.
- **Accidental overwrite:** generated candidates stay isolated. Apply is the only editor mutation and creates exactly one undo entry; Discard has no document effect.
- **Secret disclosure in errors:** provider bodies are discarded for errors and mapped to stable customer-safe codes.

Residual risk: provider prompts necessarily disclose the user-entered prompt and the non-secret ThemeSpec used for Improve. Beta builds must communicate this boundary and remain opt-in.
