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
    --archive) [[ -n "${2:-}" ]] || die '--archive needs a value'; ARCHIVE="$2"; shift 2 ;;
    --output) [[ -n "${2:-}" ]] || die '--output needs a value'; OUTPUT="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -f "$ARCHIVE" ]] || die "candidate app archive not found: $ARCHIVE"
[[ -n "$OUTPUT" && "$OUTPUT" != / ]] || die 'safe --output directory is required'
[[ ! -e "$OUTPUT" ]] || die "output path must not exist: $OUTPUT"

python3 - "$ARCHIVE" "$OUTPUT" <<'PY'
import os
import pathlib
import posixpath
import shutil
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
expected_root = "VibeTV Control Center.app"

def path_key(path):
    return tuple(part.casefold() for part in path.parts)

with tarfile.open(archive, "r:gz") as candidate:
    members = candidate.getmembers()
    if not members:
        raise SystemExit("candidate app archive is empty")
    member_keys = set()
    symlink_keys = set()
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"unsafe candidate archive path: {member.name}")
        if not path.parts or path.parts[0] != expected_root:
            raise SystemExit(f"unexpected candidate archive root: {member.name}")
        key = path_key(path)
        if key in member_keys:
            raise SystemExit(f"duplicate candidate archive path: {member.name}")
        member_keys.add(key)
        if member.issym():
            link = pathlib.PurePosixPath(member.linkname)
            resolved = pathlib.PurePosixPath(posixpath.normpath(str(path.parent / link)))
            if not member.linkname or link.is_absolute() or not resolved.parts or resolved.parts[0] != expected_root:
                raise SystemExit(f"unsafe candidate archive symlink: {member.name} -> {member.linkname}")
            symlink_keys.add(key)
        elif not (member.isdir() or member.isfile()):
            raise SystemExit(f"candidate archive contains a non-regular entry: {member.name}")
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if any(path_key(parent) in symlink_keys for parent in path.parents):
            raise SystemExit(f"candidate archive member descends through symlink: {member.name}")

    output.mkdir(parents=True)
    try:
        for member in members:
            path = pathlib.PurePosixPath(member.name)
            destination = output.joinpath(*path.parts)
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                destination.parent.mkdir(parents=True, exist_ok=True)
                source = candidate.extractfile(member)
                if source is None:
                    raise SystemExit(f"candidate archive file cannot be read: {member.name}")
                with source, destination.open("xb") as target:
                    shutil.copyfileobj(source, target)
                os.chmod(destination, member.mode & 0o777)

        for member in members:
            if not member.issym():
                continue
            path = pathlib.PurePosixPath(member.name)
            destination = output.joinpath(*path.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(member.linkname, destination)

        app_root = (output / expected_root).resolve()
        for member in members:
            if not member.issym():
                continue
            path = pathlib.PurePosixPath(member.name)
            destination = output.joinpath(*path.parts)
            try:
                resolved = destination.resolve(strict=True)
            except (OSError, RuntimeError):
                raise SystemExit(f"unsafe candidate archive symlink cannot resolve: {member.name}")
            if pathlib.Path(os.path.commonpath((app_root, resolved))) != app_root:
                raise SystemExit(f"candidate archive symlink resolves outside app: {member.name}")

        for member in reversed(members):
            if member.isdir():
                path = pathlib.PurePosixPath(member.name)
                os.chmod(output.joinpath(*path.parts), member.mode & 0o777)
    except BaseException:
        shutil.rmtree(output, ignore_errors=True)
        raise

app = output / expected_root
if not (app / "Contents" / "Info.plist").is_file():
    shutil.rmtree(output)
    raise SystemExit("candidate archive has no valid app Info.plist")
PY

printf 'Safely extracted candidate app archive: %s\n' "$OUTPUT"
