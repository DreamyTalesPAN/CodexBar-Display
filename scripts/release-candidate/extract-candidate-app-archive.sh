#!/usr/bin/env bash
set -euo pipefail

ARCHIVE=""
OUTPUT=""

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive) [[ -n "${2:-}" ]] || die "--archive needs a value"; ARCHIVE="$2"; shift 2 ;;
    --output) [[ -n "${2:-}" ]] || die "--output needs a value"; OUTPUT="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -f "$ARCHIVE" ]] || die "candidate app archive not found: $ARCHIVE"
[[ -n "$OUTPUT" && "$OUTPUT" != "/" ]] || die "safe --output directory is required"
[[ ! -e "$OUTPUT" ]] || die "output path must not exist: $OUTPUT"

python3 - "$ARCHIVE" "$OUTPUT" <<'PY'
import pathlib
import shutil
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
expected_root = "VibeTV Control Center.app"

with tarfile.open(archive, "r:gz") as candidate:
    members = candidate.getmembers()
    if not members:
        raise SystemExit("candidate app archive is empty")
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"unsafe candidate archive path: {member.name}")
        if not path.parts or path.parts[0] != expected_root:
            raise SystemExit(f"unexpected candidate archive root: {member.name}")
        if not (member.isdir() or member.isfile()):
            raise SystemExit(f"candidate archive contains a non-regular entry: {member.name}")
    output.mkdir(parents=True)
    candidate.extractall(output)

app = output / expected_root
if not (app / "Contents" / "Info.plist").is_file():
    shutil.rmtree(output)
    raise SystemExit("candidate archive has no valid app Info.plist")
PY

printf 'Safely extracted candidate app archive: %s\n' "$OUTPUT"
