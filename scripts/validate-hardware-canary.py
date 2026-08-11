#!/usr/bin/env python3
"""Validate immutable VibeTV release-candidate bundles and canary evidence."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REQUIRED_ROLES = {"signed-dmg", "sparkle-appcast", "companion", "firmware-manifest", "firmware", "virtual-vibetv", "notarization-evidence"}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SHA1 = re.compile(r"^[0-9a-f]{40}$")

def fail(message):
    raise ValueError(message)

def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"read JSON {path}: {exc}")

def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def safe_file(root, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        fail("artifact path must be a non-empty relative path")
    path = (root / relative).resolve()
    if root.resolve() not in path.parents or not path.is_file():
        fail(f"candidate artifact missing: {relative}")
    return path

def candidate(root):
    root = Path(root).resolve()
    body = read_json(root / "candidate-manifest.json")
    for key in ("schemaVersion", "repository", "sourceSha", "version", "candidateRunId", "createdAt", "artifacts", "virtualGate"):
        if key not in body:
            fail(f"candidate manifest missing {key}")
    if body["schemaVersion"] != 1 or not isinstance(body["repository"], str) or not SHA1.fullmatch(str(body["sourceSha"])):
        fail("invalid candidate schema, repository, or sourceSha")
    if not isinstance(body["candidateRunId"], str) or not body["candidateRunId"].strip() or not isinstance(body["artifacts"], list):
        fail("invalid candidateRunId or artifacts")
    gate = body["virtualGate"]
    if not isinstance(gate, dict) or gate.get("result") != "pending" or str(gate.get("runId")) != str(body["candidateRunId"]):
        fail("candidate virtualGate must remain pending for the matching run")
    seen_paths, roles, hashes = set(), set(), {}
    for item in body["artifacts"]:
        if not isinstance(item, dict): fail("candidate artifact must be an object")
        for key in ("name", "path", "sha256", "role"):
            if not isinstance(item.get(key), str) or not item[key].strip(): fail(f"candidate artifact missing {key}")
        if not isinstance(item.get("publish"), bool): fail("candidate artifact publish must be boolean")
        if item["path"] in seen_paths or not SHA256.fullmatch(item["sha256"].lower()): fail("duplicate artifact path or invalid sha256")
        seen_paths.add(item["path"]); roles.add(item["role"])
        actual = digest(safe_file(root, item["path"]))
        if actual != item["sha256"].lower(): fail(f"candidate artifact sha256 mismatch: {item['path']}")
        hashes[item["path"]] = actual
    if not REQUIRED_ROLES.issubset(roles): fail("candidate is missing required artifact roles")
    notarization = next(item for item in body["artifacts"] if item["role"] == "notarization-evidence")
    if notarization["publish"] or read_json(safe_file(root, notarization["path"])).get("status") != "Accepted":
        fail("candidate notarization evidence is not Accepted")
    return body, hashes

def evidence(root, path):
    manifest, hashes = candidate(root)
    body = read_json(path)
    for key in ("schemaVersion", "repository", "sourceSha", "version", "candidateRunId", "candidateManifestSha256", "artifactHashes", "device", "checks", "timestamps", "actor", "result"):
        if key not in body: fail(f"evidence missing {key}")
    if body["schemaVersion"] != 1 or body["result"] not in {"success", "blocked", "unknown"}: fail("invalid evidence schema or result")
    for key in ("repository", "sourceSha", "version", "candidateRunId"):
        if str(body[key]) != str(manifest[key]): fail(f"evidence {key} does not match candidate")
    if body["candidateManifestSha256"] != digest(Path(root) / "candidate-manifest.json"): fail("evidence candidate manifest hash mismatch")
    if body["artifactHashes"] != hashes: fail("evidence artifact hashes do not match candidate")
    device = body["device"]
    if not isinstance(device, dict) or not all(isinstance(device.get(k), str) for k in ("deviceId", "board", "firmwareBefore", "firmwareAfter")): fail("invalid evidence device")
    checks = body["checks"]
    if not isinstance(checks, dict) or not all(isinstance(v, bool) for v in checks.values()): fail("invalid evidence checks")
    if body["result"] == "success" and not all(checks.get(k) is True for k in ("candidateVerified", "hello", "health", "daemonRender")): fail("success evidence lacks required checks")
    return body

def candidate_result(root, path):
    manifest, hashes = candidate(root)
    body = read_json(path)
    for key in ("schemaVersion", "repository", "sourceSha", "version", "candidateRunId", "result", "artifactHashes"):
        if key not in body: fail(f"candidate result missing {key}")
    if body["schemaVersion"] != 1 or body["result"] != "success": fail("candidate result is not successful")
    for key in ("repository", "sourceSha", "version", "candidateRunId"):
        if str(body[key]) != str(manifest[key]): fail(f"candidate result {key} does not match candidate")
    if body["artifactHashes"] != hashes: fail("candidate result artifact hashes do not match candidate")
    return body

def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("candidate", "candidate-result", "evidence"):
        p = sub.add_parser(name); p.add_argument("--candidate-dir", required=True)
        if name == "evidence": p.add_argument("--evidence", required=True)
        if name == "candidate-result": p.add_argument("--result", required=True)
    args = parser.parse_args()
    if args.command == "candidate": result = candidate(args.candidate_dir)[0]
    elif args.command == "candidate-result": result = candidate_result(args.candidate_dir, args.result)
    else: result = evidence(args.candidate_dir, args.evidence)
    print(json.dumps(result, sort_keys=True))

if __name__ == "__main__":
    try: main()
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr); sys.exit(1)
