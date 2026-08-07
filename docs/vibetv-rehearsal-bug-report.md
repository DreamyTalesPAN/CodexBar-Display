# VibeTV rehearsal — hardware test findings

Testing on real hardware against PR #348 (`codex/auto-theme-updates-ota-fix`,
candidate `9999.0.24` from commit `06e6b5a`).

Device under test: `14799300`, `esp8266-smalltv-st7789`, firmware `1.0.39`,
`http://192.168.178.72`.

These are **findings only**. Nothing in this report has been fixed.

---

## BUG-1 — Firmware update never reaches the upload; it dies in the auth preflight

**Severity: blocker.** This is the failure behind the "Update failed" card.

Running the exact command the Update button runs:

```
codexbar-display install-update --target http://192.168.178.72 \
  --confirm-live-update --skip-launchagent-pause \
  --manifest-url <manifest> --verbose
```

produces:

```
Transient preflight error (attempt 1/3), retrying: Get "http://.../hello?token=[REDACTED]": EOF
Transient preflight error (attempt 2/3), retrying: Get "http://.../hello?token=[REDACTED]": EOF
error code=upgrade/flash-firmware
error: device-auth-preflight: authenticate VibeTV /hello: Get "http://.../hello?token=[REDACTED]": EOF
```

The upload never starts, which is why the job reports `uploadAccepted: false`.

### What the evidence rules out

Measured directly against the device, all with the daemon stopped:

| Probe | Result |
|---|---|
| `curl` unauthenticated `/hello` | 6/6 OK |
| `curl` token in query only | 6/6 OK |
| `curl` token in header only | 6/6 OK |
| `curl` header **and** query (what the code sends) | 6/6 OK |
| `curl` shaped exactly like Go incl. `Accept-Encoding: gzip` | 5/6 OK |
| Raw socket, byte-exact Go request | 5/6 OK |
| Raw socket, byte-exact curl request | 6/6 OK |
| **Go `http.Client`, authenticated `/hello`** | **1/8 OK** |
| Go `http.Client`, unauthenticated `/hello` | ~8/8 OK |

So it is **not** the request bytes, **not** the token encoding (the token is
plain hex), **not** connection reuse (`DisableKeepAlives` behaves identically),
and **not** contention with the display stream — the failure reproduces with the
runtime fully stopped.

What remains: the authenticated `/hello` fails specifically through Go's
`http.Client` while the identical bytes over a raw socket succeed. The device
side closes the connection without a response.

**Not root-caused.** The next step is a packet capture on the device side, or
firmware-side logging in the `/hello` auth path.

### Why the retry advice is wrong

The card tells the customer *"Keep VibeTV powered on, then try again."* The
device was powered on and reachable the whole time. Retrying does not help,
because the failure is deterministic per attempt (~85%), not transient.

---

## BUG-2 — An interrupted upload reboots the device and drops its theme

In one attempt the preflight passed and the upload started, then:

```
error: ota-upload: VibeTV must restart before another firmware upload:
interrupted upload left firmware 1.0.39 installed on device 14799300:
firmware upload may have written data:
timed out waiting for VibeTV to acknowledge firmware data (192 bytes pending)
```

Device state before: `resetCount 374`, `activeTheme "clippy"`, themeSpec active.
Device state after: `resetCount 375`, `uptimeMs 32416`, `resetReason
"Software/System restart"`, **`activeTheme "theme-missing"`, `themeSpec.active:
false`**.

So a failed firmware upload silently costs the customer their installed theme
and forces an unannounced reboot. The firmware version correctly stayed at
`1.0.39`, so the rollback protection itself worked — but the theme did not
survive, and nothing in the UI says so.

---

## BUG-3 — The failure message hides the actual cause

The Updates card shows only:

> Update failed — Keep VibeTV powered on, then try again.

The real error (`device-auth-preflight: ... EOF`) is not surfaced anywhere the
customer or a supporter can see it. It only appears on the helper's stdout. The
support report (`reportType: control_center`) carries `errorCode:
firmware_update_failed` and the same generic `nextAction`, so a report from a
real customer would not have let anyone diagnose BUG-1 either.

---

## BUG-4 — The Updates tab cannot offer a Mac App update from the appcast alone

Not a customer-facing defect, but it invalidates any rehearsal that only
overrides Sparkle.

The "Mac App / Available" value does **not** come from the Sparkle appcast. It
comes from the companion's own GitHub releases check
(`CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL`, default
`api.github.com/repos/.../releases/latest`, parsed as `{"tag_name": ...}`).

Consequence: pointing only `SUFeedURL` at a candidate leaves the card claiming
*"Mac App is up to date"* while Sparkle would install the candidate. The
rehearsal scripts therefore override both seams.

---

## BUG-5 — A `99.x` preview build makes the warm start untestable

Observed in the state the previous session left behind: the installed app was
`99.0.779` while the public release is `1.0.52`. Because `99 > 1`, the companion
reported *"Mac App is up to date"* and Sparkle had nothing to offer, so the
Mac-App-update half of the warm start could never run.

Any build meant to act as the **baseline** must carry a version *below* the
candidate. The merge-gate candidate scheme (`9999.0.24`) is only correct for the
**target** side.

---

## Verified working

- The merge-gate candidate for PR #348 matches the PR head exactly
  (`06e6b5ae30ae`) and all six artifact checksums verify against the signed
  manifest.
- Warm start reaches the intended customer state: Mac App `1.0.52` installed,
  device on `1.0.39`, and the Updates tab offers `9999.0.24` for **both** the Mac
  App (`updateAvailable: true`) and the firmware
  (`status: update_available`).
- The device's own HTTP surface (`/hello`, `/health`) is healthy and responsive
  throughout.
- The candidate DMG served on loopback carries a valid Ed25519 signature for the
  `SUPublicEDKey` of the installed public app, confirmed with `openssl pkeyutl
  -verify`. Rewriting the appcast enclosure URL does not invalidate it, so
  Sparkle will accept this update.

## Not yet verified

- That Sparkle prefers the `SUFeedURL` user default over the `Info.plist` feed in
  this build. The signature and the feed contents are proven; only the
  precedence is open, and clicking the update in the Updates tab settles it.
- The firmware update completing successfully — blocked by BUG-1. This also
  leaves the cold start's flash step unproven: it uses the same
  `install-update` path and fails the same way.
- The Sparkle CLI check the merge gate runs could not be reproduced here:
  `scripts/build-sparkle-cli.sh` needs `xcodebuild`, and this Mac's active
  developer directory is `/Library/Developer/CommandLineTools`. Switching it
  (`sudo xcode-select -s /Applications/Xcode.app`) needs your password.
