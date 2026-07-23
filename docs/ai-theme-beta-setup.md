# AI Theme Builder beta setup

The feature is off unless the local Companion starts with `VIBETV_AI_THEME_ENABLED=1`. This flag is for selected team/customer beta builds only. For local browser development, also set `VIBETV_AI_THEME_DEV_ORIGINS=1`; production builds must not set the development exception.

Open Theme Studio in the local VibeTV Control Center, enter the customer's own OpenAI key, and use Test key to verify image-model access. The key is saved by the OS credential manager under service `shop.vibetv.control-center.ai-theme`, account `openai`. Removing the key deletes that credential.

Choose Create theme draft for a new static screenmaster theme. Refine draft edits that same draft using a new prompt. The central preview is already the hardware-ready 240x240 composition and ready to apply. Apply is the only editor mutation; Start over clears the AI draft and chat without changing the editor. No personal image upload, animation/GIF generation, existing-theme improvement, VibeTV-funded credit, cloud sync, Windows shell/installer, firmware change, hardware write, release, or rollout is included.
