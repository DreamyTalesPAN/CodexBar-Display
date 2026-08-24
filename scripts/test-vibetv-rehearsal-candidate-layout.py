#!/usr/bin/env python3
"""Exercises the firmware-URL rewrite from scripts/lib/vibetv-rehearsal.sh.

The block is extracted from the library rather than restated here, so a change
to the real rewrite is what this checks.
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

library, rc_manifest = (pathlib.Path(argument) for argument in sys.argv[1:3])

blocks = re.findall(r"<<'PY'\n(.*?)\nPY\n", library.read_text(), re.S)
rewrite = [block for block in blocks if 'artifact["firmwareUrl"] = ' in block]
if len(rewrite) != 1:
    raise SystemExit(f"expected one firmwareUrl rewrite block in the library, found {len(rewrite)}")
rewrite = rewrite[0]

BASE = "http://127.0.0.1:59999"
BOARD = "esp8266-smalltv-st7789"
ASSET = "codexbar-display-firmware-esp8266_smalltv_st7789-v1.0.54.bin.gz"

MERGE_GATE = {
    "schemaVersion": 1,
    "artifacts": [{"firmwareEnv": "esp8266_smalltv_st7789", "board": BOARD,
                   "firmwareVersion": "1.0.40", "asset": "firmware.bin",
                   "firmwareUrl": "firmware.bin"}],
}

failures = []


def run(manifest, asset):
    work = pathlib.Path(tempfile.mkdtemp()) / "firmware-manifest.json"
    if isinstance(manifest, pathlib.Path):
        shutil.copy(manifest, work)
    else:
        work.write_text(json.dumps(manifest))
    result = subprocess.run([sys.executable, "-c", rewrite, str(work), BASE, BOARD, asset],
                            capture_output=True, text=True)
    return result, (json.loads(work.read_text()) if result.returncode == 0 else None)


# A release candidate: absolute release URLs, two boards, release not published yet.
result, patched = run(rc_manifest, ASSET)
if result.returncode != 0:
    failures.append(f"release candidate manifest was rejected: {result.stderr.strip()}")
else:
    entries = {item["board"]: item["firmwareUrl"] for item in patched["artifacts"]}
    if entries.get(BOARD) != f"{BASE}/{ASSET}":
        failures.append(f"this board was not repointed at the local server: {entries.get(BOARD)}")
    other = [url for board, url in entries.items() if board != BOARD]
    if not all(url.startswith("https://github.com/") for url in other):
        failures.append(f"another board was repointed at a server that does not serve it: {other}")

# The merge gate: a bare asset name, one board.
result, patched = run(MERGE_GATE, "firmware.bin")
if result.returncode != 0:
    failures.append(f"merge gate manifest was rejected: {result.stderr.strip()}")
elif patched["artifacts"][0]["firmwareUrl"] != f"{BASE}/firmware.bin":
    failures.append(f"merge gate URL not rewritten: {patched['artifacts'][0]['firmwareUrl']}")

# A manifest with no entry for this board must be refused, not silently served.
result, _ = run({"schemaVersion": 1, "artifacts": [
    {"board": "esp32-display", "asset": "other.bin", "firmwareUrl": "other.bin"}]}, ASSET)
if result.returncode == 0:
    failures.append("a manifest without an entry for this board was accepted")

for problem in failures:
    print(f"FAIL: firmware URL rewrite: {problem}", file=sys.stderr)
raise SystemExit(1 if failures else 0)
