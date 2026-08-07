# VibeTV rehearsal — hardware test findings

Testing on real hardware against PR #348 (`codex/auto-theme-updates-ota-fix`).

Device under test: `14799300`, `esp8266-smalltv-st7789`, firmware `1.0.39`,
`http://192.168.178.72`.

BUG-1 is **root-caused and fixed**. Everything else is reported, not fixed.

---

## BUG-1 — Firmware updates die in the auth preflight — FIXED

**Severity: blocker.** This was the failure behind every "Update failed" card.

The update path authenticated `/hello` with the pairing token in the
`X-VibeTV-Token` header **and** duplicated into the `?token=` query string. On
real hardware that combination makes the device close the connection without a
response, so the preflight failed before a single byte was uploaded.

Measured from one Go `http.Client`, 30 attempts per variant, interleaved to
cancel out drift, valid token, no other traffic to the device:

| Token carrier | Failures |
|---|---|
| Header **and** query — what the update path sent | **24/30** (`EOF`) |
| Header only — what the streaming daemon sends | **0/30** |
| Query only | **0/30** |

Either carrier alone is stable. The **duplication** is the trigger. That
settles the contradiction in the tree: the cold-start work removed the query
fallback arguing it "blocks /hello", while `6821299` reinstated it with the
opposite rationale. Neither was right — query-only is fine, both together is not.

Re-measured through the real `fetchDeviceHelloHTTPWithToken` helper after
removing the duplication: **0/30**.

The duplication reached `main` through `9f79246` and was reinstated on the
cold-start branch by `6821299`. Both carried it.

Locked by `TestDeviceHelloPreflightSendsTokenOnlyInHeader` (verified red against
the old code, green after) and written up as a device-proven rule in
`docs/hardware-contract.md`.

### Why the retry advice was wrong

The card told the customer *"Keep VibeTV powered on, then try again."* The
device was powered and reachable throughout, and the failure was ~80 %
deterministic, so retrying could not help. The 3×500 ms preflight retry on the
cold-start branch is useful hardening but never addressed the cause.

---

## BUG-2 — An invalid token surfaces as a transport error, not as 401

Found while measuring BUG-1, and it compounds it.

With an **expired** token: header-only and query-only both return a clean
`401 Unauthorized`. The duplicated form instead closes the connection (`EOF`).

So a stale token cannot be told apart from a network fault. The updater sees a
transport error, reports "keep the device powered on", and never says
"re-pair" — which is the actual remedy.

Observed live: the device rotated its pairing token when the freshly installed
app paired, and the previously valid token then produced exactly this
misleading `EOF`.

---

## BUG-3 — The failure message hides the actual cause

The Updates card shows only:

> Update failed — Keep VibeTV powered on, then try again.

The real error (`device-auth-preflight: ... EOF`) appears nowhere a customer or
supporter can see it — only on the helper's stdout. The support report carries
the same generic `errorCode: firmware_update_failed` and `nextAction`, so a
report from a real customer would not have allowed anyone to diagnose BUG-1.

---

## BUG-4 — The Updates tab cannot offer a Mac App update from the appcast alone

Not customer-facing, but it invalidates any rehearsal that only overrides
Sparkle.

The "Mac App / Available" value does **not** come from the Sparkle appcast. It
comes from the companion's own GitHub releases check
(`CODEXBAR_DISPLAY_MAC_APP_RELEASE_API_URL`, parsed as `{"tag_name": ...}`).

Overriding only `SUFeedURL` leaves the card claiming *"Mac App is up to date"*
while Sparkle would install the candidate. The rehearsal scripts override both.

---

## BUG-5 — A `99.x` preview build makes the warm start untestable

The previous session left the Mac on app version `99.0.779` while the public
release is `1.0.52`. Because `99 > 1`, the companion reported *"Mac App is up to
date"* and Sparkle had nothing to offer, so the Mac-App half of the warm start
could never run.

A build acting as the **baseline** must be versioned *below* the candidate. The
merge-gate scheme (`9999.0.24`) is correct only for the **target** side.

---

## BUG-6 — The cold-start branch cannot build from a clean checkout

`codex/coldstart-honest-reachability` deleted
`companion/internal/companionapi/controlcenter_static/.gitkeep` — the one file
`.gitignore` explicitly preserves in that directory. Without it,
`go:embed all:controlcenter_static` finds no files and **every** `go build` and
`go test` in `companion/` fails before running.

Local runs on that branch only worked because the build pipeline copies the
built UI into that directory first. Restored on the integration branch.

---

## Corrected: no permanent theme loss

An earlier version of this report claimed a failed upload costs the customer
their installed theme. That was over-stated.

What is confirmed: an interrupted upload does reboot the device
(`resetCount` 374 → 375, `resetReason "Software/System restart"`), and shortly
after that reboot the device reported `activeTheme: "theme-missing"` with
`themeSpec.active: false`. Later, on the **same boot**, it reported
`activeTheme: "clippy"` with the spec active and rendering.

Whether the device restored the spec itself or the freshly paired app re-pushed
it is **not established** — a newly paired Mac App was running in between. The
unannounced reboot after a failed upload stands as a finding; permanent theme
loss does not.

---

## Verified working

- The merge-gate candidate for PR #348 matches the PR head exactly and all six
  artifact checksums verify against the signed manifest.
- Warm start reaches the intended customer state: Mac App `1.0.52`, device on
  `1.0.39`, and the Updates tab offers the candidate for **both** the Mac App
  (`updateAvailable: true`) and the firmware (`status: update_available`).
- The candidate DMG served on loopback carries a valid Ed25519 signature for the
  installed app's `SUPublicEDKey` (`openssl pkeyutl -verify`). Rewriting the
  appcast enclosure URL does not invalidate it.

## Not yet verified

- That Sparkle prefers the `SUFeedURL` user default over the `Info.plist` feed.
  Signature and feed contents are proven; only the precedence is open, and the
  first real click settles it.
- A firmware update completing end to end on hardware with the BUG-1 fix in
  place. The preflight is fixed and measured; the upload stage beyond it has not
  been exercised since.
- The merge gate's Sparkle CLI check could not be reproduced locally:
  `scripts/build-sparkle-cli.sh` needs `xcodebuild`, and this Mac's active
  developer directory is `/Library/Developer/CommandLineTools`. Switching it
  (`sudo xcode-select -s /Applications/Xcode.app`) needs your password.
