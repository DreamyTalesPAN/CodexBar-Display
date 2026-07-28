Use this naming convention for n8n workflows: always prefix the name with CODEX. Do the same for GitHub repositories.
Before using trial and error on an error, search for the error or read the official documentation first.
When the task is complete, do not overwhelm the user with "If you want, I can..." suggestions unless they are genuinely useful.
When writing in German, use umlauts.
Before building anything, check once per chat whether the remote branch is ahead of the local branch. If it is, fetch first. Perform this check only once per chat.

## Primary Development Principle: Maximum Simplicity, Minimum Code

- The goal of every change is the desired outcome with as little code, complexity, state, abstraction, and special-case handling as possible.
- Always work in this order:
  1. Delete unnecessary code.
  2. Simplify or consolidate existing code.
  3. Write new code only when the first two steps are insufficient.
- Before adding code, check whether deleting or simplifying existing code can achieve the goal.
- Prefer one small central solution over multiple local special cases.
- Do not add speculative abstractions, frameworks, configuration options, fallbacks, or compatibility layers without a concrete current requirement.
- When multiple solutions are correct, choose the one with less code and fewer moving parts.
- Before finishing, review the complete diff against `main` and remove everything that is not strictly required for the desired outcome.
- Simplicity does not mean omitting required functionality, tests, error handling, or safety mechanisms.

## Merge, Release, and Production Guardrails

- Never run `gh pr merge`, merge into `main` with `git merge`, run `git push origin main`, create a tag with `git tag`, run `git push origin refs/tags/*`, run `gh release ...`, or trigger a release workflow unless the user gives explicit approval in the current conversation for that exact action and target.
- Approval to `deploy`, make the `live app ready`, `push branch`, `check`, `prepare`, `test`, or `fix` is not approval to merge, push `main`, release, or tag.
- Before every merge, `main` push, tag, or release action, state the action, target, and risk in a separate message and wait for explicit confirmation. Stop without confirmation.
- Deploying `app.vibetv.shop` is a different action from merging `main` or creating a release tag.
- Local Git guardrails must be active: `./scripts/install-agent-git-guardrails.sh` installs a `pre-push` hook that blocks `main` pushes and tag pushes unless an override is deliberately set.
- If a prohibited action is started accidentally, stop immediately, cancel running release jobs, remove local and remote tags, report the status, and make no further changes to `main` without new approval.

## Live VibeTV Guardrails

- The connected VibeTV is not a routine test target.
- Do not perform firmware updates, theme-pack installs, asset uploads, `POST /v1/themes/install`, `codexbar-display theme-pack install`, `POST /assets`, `POST /theme/active`, `POST /frame`, `POST /reset-wifi`, or similar writes to a device IP without current, explicit user approval for that exact hardware test.
- Read-only checks are allowed: `GET /hello`, `GET /health`, `GET /assets`, Companion `GET /v1/status`, `GET /v1/device`, and `POST /v1/device/discover`.
- Before a hardware write test, clearly state in the chat which device and command are involved, what the risk is, and that the user wants to test now.
- After a failed hardware write test, do not retry without new explicit approval.
- Tagging a release, merging, or pushing `main` is also governed by the Merge, Release, and Production Guardrails above.
