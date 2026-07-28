#!/usr/bin/env bash
set -euo pipefail

OUTPUT=""
REPOSITORY="${GITHUB_REPOSITORY:-DreamyTalesPAN/CodexBar-Display}"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) [[ -n "${2:-}" ]] || die '--output needs a value'; OUTPUT="$2"; shift 2 ;;
    --repository) [[ -n "${2:-}" ]] || die '--repository needs a value'; REPOSITORY="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$OUTPUT" ]] || die '--output is required'
command -v gh >/dev/null 2>&1 || die 'gh is required to resolve public release baselines'

mkdir -p "$(dirname "$OUTPUT")"
gh api --paginate "/repos/${REPOSITORY}/releases?per_page=100" > "${OUTPUT}.releases.json"
python3 - "${OUTPUT}.releases.json" "$OUTPUT" "$REPOSITORY" <<'PY'
import json
import re
import sys
from datetime import datetime, timezone

releases_path, output_path, repository = sys.argv[1:]
with open(releases_path, encoding="utf-8") as source:
    releases = json.load(source)

semver = re.compile(r"^v?(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?)$")
eligible = []
for release in releases:
    if release.get("draft") or release.get("prerelease"):
        continue
    match = semver.fullmatch(str(release.get("tag_name", "")).strip())
    if not match:
        continue
    assets = {asset.get("name"): asset.get("browser_download_url") for asset in release.get("assets", [])}
    dmg = assets.get("VibeTV-Control-Center.dmg")
    appcast = assets.get("appcast.xml")
    if dmg and appcast:
        eligible.append({
            "tag": release["tag_name"],
            "version": match.group(1),
            "dmgUrl": dmg,
            "appcastUrl": appcast,
            "publishedAt": release.get("published_at"),
        })

if len(eligible) < 2:
    raise SystemExit("need two public releases with VibeTV-Control-Center.dmg and appcast.xml")

manifest = {
    "schemaVersion": 1,
    "repository": repository,
    "resolvedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "baselines": {
        "current_public": eligible[0],
        "previous_public": eligible[1],
    },
}
with open(output_path, "w", encoding="utf-8") as destination:
    json.dump(manifest, destination, indent=2)
    destination.write("\n")
PY
rm -f "${OUTPUT}.releases.json"
printf 'Resolved frozen VibeTV public baselines: %s\n' "$OUTPUT"
