#!/usr/bin/env python3
"""Fixture tests for the immutable VibeTV publish gate."""

from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts/validate-release-publish-gate.py"
FIXTURE = ROOT / "scripts/fixtures/release-publish-gate/valid.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PublishGateFixtureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.case_root = Path(self.temp.name)
        self.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.paths = self._materialize(copy.deepcopy(self.fixture))

    def _write_json(self, name: str, body: dict) -> Path:
        path = self.case_root / name
        path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
        return path

    def _materialize(self, fixture: dict) -> dict[str, Path]:
        candidate_dir = self.case_root / "candidate"
        candidate_dir.mkdir()
        for relative, contents in fixture["files"].items():
            path = candidate_dir / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(contents, encoding="utf-8")

        hashes = {
            item["path"]: sha256(candidate_dir / item["path"])
            for item in fixture["candidateManifest"]["artifacts"]
        }
        for item in fixture["candidateManifest"]["artifacts"]:
            item["sha256"] = hashes[item["path"]]
        manifest = self._write_json(
            "candidate-manifest.json", fixture["candidateManifest"]
        )
        (candidate_dir / "candidate-manifest.json").write_bytes(manifest.read_bytes())

        fixture["candidateResult"]["artifactHashes"] = hashes
        return {
            "candidate_dir": candidate_dir,
            "candidate_result": self._write_json(
                "candidate-result.json", fixture["candidateResult"]
            ),
            "output": self.case_root / "publish/publish-payload.json",
            "copy_dir": self.case_root / "publish/assets",
        }

    def _command(self, **overrides: str) -> list[str]:
        values = {
            "repository": self.fixture["repository"],
            "source_sha": self.fixture["sourceSha"],
            "candidate_run_id": self.fixture["candidateRunId"],
        }
        values.update(overrides)
        return [
            "python3",
            str(VALIDATOR),
            "prepare",
            "--repository",
            values["repository"],
            "--source-sha",
            values["source_sha"],
            "--candidate-run-id",
            values["candidate_run_id"],
            "--candidate-dir",
            str(self.paths["candidate_dir"]),
            "--candidate-result",
            str(self.paths["candidate_result"]),
            "--output",
            str(self.paths["output"]),
            "--copy-dir",
            str(self.paths["copy_dir"]),
        ]

    def _run(self, **overrides: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            self._command(**overrides),
            text=True,
            capture_output=True,
            check=False,
        )

    def _resolve_versions(
        self, mode: str, release_version: str = "1.2.4"
    ) -> tuple[subprocess.CompletedProcess[str], Path]:
        baseline = self._write_json(
            "baseline.json",
            {"baselines": {"current_public": {"version": "1.2.3"}}},
        )
        defaults = self._write_json(
            "firmware-defaults.json",
            {
                "schemaVersion": 1,
                "artifacts": [
                    {"firmwareEnv": "esp8266", "firmwareVersion": "0.0.0"},
                    {"firmwareEnv": "esp32", "firmwareVersion": "0.0.0"},
                ],
            },
        )
        public = self._write_json(
            "public-firmware.json",
            {
                "artifacts": [
                    {"firmwareEnv": "esp8266", "firmwareVersion": "1.0.41"},
                    {"firmwareEnv": "esp32", "firmwareVersion": "1.0.36"},
                ]
            },
        )
        output = self.case_root / "effective-firmware.json"
        result = subprocess.run(
            [
                "python3",
                str(VALIDATOR),
                "resolve-versions",
                "--baseline-manifest",
                str(baseline),
                "--current-firmware-manifest",
                str(public),
                "--defaults",
                str(defaults),
                "--release-version",
                release_version,
                "--firmware-mode",
                mode,
                "--output",
                str(output),
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        return result, output

    def _rewrite(self, key: str, mutate) -> None:
        path = self.paths[key]
        body = json.loads(path.read_text(encoding="utf-8"))
        mutate(body)
        path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")

    def _rewrite_manifest_and_rebind(self, mutate) -> None:
        manifest_path = self.paths["candidate_dir"] / "candidate-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        mutate(manifest)
        manifest_path.write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )

    def _remove_manifest_artifact_and_rebind(self, name: str) -> None:
        manifest_path = self.paths["candidate_dir"] / "candidate-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        removed = next(
            item for item in manifest["artifacts"] if item["name"] == name
        )
        manifest["artifacts"] = [
            item for item in manifest["artifacts"] if item["name"] != name
        ]
        manifest_path.write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
        path = self.paths["candidate_result"]
        body = json.loads(path.read_text(encoding="utf-8"))
        body["artifactHashes"].pop(removed["path"])
        path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")

    def _replace_asset_and_rebind(self, relative: str, contents: str) -> None:
        asset = self.paths["candidate_dir"] / relative
        asset.write_text(contents, encoding="utf-8")
        new_hash = sha256(asset)

        manifest_path = self.paths["candidate_dir"] / "candidate-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for item in manifest["artifacts"]:
            if item["path"] == relative:
                item["sha256"] = new_hash
                break
        manifest_path.write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )

        path = self.paths["candidate_result"]
        body = json.loads(path.read_text(encoding="utf-8"))
        body["artifactHashes"][relative] = new_hash
        path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")

    def test_validator_exists(self) -> None:
        self.assertTrue(VALIDATOR.is_file(), "publish-gate validator is missing")

    def test_resolves_final_firmware_versions_before_build(self) -> None:
        result, output = self._resolve_versions("bump")
        self.assertEqual(result.returncode, 0, result.stderr)
        versions = [
            item["firmwareVersion"]
            for item in json.loads(output.read_text(encoding="utf-8"))["artifacts"]
        ]
        self.assertEqual(versions, ["1.0.42", "1.0.37"])

    def test_rejects_release_version_that_is_not_newer(self) -> None:
        result, _ = self._resolve_versions("unchanged", release_version="1.2.3")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("newer", result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_hosted_candidate_fixture_contract_is_accepted(self) -> None:
        manifest_artifacts = self.fixture["candidateManifest"]["artifacts"]
        artifacts = {
            item["name"]: (item["path"], item["role"], item["publish"])
            for item in manifest_artifacts
        }
        self.assertEqual(len(artifacts), len(manifest_artifacts))
        self.assertEqual(
            artifacts,
            {
                "VibeTV-Control-Center.dmg": (
                    "publish/VibeTV-Control-Center.dmg",
                    "signed-dmg",
                    True,
                ),
                "appcast.xml": (
                    "publish/appcast.xml",
                    "sparkle-appcast",
                    True,
                ),
                "install.sh": ("publish/install.sh", "installer", True),
                "install-control-center-companion.sh": (
                    "publish/install-control-center-companion.sh",
                    "installer",
                    True,
                ),
                "codexbar-display-darwin-amd64-v1.2.3": (
                    "publish/codexbar-display-darwin-amd64-v1.2.3",
                    "companion-amd64",
                    True,
                ),
                "codexbar-display-darwin-arm64-v1.2.3": (
                    "publish/codexbar-display-darwin-arm64-v1.2.3",
                    "companion-arm64",
                    True,
                ),
                "firmware.bin": ("publish/firmware.bin", "firmware", True),
                "firmware-manifest.json": (
                    "publish/firmware-manifest.json",
                    "firmware-manifest",
                    True,
                ),
                "firmware-manifest-v1.2.3.json": (
                    "publish/firmware-manifest-v1.2.3.json",
                    "firmware-manifest",
                    True,
                ),
                "checksums-v1.2.3.txt": (
                    "publish/checksums-v1.2.3.txt",
                    "checksums",
                    True,
                ),
                "codexbar-display": (
                    "test/codexbar-display",
                    "test-companion",
                    False,
                ),
                "virtual-vibetv": (
                    "test/virtual-vibetv",
                    "virtual-vibetv",
                    False,
                ),
                "notarization-log.json": (
                    "test/notarization-log.json",
                    "notarization-evidence",
                    False,
                ),
            },
        )

        result = self._run()

        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_valid_fixture_produces_payload_and_exact_asset_copy(self) -> None:
        result = self._run()
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(self.paths["output"].read_text(encoding="utf-8"))
        self.assertEqual(payload["tag"], "v1.2.3")
        self.assertEqual(payload["sourceSha"], self.fixture["sourceSha"])
        copied = sorted(
            str(path.relative_to(self.paths["copy_dir"]))
            for path in self.paths["copy_dir"].rglob("*")
            if path.is_file()
        )
        expected = sorted(
            item["path"]
            for item in self.fixture["candidateManifest"]["artifacts"]
            if item["publish"]
        )
        self.assertEqual(copied, expected)
        self.assertNotIn("test/virtual-vibetv", copied)
        self.assertNotIn("test/codexbar-display", copied)
        self.assertNotIn("test/notarization-log.json", copied)
        self.assertTrue(all(item["publish"] for item in payload["artifacts"]))

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_missing_required_public_asset_scope(self) -> None:
        self._remove_manifest_artifact_and_rebind("install.sh")
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("publish scope", result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_test_only_artifact_marked_for_publish(self) -> None:
        self._rewrite_manifest_and_rebind(
            lambda manifest: next(
                item
                for item in manifest["artifacts"]
                if item["name"] == "virtual-vibetv"
            ).update(publish=True)
        )
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be under publish/", result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_firmware_artifact_excluded_from_publish(self) -> None:
        self._rewrite_manifest_and_rebind(
            lambda manifest: next(
                item
                for item in manifest["artifacts"]
                if item["name"] == "firmware.bin"
            ).update(publish=False)
        )
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("firmware", result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_wrong_sparkle_appcast_url(self) -> None:
        self._replace_asset_and_rebind(
            "publish/appcast.xml",
            '<rss><channel><item><enclosure url="https://example.com/wrong.dmg" /></item></channel></rss>\n',
        )
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("appcast enclosure URL", result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_wrong_firmware_manifest_url(self) -> None:
        self._replace_asset_and_rebind(
            "publish/firmware-manifest.json",
            '{"schemaVersion":1,"artifacts":[{"asset":"firmware.bin","firmwareUrl":"https://example.com/firmware.bin"}]}\n',
        )
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("firmwareUrl", result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_non_semver_release_version(self) -> None:
        self._rewrite_manifest_and_rebind(
            lambda manifest: manifest.update(version="1.2")
        )
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SemVer", result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_candidate_result_that_is_not_success(self) -> None:
        self._rewrite("candidate_result", lambda body: body.update(result="failure"))
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("candidate result", result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_changed_candidate_asset(self) -> None:
        (self.paths["candidate_dir"] / "publish/firmware.bin").write_text(
            "changed after manifest\n", encoding="utf-8"
        )
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sha256", result.stderr)

if __name__ == "__main__":
    unittest.main()
