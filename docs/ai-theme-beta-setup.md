# AI Theme Builder beta setup

The feature is off unless the local Companion starts with `VIBETV_AI_THEME_ENABLED=1`. This flag is for selected team/customer beta builds only. For local browser development, also set `VIBETV_AI_THEME_DEV_ORIGINS=1`; production builds must not set the development exception.

Open Theme Studio in the local VibeTV Control Center, choose OpenAI or Anthropic, enter the customer's own provider key, and use the key button to store and verify it. The key is saved by the OS credential manager under service `shop.vibetv.control-center.ai-theme`, account `openai` or `anthropic`. Removing a key deletes that credential.

Choose Create for a new prompt-only theme or Improve to send the current non-secret ThemeSpec as context. Review the isolated candidate, then Apply or Discard. Refine uses a new prompt; Regenerate repeats the current prompt. No personal image upload, image generation, VibeTV-funded credit, cloud sync, Windows shell/installer, firmware change, hardware write, release, or rollout is included.
