#!/usr/bin/env python3
"""Offline tests for the Microsoft Store submission step."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "store", Path(__file__).resolve().parent / "submit-microsoft-store.py"
)
store = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(store)

URL = "https://vibetvdownloads.blob.core.windows.net/windows/v1.0.61/VibeTV-Control-Center-Setup.exe"
OLD = "https://vibetvdownloads.blob.core.windows.net/windows/v1.0.60/VibeTV-Control-Center-Setup.exe"


class FakeStore:
    def __init__(self, *, ongoing: str = "", ready_after: int = 1, packages: int = 1) -> None:
        self.calls: list[tuple[str, str, object]] = []
        self.ongoing = ongoing
        self.ready_after = ready_after
        self.packages = [{"packageId": f"p{i}", "packageUrl": OLD} for i in range(packages)]

    def __call__(self, method: str, path: str, body: object) -> dict:
        self.calls.append((method, path, body))
        if path.endswith("/status"):
            polls = sum(1 for c in self.calls if c[1].endswith("/status")) - 1
            return {"ongoingSubmissionId": self.ongoing, "isReady": polls >= self.ready_after}
        if path.endswith("/packages") and method == "GET":
            return {"packages": self.packages}
        if path.endswith("/submit"):
            return {"submissionId": "1234"}
        return {}


class SubmitTests(unittest.TestCase):
    def test_updates_only_the_package_url_then_submits(self) -> None:
        fake = FakeStore(ready_after=2)
        self.assertEqual(store.submit(fake, "prod", URL, sleep=lambda _: None), "1234")
        methods = [(m, p.rsplit("/", 1)[-1]) for m, p, _ in fake.calls]
        self.assertIn(("PATCH", "p0"), methods)
        self.assertEqual([b for m, _, b in fake.calls if m == "PATCH"], [{"packageUrl": URL}])
        self.assertEqual(methods[-1], ("POST", "submit"))
        self.assertLess(methods.index(("POST", "commit")), methods.index(("POST", "submit")))

    def test_refuses_while_a_submission_is_in_review(self) -> None:
        fake = FakeStore(ongoing="999")
        with self.assertRaisesRegex(store.StoreError, "still reviewing"):
            store.submit(fake, "prod", URL)
        self.assertFalse([c for c in fake.calls if c[0] != "GET"])

    def test_refuses_foreign_urls(self) -> None:
        with self.assertRaisesRegex(store.StoreError, "unexpected package URL"):
            store.submit(FakeStore(), "prod", "https://example.com/setup.exe")

    def test_refuses_ambiguous_package_sets(self) -> None:
        with self.assertRaisesRegex(store.StoreError, "exactly one"):
            store.submit(FakeStore(packages=2), "prod", URL)

    def test_dry_run_writes_nothing(self) -> None:
        fake = FakeStore()
        self.assertEqual(store.submit(fake, "prod", URL, dry_run=True), OLD)
        self.assertTrue(all(m == "GET" for m, _, _ in fake.calls))

    def test_times_out_when_package_never_becomes_ready(self) -> None:
        with self.assertRaisesRegex(store.StoreError, "polling window"):
            store.submit(FakeStore(ready_after=99), "prod", URL, sleep=lambda _: None, poll_attempts=3)


if __name__ == "__main__":
    unittest.main()
