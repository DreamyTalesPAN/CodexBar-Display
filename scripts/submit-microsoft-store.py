#!/usr/bin/env python3
"""Point the Microsoft Store listing at a mirrored installer and submit it.

Uses the Store submission API for EXE apps:
https://learn.microsoft.com/windows/apps/publish/store-submission-api

Only the package URL changes; languages, architecture and install switches
stay exactly as configured in Partner Center. Authentication is a GitHub OIDC
token exchanged for an Entra token, so no Store secret exists anywhere.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

STORE_API = "https://api.store.microsoft.com"
STORE_SCOPE = "https://api.store.microsoft.com/.default"
PACKAGE_URL = re.compile(
    r"^https://vibetvdownloads\.blob\.core\.windows\.net/windows/"
    r"v[0-9]+\.[0-9]+\.[0-9]+/VibeTV-Control-Center-Setup\.exe$"
)

Request = Callable[[str, str, "dict[str, Any] | None"], "dict[str, Any]"]


class StoreError(RuntimeError):
    """The Store rejected or could not finish the submission."""


def http_json(method: str, url: str, headers: dict[str, str], body: bytes | None) -> dict[str, Any]:
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read()
        if not raw:
            raise StoreError(f"{method} {url} answered HTTP {error.code}") from error
    return json.loads(raw or b"{}")


def github_oidc_token() -> str:
    url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
    separator = "&" if "?" in url else "?"
    url += separator + urllib.parse.urlencode({"audience": "api://AzureADTokenExchange"})
    headers = {"Authorization": f"Bearer {os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}"}
    return http_json("GET", url, headers, None)["value"]


def store_access_token(tenant_id: str, client_id: str) -> str:
    if os.environ.get("MSSTORE_ACCESS_TOKEN"):
        return os.environ["MSSTORE_ACCESS_TOKEN"]
    form = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "scope": STORE_SCOPE,
        "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        "client_assertion": github_oidc_token(),
    }).encode()
    result = http_json(
        "POST",
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        {"Content-Type": "application/x-www-form-urlencoded"},
        form,
    )
    if "access_token" not in result:
        raise StoreError(f"Entra token exchange failed: {result.get('error_description', result)}")
    return result["access_token"]


def store_client(token: str, seller_id: str) -> Request:
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Seller-Account-Id": seller_id,
        "Content-Type": "application/json",
    }

    def call(method: str, path: str, body: dict[str, Any] | None) -> dict[str, Any]:
        data = json.dumps(body).encode() if body is not None else None
        result = http_json(method, STORE_API + path, headers, data)
        if not result.get("isSuccess"):
            raise StoreError(f"{method} {path} failed: {json.dumps(result.get('errors'))}")
        return result.get("responseData") or {}

    return call


def submit(
    call: Request,
    product_id: str,
    package_url: str,
    *,
    dry_run: bool = False,
    sleep: Callable[[float], None] = time.sleep,
    poll_attempts: int = 60,
) -> str:
    """Return the new submission ID, or the current package URL on a dry run."""
    if not PACKAGE_URL.match(package_url):
        raise StoreError(f"refusing unexpected package URL: {package_url}")
    base = f"/submission/v1/product/{product_id}"

    status = call("GET", f"{base}/status", None)
    if status.get("ongoingSubmissionId"):
        raise StoreError(
            "the Store is still reviewing submission "
            f"{status['ongoingSubmissionId']}; re-run this job after it is published"
        )

    packages = call("GET", f"{base}/packages", None).get("packages") or []
    if len(packages) != 1:
        raise StoreError(f"expected exactly one Store package, found {len(packages)}")
    current = packages[0]
    if dry_run:
        return current.get("packageUrl", "")

    if current.get("packageUrl") != package_url:
        call("PATCH", f"{base}/packages/{current['packageId']}", {"packageUrl": package_url})
    call("POST", f"{base}/packages/commit", None)

    for _ in range(poll_attempts):
        status = call("GET", f"{base}/status", None)
        if status.get("isReady"):
            break
        sleep(10)
    else:
        raise StoreError("the Store did not accept the package within the polling window")

    submission_id = call("POST", f"{base}/submit", None).get("submissionId")
    if not submission_id:
        raise StoreError("the Store did not return a submission ID")
    return submission_id


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-url", required=True)
    parser.add_argument("--dry-run", action="store_true", help="only read the current package")
    args = parser.parse_args()

    token = store_access_token(os.environ["STORE_TENANT_ID"], os.environ["STORE_CLIENT_ID"])
    call = store_client(token, os.environ["STORE_SELLER_ID"])
    try:
        result = submit(call, os.environ["STORE_PRODUCT_ID"], args.package_url, dry_run=args.dry_run)
    except StoreError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    label = "Current Store package URL" if args.dry_run else "Microsoft Store submission"
    print(f"{label}: {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
