# AI Theme Builder beta setup

The feature is off unless the local Companion starts with `VIBETV_AI_THEME_ENABLED=1`. This flag is for selected team/customer beta builds only. For local browser development, also set `VIBETV_AI_THEME_DEV_ORIGINS=1`; production builds must not set the development exception.

Open Theme Studio in the local VibeTV Control Center, enter the customer's own OpenAI key, and use Test key to verify image-model access. The key is saved by the OS credential manager under service `shop.vibetv.control-center.ai-theme`, account `openai`. Removing the key deletes that credential.

Choose Create concept for a new static screenmaster. Refine concept edits that single concept using a new prompt. The central preview is already the hardware-ready 240x240 composition. Build theme performs the local `CBI1`/ThemeSpec assembly without changing the preview; Apply is the only editor mutation. Discard and Back to concept leave the editor unchanged. No personal image upload, animation/GIF generation, existing-theme improvement, VibeTV-funded credit, cloud sync, Windows shell/installer, firmware change, hardware write, release, or rollout is included.
