#!/usr/bin/env bash
set -euo pipefail

# Fails if an ESP8266 firmware build would use another flash layout than
# eagle.flash.4m2m.ld (issue #310). Devices that came with the GeekMagic factory
# firmware still carry its LittleFS at 0x100000. With the 4m2m layout our
# filesystem starts at 0x200000 and never sees it. A layout with a bigger
# filesystem (for example eagle.flash.4m3m.ld) starts at 0x100000 and would
# mount the factory files on every device already sold.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INI="${1:-${ROOT_DIR}/firmware_esp8266/platformio.ini}"
REQUIRED="eagle.flash.4m2m.ld"

[[ -f "$INI" ]] || { printf 'error: %s not found\n' "$INI" >&2; exit 2; }

python3 - "$INI" "$REQUIRED" <<'PY'
import configparser, re, sys

ini, required = sys.argv[1], sys.argv[2]
cp = configparser.ConfigParser(interpolation=None, strict=False, inline_comment_prefixes=(";",))
cp.read(ini)

# PlatformIO's own ${section.option} interpolation; "this" is the env being read.
REF = re.compile(r"\$\{([^.}]+)\.([^}]+)\}")

def resolve(text, env, depth=0):
    if depth > 10:
        sys.exit(f"error: interpolation loop in [{env}]")
    def sub(match):
        section, key = match.group(1), match.group(2)
        if section == "sysenv":
            return match.group(0)
        found = raw(env if section == "this" else section, key)
        return "" if found is None else resolve(found, env, depth + 1)
    return REF.sub(sub, text)

def chain(section, key, seen=()):
    if section in seen:
        sys.exit(f"error: extends loop at [{section}]")
    if cp.has_option(section, key) and section != "env":
        return cp.get(section, key).strip()
    if cp.has_option(section, "extends"):
        # PlatformIO: with several parents the latter one wins.
        for parent in reversed(cp.get(section, "extends").split(",")):
            found = chain(parent.strip(), key, seen + (section,))
            if found is not None:
                return found
    return None

def raw(section, key):
    # The common [env] defaults apply only after the whole extends chain.
    found = chain(section, key)
    if found is None and cp.has_option("env", key):
        found = cp.get("env", key).strip()
    return found

def value(env, key):
    found = raw(env, key)
    return None if found is None else resolve(found, env).strip()

bad, checked = [], []
for section in cp.sections():
    if not section.startswith("env:"):
        continue
    platform = value(section, "platform") or ""
    # Covers espressif8266@x, platformio/espressif8266@x and repository URLs.
    if "espressif8266" not in platform:
        continue
    checked.append(section)
    ldscript = value(section, "board_build.ldscript")
    if ldscript != required:
        bad.append(f"[{section}] uses {ldscript or 'the board default'}")

if not checked:
    sys.exit(f"error: no ESP8266 environment found in {ini}")
if bad:
    print(f"flash layout: FAIL, every ESP8266 build must use {required} (issue #310)", file=sys.stderr)
    for line in bad:
        print(f"  {line}", file=sys.stderr)
    print("  Devices already sold keep the factory filesystem at 0x100000; another layout can mount it.", file=sys.stderr)
    sys.exit(1)
print(f"flash layout: ok, {len(checked)} ESP8266 builds use {required}")
PY
