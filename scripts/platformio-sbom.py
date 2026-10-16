#!/usr/bin/env python3
"""Write a CycloneDX SBOM for one PlatformIO firmware environment (#538).

Run after `pio pkg install` for the same environment. The component list is
what `pio pkg list` resolves for it: the platform, the platform packages
(framework, toolchain, upload tools) and the libraries. Test-only packages
such as Unity are not in that list. Libraries vendored under <project>/lib are
added from their library.json.

PlatformIO packages have no ecosystem in the OSV database, so this SBOM is a
component record for a manual check, not input for osv-scanner.

  scripts/platformio-sbom.py firmware_esp8266 esp8266_smalltv_st7789 <commit> out.cdx.json
"""

import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# "Platform espressif8266 @ 4.2.1 (required: ...)" and tree lines such as
# "├── framework-arduinoespressif8266 @ 3.30102.0 (required: platformio/... @ ~3)".
LINE = re.compile(
    r"^(?:Platform |[│ ]*[├└]── )(?P<name>\S+) @ (?P<version>\S+)"
    r"(?: \(required: (?:(?P<owner>[^/\s]+)/)?)?"
)


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def repo_url(manifest):
    repo = manifest.get("repository")
    if isinstance(repo, dict):
        repo = repo.get("url")
    return repo if isinstance(repo, str) and repo else None


def component(kind, name, version, owner, manifest):
    entry = {
        "type": kind,
        "bom-ref": f"{owner or 'local'}/{name}@{version}",
        "name": name,
        "version": version,
        "purl": f"pkg:generic/{owner}/{name}@{version}" if owner else f"pkg:generic/{name}@{version}",
    }
    if owner:
        entry["group"] = owner
    license_id = manifest.get("license")
    if isinstance(license_id, str) and license_id:
        entry["licenses"] = [{"expression": license_id}]
    url = repo_url(manifest)
    if url:
        entry["externalReferences"] = [{"type": "vcs", "url": url}]
    return entry


def main(argv):
    if len(argv) != 5:
        sys.exit(__doc__)
    project, env, commit, output = Path(argv[1]), argv[2], argv[3], Path(argv[4])
    core_dir = Path(os.environ.get("PLATFORMIO_CORE_DIR", Path.home() / ".platformio"))

    listing = subprocess.run(
        ["pio", "pkg", "list", "-d", str(project), "-e", env],
        check=True, capture_output=True, text=True,
    ).stdout

    components = []
    section = None
    for raw in listing.splitlines():
        if raw.startswith("Platform "):
            section = "platform"
        elif raw.strip() == "Libraries":
            section = "library"
            continue
        match = LINE.match(raw)
        if not match or section is None:
            continue
        name, version, owner = match["name"], match["version"], match["owner"]
        if raw.startswith("Platform "):
            manifest = read_json(core_dir / "platforms" / name / "platform.json")
            components.append(component("platform", name, version, "platformio", manifest))
        elif section == "platform":
            manifest = read_json(core_dir / "packages" / name / "package.json")
            kind = "framework" if name.startswith("framework-") else "application"
            components.append(component(kind, name, version, owner or "platformio", manifest))
        else:
            manifest = read_json(project / ".pio" / "libdeps" / env / name / "library.json")
            components.append(component("library", name, version, owner, manifest))

    if not components:
        sys.exit(f"pio pkg list returned no packages for {env}:\n{listing}")

    for library_json in sorted((project / "lib").glob("*/library.json")):
        manifest = read_json(library_json)
        name = manifest.get("name") or library_json.parent.name
        entry = component("library", name, manifest.get("version", "unknown"), None, manifest)
        entry["description"] = manifest.get("description", "vendored library")
        entry["properties"] = [{"name": "vibetv:source", "value": f"vendored in {project}/lib"}]
        components.append(entry)

    bom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tools": [{"name": "scripts/platformio-sbom.py"}],
            "component": {
                "type": "firmware",
                "bom-ref": f"vibetv-firmware-{env}",
                "name": f"vibetv-firmware-{env}",
                "version": commit,
            },
        },
        "components": components,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(bom, indent=2) + "\n", encoding="utf-8")
    print(f"{output}: {len(components)} components")


if __name__ == "__main__":
    main(sys.argv)
