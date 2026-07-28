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
        fixture["hardwareEvidence"]["artifactHashes"] = hashes
        fixture["hardwareEvidence"]["candidateManifestSha256"] = sha256(
            candidate_dir / "candidate-manifest.json"
        )

        return {
            "candidate_dir": candidate_dir,
            "candidate_run": self._write_json("candidate-run.json", fixture["candidateRun"]),
            "candidate_workflow": self._write_json(
                "candidate-workflow.json", fixture["candidateWorkflow"]
            ),
            "candidate_result": self._write_json(
                "candidate-result.json", fixture["candidateResult"]
            ),
            "hardware_run": self._write_json("hardware-run.json", fixture["hardwareRun"]),
            "hardware_workflow": self._write_json(
                "hardware-workflow.json", fixture["hardwareWorkflow"]
            ),
            "hardware_evidence": self._write_json(
                "hardware-canary.json", fixture["hardwareEvidence"]
            ),
            "output": self.case_root / "publish/publish-payload.json",
            "copy_dir": self.case_root / "publish/assets",
        }

    def _command(self, **overrides: str) -> list[str]:
        values = {
            "repository": self.fixture["repository"],
            "source_sha": self.fixture["sourceSha"],
            "version": self.fixture["version"],
            "candidate_run_id": self.fixture["candidateRunId"],
            "hardware_canary_run_id": self.fixture["hardwareCanaryRunId"],
            "now": self.fixture["now"],
        }
        values.update(overrides)
        return [
            "python3",
            str(VALIDATOR),
            "preflight",
            "--repository",
            values["repository"],
            "--source-sha",
            values["source_sha"],
            "--version",
            values["version"],
            "--candidate-run-id",
            values["candidate_run_id"],
            "--candidate-run",
            str(self.paths["candidate_run"]),
            "--candidate-workflow",
            str(self.paths["candidate_workflow"]),
            "--candidate-dir",
            str(self.paths["candidate_dir"]),
            "--candidate-result",
            str(self.paths["candidate_result"]),
            "--hardware-canary-run-id",
            values["hardware_canary_run_id"],
            "--hardware-run",
            str(self.paths["hardware_run"]),
            "--hardware-workflow",
            str(self.paths["hardware_workflow"]),
            "--hardware-evidence",
            str(self.paths["hardware_evidence"]),
            "--now",
            values["now"],
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
        evidence_path = self.paths["hardware_evidence"]
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        evidence["candidateManifestSha256"] = sha256(manifest_path)
        evidence_path.write_text(
            json.dumps(evidence, indent=2) + "\n", encoding="utf-8"
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
        for key in ("candidate_result", "hardware_evidence"):
            path = self.paths[key]
            body = json.loads(path.read_text(encoding="utf-8"))
            body["artifactHashes"].pop(removed["path"])
            if key == "hardware_evidence":
                body["candidateManifestSha256"] = sha256(manifest_path)
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

        for key in ("candidate_result", "hardware_evidence"):
            path = self.paths[key]
            body = json.loads(path.read_text(encoding="utf-8"))
            body["artifactHashes"][relative] = new_hash
            if key == "hardware_evidence":
                body["candidateManifestSha256"] = sha256(manifest_path)
            path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")

    def test_validator_exists(self) -> None:
        self.assertTrue(VALIDATOR.is_file(), "publish-gate validator is missing")

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
    def test_rejects_wrong_production_appcast_url(self) -> None:
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
        result = self._run(version="1.2")
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

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_hardware_result_other_than_success(self) -> None:
        self._rewrite("hardware_evidence", lambda body: body.update(result="passed"))
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("hardware evidence result", result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_hardware_evidence_older_than_seven_days(self) -> None:
        result = self._run(now="2026-08-04T11:00:01Z")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("older than 7 days", result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_wrong_candidate_workflow(self) -> None:
        self._rewrite(
            "candidate_workflow",
            lambda body: body.update(path=".github/workflows/release.yml"),
        )
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("candidate workflow", result.stderr)

    @unittest.skipUnless(VALIDATOR.is_file(), "validator not implemented yet")
    def test_rejects_hardware_hashes_that_differ_from_candidate(self) -> None:
        self._rewrite(
            "hardware_evidence",
            lambda body: body["artifactHashes"].update(
                {"publish/firmware.bin": "0" * 64}
            ),
        )
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("hardware artifact hashes", result.stderr)


if __name__ == "__main__":
    unittest.main()
