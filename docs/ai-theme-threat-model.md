# AI Theme Builder threat model

## Assets and trust boundaries

Provider credentials, customer prompts, concept images, blueprints, local ThemeSpecs, and usage bindings are sensitive. The browser UI is less trusted than the local Companion; OpenAI is an external system. VibeTV hardware and firmware are outside this feature.

## Main threats and controls

- **Credential theft:** keys live in the OS credential store and are never returned, logged, serialized into ThemeSpec/ZIP, or persisted in browser storage. The password field is cleared after every credential response.
- **Public proxy or SSRF:** there is no public Next.js AI route. Sensitive Companion routes require a loopback Host and the Companion-served same origin. Development origins require an explicit environment switch. Provider URLs and models are constants, HTTPS-only, and redirects are disabled.
- **Resource abuse:** one active request, five requests per ten minutes, bounded input/history/output, a 120-second timeout, cancellation, a 128 KiB blueprint cap, an 8 MiB image cap, and a 12 MiB request cap.
- **Malicious or invalid output:** the strict blueprint schema is validated locally. The client converts only PNG image data into a single 240x128, maximum-26-color `CBI1` asset and builds fixed geometry with both usage bindings. The resulting ThemeSpec and asset are validated by the existing rules.
- **Browser persistence:** concept images and blueprints exist only in React session state. Local prompt history contains text only. Theme Studio recovery is skipped for the AI screenmaster asset so generated image bytes never enter `localStorage`.
- **Accidental overwrite:** generated candidates stay isolated. Apply is the only editor mutation and creates exactly one undo entry; Discard has no document effect.
- **Secret disclosure in errors:** provider bodies are discarded for errors and mapped to stable customer-safe codes.

Residual risk: OpenAI necessarily receives the user-entered prompt and, during Refine, the previous concept image and non-secret blueprint. Beta builds must communicate this boundary and remain opt-in.
