#!/usr/bin/env python3
"""Validate one immutable VibeTV candidate and freeze its publishable assets."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


SEMVER = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$"
)
SHA1 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class GateError(ValueError):
    """A release-gate contract was not satisfied."""


def fail(message: str) -> None:
    raise GateError(message)


def read_json(path: str | Path, label: str) -> dict:
    try:
        body = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read {label}: {exc}")
    if not isinstance(body, dict):
        fail(f"{label} must be a JSON object")
    return body


def write_json(path: Path, body: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def timestamp(value: object, label: str) -> dt.datetime:
    if not isinstance(value, str) or not value:
        fail(f"{label} must be an ISO-8601 timestamp")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = dt.datetime.fromisoformat(normalized)
    except ValueError:
        fail(f"{label} must be an ISO-8601 timestamp")
    if parsed.tzinfo is None:
        fail(f"{label} must include a timezone")
    return parsed.astimezone(dt.timezone.utc)


def required(body: dict, keys: tuple[str, ...], label: str) -> None:
    for key in keys:
        if key not in body:
            fail(f"{label} missing {key}")


def exact_identity(
    body: dict,
    *,
    repository: str,
    source_sha: str,
    version: str,
    candidate_run_id: str,
    label: str,
) -> None:
    expected = {
        "repository": repository,
        "sourceSha": source_sha,
        "version": version,
        "candidateRunId": candidate_run_id,
    }
    for key, value in expected.items():
        if str(body.get(key, "")) != value:
            fail(f"{label} {key} does not match the requested candidate")


def safe_artifact(candidate_dir: Path, relative: object) -> Path:
    if (
        not isinstance(relative, str)
        or not relative
        or "\n" in relative
        or "\r" in relative
        or "\\" in relative
    ):
        fail("candidate artifact path must be a safe non-empty relative path")
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        fail("candidate artifact path must stay inside the candidate bundle")
    root = candidate_dir.resolve()
    path = (root / relative_path).resolve()
    if root not in path.parents or not path.is_file():
        fail(f"candidate artifact is missing or unsafe: {relative}")
    return path


def validate_candidate(
    candidate_dir: Path,
    *,
    repository: str,
    source_sha: str,
    version: str,
    candidate_run_id: str,
) -> tuple[dict, dict[str, str], list[dict]]:
    manifest_path = candidate_dir / "candidate-manifest.json"
    manifest = read_json(manifest_path, "candidate manifest")
    required(
        manifest,
        (
            "schemaVersion",
            "repository",
            "sourceSha",
            "version",
            "candidateRunId",
            "createdAt",
            "artifacts",
            "virtualGate",
        ),
        "candidate manifest",
    )
    if manifest["schemaVersion"] != 1:
        fail("candidate manifest schemaVersion must be 1")
    exact_identity(
        manifest,
        repository=repository,
        source_sha=source_sha,
        version=version,
        candidate_run_id=candidate_run_id,
        label="candidate manifest",
    )
    timestamp(manifest["createdAt"], "candidate manifest createdAt")
    gate = manifest["virtualGate"]
    if (
        not isinstance(gate, dict)
        or gate.get("result") != "pending"
        or str(gate.get("runId", "")) != candidate_run_id
    ):
        fail("candidate manifest virtualGate must remain pending for candidate run")
    artifacts = manifest["artifacts"]
    if not isinstance(artifacts, list) or not artifacts:
        fail("candidate manifest artifacts must be a non-empty array")

    hashes: dict[str, str] = {}
    names: set[str] = set()
    for item in artifacts:
        if not isinstance(item, dict):
            fail("candidate manifest artifact must be an object")
        required(
            item,
            ("name", "path", "sha256", "role", "publish"),
            "candidate artifact",
        )
        name = item["name"]
        relative = item["path"]
        expected_hash = item["sha256"]
        role = item["role"]
        if not all(
            isinstance(value, str) and value
            for value in (name, relative, expected_hash, role)
        ):
            fail("candidate artifact fields must be non-empty strings")
        if not isinstance(item["publish"], bool):
            fail("candidate artifact publish must be a boolean")
        required_prefix = "publish/" if item["publish"] else "test/"
        if not relative.startswith(required_prefix):
            fail(
                f"candidate artifact {relative} must be under {required_prefix}"
            )
        if name != Path(relative).name or name in names:
            fail("candidate artifact names must be unique path basenames")
        if relative in hashes:
            fail("candidate artifact paths must be unique")
        if not SHA256.fullmatch(expected_hash):
            fail(f"candidate artifact sha256 is invalid: {relative}")
        actual_hash = digest(safe_artifact(candidate_dir, relative))
        if actual_hash != expected_hash:
            fail(f"candidate artifact sha256 mismatch: {relative}")
        names.add(name)
        hashes[relative] = actual_hash
    publish_artifacts = validate_publish_scope(
        candidate_dir,
        artifacts,
        repository=repository,
        version=version,
    )
    return manifest, hashes, publish_artifacts


def validate_publish_scope(
    candidate_dir: Path,
    artifacts: list[dict],
    *,
    repository: str,
    version: str,
) -> list[dict]:
    published = [item for item in artifacts if item["publish"] is True]
    published_names = {item["name"] for item in published}
    required_names = {
        "VibeTV-Control-Center.dmg",
        "appcast.xml",
        "install.sh",
        "install-control-center-companion.sh",
        f"codexbar-display-darwin-amd64-v{version}",
        f"codexbar-display-darwin-arm64-v{version}",
        "firmware-manifest.json",
        f"firmware-manifest-v{version}.json",
        f"checksums-v{version}.txt",
    }
    missing = sorted(required_names - published_names)
    if missing:
        fail(f"candidate publish scope is missing required assets: {', '.join(missing)}")

    signed_dmg_items = [
        item
        for item in published
        if item["name"] == "VibeTV-Control-Center.dmg" and item["role"] == "signed-dmg"
    ]
    if len(signed_dmg_items) != 1:
        fail("candidate publish scope must identify one signed DMG")

    notarization_items = [
        item for item in artifacts if item["role"] == "notarization-evidence"
    ]
    if len(notarization_items) != 1 or notarization_items[0]["publish"]:
        fail("candidate must contain one test-only notarization evidence artifact")
    notarization = read_json(
        safe_artifact(candidate_dir, notarization_items[0]["path"]),
        "notarization evidence",
    )
    if notarization.get("status") != "Accepted":
        fail("notarization evidence must report Accepted")
    if notarization.get("issues") not in (None, []):
        fail("notarization evidence must contain no issues")

    firmware_artifacts = [
        item
        for item in artifacts
        if item["role"].startswith("firmware")
        or item["name"].startswith("firmware-")
    ]
    if not any(
        item["publish"] is True and item["role"] == "firmware"
        for item in firmware_artifacts
    ):
        fail("candidate publish scope must include at least one firmware artifact")
    unpublished_firmware = [
        item["name"] for item in firmware_artifacts if item["publish"] is not True
    ]
    if unpublished_firmware:
        fail(
            "candidate publish scope excludes firmware assets: "
            + ", ".join(sorted(unpublished_firmware))
        )

    for item in artifacts:
        if item["role"] in {"virtual-vibetv", "test-companion", "universal-companion"}:
            if item["publish"] is not False:
                fail(f"test-only artifact must have publish=false: {item['name']}")

    release_prefix = (
        f"https://github.com/{repository}/releases/download/v{version}/"
    )
    appcast_items = [
        item
        for item in published
        if item["name"] == "appcast.xml"
        and item["role"] == "sparkle-appcast"
    ]
    if len(appcast_items) != 1:
        fail("candidate publish scope must identify one Sparkle appcast")
    appcast = safe_artifact(candidate_dir, appcast_items[0]["path"])
    try:
        root = ET.parse(appcast).getroot()
    except (ET.ParseError, OSError) as exc:
        fail(f"Sparkle appcast is invalid XML: {exc}")
    enclosure_urls = [
        element.attrib.get("url")
        for element in root.iter()
        if element.tag.rsplit("}", 1)[-1] == "enclosure"
    ]
    if not enclosure_urls or any(not url for url in enclosure_urls):
        fail("Sparkle appcast must contain enclosure URL values")
    for url in enclosure_urls:
        asset = url.removeprefix(release_prefix) if url else ""
        if (
            not url
            or url != release_prefix + asset
            or asset not in published_names
            or "/" in asset
        ):
            fail(f"appcast enclosure URL is not the exact release asset URL: {url}")
    signatures = [
        value
        for element in root.iter()
        for key, value in element.attrib.items()
        if key.rsplit("}", 1)[-1] == "edSignature" and value
    ]
    if not signatures:
        fail("Sparkle appcast must contain an edSignature")

    manifest_items = [
        item
        for item in published
        if item["role"] == "firmware-manifest"
        or item["name"].startswith("firmware-manifest")
    ]
    hashes_by_name = {item["name"]: item["sha256"] for item in artifacts}
    for item in manifest_items:
        body = read_json(
            safe_artifact(candidate_dir, item["path"]),
            f"firmware manifest {item['name']}",
        )
        entries = body.get("artifacts")
        if not isinstance(entries, list) or not entries:
            fail(f"firmware manifest {item['name']} has no artifacts")
        for entry in entries:
            if not isinstance(entry, dict):
                fail(f"firmware manifest {item['name']} artifact must be an object")
            asset = entry.get("asset")
            url = entry.get("firmwareUrl")
            expected_hash = entry.get("sha256")
            if (
                not isinstance(asset, str)
                or asset not in published_names
                or url != release_prefix + asset
                or expected_hash != hashes_by_name.get(asset)
            ):
                fail(
                    f"firmwareUrl or sha256 in {item['name']} does not match the candidate asset"
                )
    return published


def validate_result(
    path: Path,
    *,
    repository: str,
    source_sha: str,
    version: str,
    candidate_run_id: str,
    hashes: dict[str, str],
) -> dict:
    result = read_json(path, "candidate result")
    required(
        result,
        (
            "schemaVersion",
            "repository",
            "sourceSha",
            "version",
            "candidateRunId",
            "result",
            "artifactHashes",
        ),
        "candidate result",
    )
    if result["schemaVersion"] != 1 or result["result"] != "success":
        fail("candidate result must have schemaVersion 1 and result success")
    exact_identity(
        result,
        repository=repository,
        source_sha=source_sha,
        version=version,
        candidate_run_id=candidate_run_id,
        label="candidate result",
    )
    if result["artifactHashes"] != hashes:
        fail("candidate result artifact hashes do not match candidate manifest")
    return result


def copy_artifacts(
    candidate_dir: Path, copy_dir: Path, publish_artifacts: list[dict]
) -> None:
    if copy_dir.exists() and any(copy_dir.iterdir()):
        fail("publish asset directory must be empty")
    copy_dir.mkdir(parents=True, exist_ok=True)
    for item in publish_artifacts:
        source = safe_artifact(candidate_dir, item["path"])
        destination = copy_dir / item["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def parse_semver(value: object, label: str) -> tuple[int, int, int]:
    match = SEMVER.fullmatch(str(value))
    if not match:
        fail(f"{label} must be SemVer x.y.z")
    return tuple(int(part) for part in match.groups())


def resolve_versions(args: argparse.Namespace) -> None:
    if args.firmware_mode not in {"unchanged", "bump"}:
        fail("firmware mode must be unchanged or bump")
    baselines = read_json(args.baseline_manifest, "baseline manifest")
    try:
        current_release = baselines["baselines"]["current_public"]["version"]
    except (KeyError, TypeError):
        fail("baseline manifest is missing current_public version")
    if parse_semver(args.release_version, "release version") <= parse_semver(
        current_release, "current public version"
    ):
        fail("release version must be newer than the current public release")

    defaults = read_json(args.defaults, "firmware defaults")
    public = read_json(args.current_firmware_manifest, "current firmware manifest")
    public_by_env = {
        item.get("firmwareEnv"): item
        for item in public.get("artifacts", [])
        if isinstance(item, dict)
    }
    artifacts = defaults.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        fail("firmware defaults must contain artifacts")
    for item in artifacts:
        if not isinstance(item, dict) or not item.get("firmwareEnv"):
            fail("firmware default artifact is invalid")
        current = public_by_env.get(item["firmwareEnv"])
        if not current:
            fail(f"public firmware is missing {item['firmwareEnv']}")
        version = list(
            parse_semver(current.get("firmwareVersion"), "public firmware version")
        )
        if args.firmware_mode == "bump":
            version[2] += 1
        item["firmwareVersion"] = ".".join(str(part) for part in version)
    write_json(Path(args.output), defaults)
    print(json.dumps(defaults, sort_keys=True))


def prepare(args: argparse.Namespace) -> None:
    if not SHA1.fullmatch(args.source_sha):
        fail("source SHA must be a lowercase 40-character Git SHA")
    if not args.candidate_run_id.isdigit():
        fail("candidate run id must contain digits only")

    candidate_dir = Path(args.candidate_dir).resolve()
    manifest = read_json(candidate_dir / "candidate-manifest.json", "candidate manifest")
    version = str(manifest.get("version", ""))
    if not SEMVER.fullmatch(version):
        fail("candidate version must be SemVer x.y.z without a leading v")
    manifest, hashes, publish_artifacts = validate_candidate(
        candidate_dir,
        repository=args.repository,
        source_sha=args.source_sha,
        version=version,
        candidate_run_id=args.candidate_run_id,
    )
    result_path = Path(args.candidate_result)
    validate_result(
        result_path,
        repository=args.repository,
        source_sha=args.source_sha,
        version=version,
        candidate_run_id=args.candidate_run_id,
        hashes=hashes,
    )

    copy_dir = Path(args.copy_dir)
    copy_artifacts(candidate_dir, copy_dir, publish_artifacts)
    payload = {
        "schemaVersion": 1,
        "repository": args.repository,
        "sourceSha": args.source_sha,
        "version": version,
        "tag": f"v{version}",
        "candidateRunId": args.candidate_run_id,
        "candidateManifestSha256": digest(
            candidate_dir / "candidate-manifest.json"
        ),
        "candidateResultSha256": digest(result_path),
        "artifacts": publish_artifacts,
    }
    write_json(Path(args.output), payload)
    print(json.dumps(payload, sort_keys=True))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    versions = commands.add_parser("resolve-versions")
    versions.add_argument("--baseline-manifest", required=True)
    versions.add_argument("--current-firmware-manifest", required=True)
    versions.add_argument("--defaults", required=True)
    versions.add_argument("--release-version", required=True)
    versions.add_argument("--firmware-mode", required=True)
    versions.add_argument("--output", required=True)
    versions.set_defaults(handler=resolve_versions)
    command = commands.add_parser("prepare")
    command.add_argument("--repository", required=True)
    command.add_argument("--source-sha", required=True)
    command.add_argument("--candidate-run-id", required=True)
    command.add_argument("--candidate-dir", required=True)
    command.add_argument("--candidate-result", required=True)
    command.add_argument("--output", required=True)
    command.add_argument("--copy-dir", required=True)
    command.set_defaults(handler=prepare)
    return root


def main() -> None:
    args = parser().parse_args()
    args.handler(args)


if __name__ == "__main__":
    try:
        main()
    except GateError as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
