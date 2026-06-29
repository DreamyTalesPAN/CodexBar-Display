#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ]; then
  echo "error: must run inside a git repository" >&2
  exit 1
fi

hook_path="$(git rev-parse --git-path hooks/pre-push)"
hook_dir="$(dirname "$hook_path")"
mkdir -p "$hook_dir"

if [ -f "$hook_path" ] && ! grep -q "VibeTV agent git guardrails" "$hook_path"; then
  backup_path="${hook_path}.backup.$(date +%Y%m%d%H%M%S)"
  cp "$hook_path" "$backup_path"
  echo "Backed up existing pre-push hook to $backup_path"
fi

cat > "$hook_path" <<'HOOK'
#!/usr/bin/env bash
# VibeTV agent git guardrails
set -euo pipefail

remote_name="${1:-remote}"

block_push() {
  cat >&2 <<MSG

Blocked by VibeTV guardrail.
$1

This repo must not merge, release, push main, or push tags unless the user
explicitly approved that exact action in the current conversation.

Allowed overrides after explicit approval:
  VIBETV_ALLOW_MAIN_PUSH=1 git push $remote_name main
  VIBETV_ALLOW_RELEASE_TAG_PUSH=1 git push $remote_name <tag>

MSG
  exit 1
}

while read -r local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/main)
      if [ "${VIBETV_ALLOW_MAIN_PUSH:-}" != "1" ]; then
        block_push "Refusing to push main to $remote_name."
      fi
      ;;
    refs/tags/*)
      if [ "${VIBETV_ALLOW_RELEASE_TAG_PUSH:-}" != "1" ]; then
        block_push "Refusing to push tag ${remote_ref#refs/tags/} to $remote_name."
      fi
      ;;
  esac
done
HOOK

chmod +x "$hook_path"

echo "Installed VibeTV agent git guardrails:"
echo "  $hook_path"
echo
echo "Blocked by default:"
echo "  git push <remote> main"
echo "  git push <remote> <tag>"
echo
echo "Override only after explicit user approval:"
echo "  VIBETV_ALLOW_MAIN_PUSH=1"
echo "  VIBETV_ALLOW_RELEASE_TAG_PUSH=1"
