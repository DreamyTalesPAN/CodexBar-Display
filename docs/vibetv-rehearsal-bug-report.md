# VibeTV rehearsal — hardware test findings

Testing on real hardware against PR #348 (`codex/auto-theme-updates-ota-fix`).

Device under test: `14799300`, `esp8266-smalltv-st7789`, firmware `1.0.39`,
`http://192.168.178.72`.

BUG-1 is **root-caused and fixed, proven on hardware**. BUG-7's pacing half is
committed but explicitly not a fix. Everything else is reported, not fixed.

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

## BUG-7 — RAW OTA uploads stall at the TCP level

**Severity: blocker.** Exposed once BUG-1 stopped hiding it.

With the preflight fixed, the upload starts and then stops being acknowledged:

```
ota-upload: VibeTV must restart before another firmware upload:
interrupted upload left firmware 1.0.39 installed on device 14799300:
timed out waiting for VibeTV to acknowledge firmware data (512 bytes pending)
```

"N bytes pending" is the macOS socket's `Snd_sbbytes`. `waitForFirmwareRawAck`
gives up after 30 s if the kernel send buffer never drains, so the device
stopped acknowledging at the **TCP** level — its receive window closed and
stayed closed, most likely while the ESP8266 was erasing or writing flash.

Measured:

| Sender | Upload | Result |
|---|---|---|
| Unpaced (`writePause = 0`, the released-firmware fast path) | 1.0.39 → 9999.0.24 | stalled, 2/2 |
| Paced (`writePause = 10ms`) | 1.0.39 → 9999.0.24 | **completed and installed** |
| Paced | 9999.0.24 → 1.0.39 | stalled |

Restoring the pause is committed, because every unpaced attempt failed and the
only upload that ever completed was paced. **It is not a fix**: a paced upload
stalled too. Open leads are the 30 s `otaRawAckTimeout` being too tight for a
flash-sector erase, and the interaction of block size and chunk size with the
receiver's buffer.

---

## BUG-8 — An interrupted OTA leaves the device without a theme — CONFIRMED

An earlier draft of this report claimed this, then withdrew it as inconclusive
because a freshly paired app had been running. The clean measurement settles it:
the original claim was right.

With the device fully isolated — no Mac App, no daemon, nothing paired — probed
every 15 s for 7 minutes after a stalled upload:

```
uptime_s=70    theme=theme-missing  specActive=False renderOk=True
...
uptime_s=421   theme=theme-missing  specActive=False renderOk=True
```

24 of 24 probes. The device never reactivates the stored spec on its own, even
though `themeSpec.path` still points at it. What restored the theme the first
time was the freshly paired app pushing it back.

A **successful** update does not have this problem: the device came back on
`9999.0.24` with `activeTheme: "clippy"` and the spec active.

So recovery is the updater's job — after a failed upload it should reactivate
the stored spec instead of leaving the customer on a blank screen. Not
implemented.

Note: a stalled upload does not always reboot the device. Two stalls rebooted it
(`resetCount` 374→375, 375→376); a third left it up on the same boot.

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

- The merge gate's Sparkle CLI check could not be reproduced locally:
  `scripts/build-sparkle-cli.sh` needs `xcodebuild`, and this Mac's active
  developer directory is `/Library/Developer/CommandLineTools`. Switching it
  (`sudo xcode-select -s /Applications/Xcode.app`) needs your password.
- Cold start on the current candidate. The warm-start run below consumed the
  session; nothing about `vibetv-rehearse-cold-start.sh` has been exercised
  against `9999.0.26`.

---

# Warm-start run on real hardware, 2026-08-07 11:00-11:15

Candidate `9999.0.26` from merge-gate run `31161390646`, built from PR #348 head
`eab8fb9` and checksum-verified against the signed manifest. Device `14799300`,
`http://192.168.178.72`. Both open questions above about Sparkle and the upload
stage are settled here.

## Proven — the Mac App half of the warm start

Sparkle offered `9999.0.26` against the installed public `1.0.52`, the operator
clicked **Install Update**, and Sparkle downloaded the DMG from the loopback
server, replaced the bundle and relaunched it. So Sparkle **does** prefer the
`SUFeedURL` user default over the `Info.plist` feed — that was the last open
question about the appcast, and it is now closed by a real click.

Afterwards: app and runtime both `9999.0.26`, `installationMode: dmg`, one
process owning port 47832, and the device reached `connected: true, ready: true`
— a state the `1.0.52` baseline never held in this session.

## BUG-7 — still live, and it is the release blocker

Three consecutive update cycles through the customer path
(`POST /v1/updates/install` on the running runtime):

| # | Direction | Upload | Result |
|---|---|---|---|
| 1 | 1.0.39 -> 9999.0.26 | **completed** | device on 9999.0.26 |
| 2 | 9999.0.26 -> 1.0.39 (forced) | **completed** | device on 1.0.39 |
| 3 | 1.0.39 -> 9999.0.26 | **stalled** | device stayed on 1.0.39 |

Cycle 3 ended `firmware_update_restart_required` with `uploadAccepted: false`
("Disconnect VibeTV from power for 10 seconds"). Two of three uploads finished;
the third did not. The paced upload is better than the unpaced one but it is
still not reliable, exactly as the pacing commit said.

Cycle 2 is worth noting on its own: the earlier report measured
`9999.0.24 -> 1.0.39` as stalling even when paced. That direction completed
here.

## BUG-9 — a successful update never brings the picture back

New, and it fired on **both** successful cycles.

After the device reboots onto the new firmware it comes up with the theme spec
active (`activeTheme: clippy`, `renderOk: true`) but stuck on the setup screen:

```
render: {fullCount: 3, partialCount: 0, lastKind: "connected_setup"}
display.themeSpec.cbaCompletedFrames: 0
```

Meanwhile the Mac keeps logging `sent frame -> http://192.168.178.72 ...
usageMode=used` every ~30 s with `error=""`. Those frames never become a themed
render: `fullCount` sat at 3 and `lastKind` at `connected_setup` across four
minutes of polling.

So the job's `"Firmware is current, but the picture could not be verified"` is
**honest** — the customer really is left on the setup screen after a successful
update. `renderVerified: false` on both cycles.

One `POST /v1/device/reload-display` repaired it instantly
(`lastKind: theme_spec_frame`, `cbaCompletedFrames: 22`). The repair path
already does the right thing: `repairDevice` calls
`reactivateCurrentThemeAndWaitForFullRender` when
`activeThemeNeedsFullRepairRender` holds. `verifyFirmwareUpdateResult` does not
— it only waits for render counters to advance and then reports `attention`.
Post-reboot state satisfies that predicate exactly (spec active, path set,
`lastKind` not a live kind), so the same recovery would apply unchanged.

## BUG-8 — confirmed again, and the shipped recovery did not take effect

After the cycle-3 stall the device came back on `1.0.39` with:

```
activeTheme: "theme-missing"   themeSpec.active: false
themeSpec.path: "/themes/u/clippy-3-fe3fd4.json"   (intact)
```

That is precisely the state `restoreStoredThemeAfterAbortedUpload` (d91a008)
was written to repair, and the candidate carries that commit. The theme was
still missing.

The mechanism itself works on hardware. One hand-issued authenticated
`POST /theme/active` with the token in the header only — the same single call
the fix makes — restored the picture immediately:

```
{"ok":true,"path":"/themes/u/clippy-3-fe3fd4.json","id":"clippy","rev":3}
-> activeTheme: clippy, specActive: true, cbaCompletedFrames: 14,
   lastKind: theme_spec_usage
```

So the fix's *approach* is proven and its *delivery* is not. Whether the
recovery never ran or ran and silently failed cannot be told from outside,
which is the next bug.

Note also that `POST /v1/device/reload-display` returned **502
`display_reload_failed`** against `1.0.39` in this state, while the raw
`/theme/active` call succeeded on the same device seconds later. The runtime's
repair is doing more than the one call that actually works.

## BUG-3 — worse than reported: the updater's diagnostics are discarded

`firmwareUpdateProgressWriter.noteLine` passes every child line through
`customerFirmwareUpdateProgress` and drops whatever it does not recognise. The
theme-restore warnings the fix prints (`warning: could not restore stored theme
after aborted upload: ...`) match nothing, so they reach neither the job log nor
any file on disk. After a failed update there is no record anywhere of why.

## BUG-10 — a fresh update request right after one completes can be refused

Firing `POST /v1/updates/install` immediately after cycle 2 finished returned
`device_not_found` ("No VibeTV device was found"), while `/v1/status` reported
the device `connected: true, ready: true` and `/hello` answered directly.
Retrying seconds later worked. Transient, but it is the customer clicking twice.

## Not a product bug — this Mac's state

Two environment faults cost most of the session and are worth recording so the
next run does not chase them:

- **68 stale app bundles were registered with LaunchServices** (install
  backups, Trash copies, mounted DMGs). `vibetv://check-for-updates` therefore
  opened a *backup* copy of the app, which then ran as a **second instance**
  next to the installed one and fought over the device — the flapping between
  "Choose a VibeTV" and Overview. Unregistering all of them and detaching three
  leftover `/Volumes/VibeTV Control Center*` images fixed the deep link.
- **A wedged TCP connection** from the previous `1.0.52` runtime held the
  single-connection ESP8266 busy, so nothing else could reach it. Restarting
  the runtime released it.

## Release recommendation

**Do not release this candidate.** Three findings block it, in order:

1. BUG-7: one upload in three does not complete (blocker, pre-existing).
2. BUG-9: every *successful* update leaves the customer on the setup screen
   until something forces a display reload (blocker, new).
3. BUG-8: a stalled upload still strips the theme, and the shipped recovery did
   not restore it on hardware (blocker, the fix does not work as delivered).

BUG-9 and BUG-8 both have a known-good mechanism already in the tree
(`reactivateCurrentThemeAndWaitForFullRender`, the single `/theme/active` POST);
neither is reached by the firmware-update path.

---

# Cold-start run on real hardware, 2026-08-07 12:26-12:57

Candidate `9999.0.27` from merge-gate run `31170318522`, built from PR #348 head
`b6f4d39` and checksum-verified against the signed manifest. Device `14799300`,
`http://192.168.178.72`. The signed, notarised candidate DMG was installed as a
customer installs it; no companion override was involved.

## The device state a cold start actually needs

The earlier reading of "cold start" was too narrow: it treated a device that is
already paired, themed and streaming as a valid starting point because it
already carried the candidate firmware. It is not. A customer unboxes a VibeTV
that ships with the release firmware, joins it to home WiFi, and is then parked
on the `WiFi connected! app.vibetv.shop` screen with nothing on the device.

Reaching that state without touching the saved WiFi credentials:

1. `POST /frame` with `themeSpec:null` and `confirmClearThemeSpec:true` — the
   only supported way to drop the live ThemeSpec.
2. `DELETE /assets?path=...` for all eight `/themes/u/` files. The active spec
   has to go first: the firmware answers `409 asset is active` otherwise.
3. Power-cycle. Verified reached: `resetReason: External System`,
   `activeTheme: theme-missing`, `themeSpec.active: false`,
   `render.lastKind: connected_setup`.

`/theme-active` survives as a pointer to a now-deleted file, which the boot
cache load simply fails on. The end state is the same as a device that never had
a spec, so this is a faithful stand-in and not an artefact.

## Proven

| Step | Result |
|---|---|
| Mac purged (app, support dir, prefs, caches, LaunchAgents, `~/.codexbar`) | empty: no app, no agent, nothing on 47832 |
| Signed candidate DMG installed | app and runtime both `9999.0.27`, commit `b6f4d39`, `installationMode: dmg` |
| Firmware `9999.0.26 -> 9999.0.27` over the customer OTA path | **completed**, no stall |
| App finds and pairs the device unattended | `connected/paired/ready`, `connectionState: ready` |
| Display stream | healthy, a frame every ~30 s |
| Stability | 4.5 minutes of polling, no flap between setup screen and Overview |
| Updates tab | firmware `status: current`, Mac App `updateAvailable: false` — nothing offered, both read `9999.0.27` |

`theme-missing` right after pairing is **not** a defect. The firmware carries no
built-in theme — `/hello` advertises no `builtinThemes` and the renderer reports
`theme-missing` whenever the current frame has no ThemeSpec — and the app answers
that state with its `Choose your VibeTV theme` step. Installing Claude Creature
through `POST /v1/themes/install` (the same server path the Install button uses)
took the device to `activeTheme: claude-creature`, `themeSpec.active: true`,
`renderOk: true`, `renderFailures: 0`, `render.lastKind: theme_spec_usage`.
Overview then showed the live preview with `Display: Live`. That is
`docs/customer-setup.md`'s "Usage appears on the display".

## BUG-11 — the rehearsal companion override never started the runtime — FIXED

`--companion-override` copies the app's bundled runtime agent to
`~/Library/LaunchAgents` and rewrites `Program`. The bundled plist also carries
`BundleProgram`, which is only valid for an agent hosted by an app bundle, so
launchd rejected the whole plist with `Bootstrap failed: 5: Input/output error`.
The script read that as proof that an ad-hoc signed bundle can never host its
own LaunchAgent and told the operator to give up.

Dropping `BundleProgram` bootstraps the same agent cleanly; verified on this Mac
with a locally built companion serving 47832. Fixed in `b6f4d39`; the failure
path now reports launchd's own message instead of that conclusion.

## Not a product bug — this Mac's state, part two

The 68 stale LaunchServices registrations from the warm-start run were back: 39
bundles claimed `shop.vibetv.control-center`, 17 of them still on disk (backup
copies under `~/CodexBackups` and `~/.codex`, three preview builds in
`/private/tmp`, three in the Trash). `lsregister -u` does not hold, because
LaunchServices rescans and re-registers; `lsregister -kill` no longer exists on
macOS 26. What holds is renaming the copies so they are no longer `.app`
bundles. After that plus `lsregister -u` on the two Trash copies that macOS
refuses to rename, zero launchable bundles claim the identifier. No flapping was
observed in this run.

---

# Warm-start run on real hardware, 2026-08-07 12:58-13:20

Same candidate `9999.0.27` (`b6f4d39`). Device `14799300`. Public baseline
`v1.0.52` + firmware `1.0.39`, candidate published on loopback.

## Proven

- Firmware downgrade `9999.0.27 -> 1.0.39` completed, no stall.
- The app discovered, paired and streamed on the public baseline; the device
  showed the update notice.
- Sparkle offered `9999.0.27` against installed `1.0.52` and installed it after
  the operator clicked **Install Update**. Afterwards app and runtime were both
  `9999.0.27`, `installationMode: dmg`, one instance.
- `vibetv://check-for-updates` opened exactly one app, the installed one. The
  second-instance flapping is gone once no launchable backup copy claims
  `shop.vibetv.control-center`.
- The candidate fixes `PREVIEW UNAVAILABLE`: the public `1.0.52` showed it with
  the device connected, `Display: Live` and a healthy stream; the candidate shows
  the live picture.
- Firmware upload `1.0.39 -> 9999.0.27` completed, no stall. Four uploads in this
  session, four completions.

## BUG-9 — root-caused on hardware — FIXED

The update still ended `firmware_current_render_attention`,
`renderVerified: false`, with the customer parked on the setup screen. The BUG-3
fix earned its keep: `logs/firmware-update.log` named the cause outright.

```
render-repair: baseline ok=true specActive=true
  specPath="/themes/u/claude--1-623de0.json" lastKind="connected_setup"
  counters=true/3/0 needsRepair=true
render-repair: reactivated from baseline
  err=reactivate current VibeTV theme: Post ".../theme/active": EOF
```

So the predicate was right and the branch was right. The single `/theme/active`
call failed. `verifyFirmwareUpdateResult` restarts the display stream and waits
for a fresh frame immediately before calling the repair, and a VibeTV serves one
connection at a time, so the running stream took the connection and the device
answered EOF.

`repairDevice` wraps every `reactivateCurrentThemeAndWaitForFullRender` call in
`pauseStream()`/`resumeStream()`, and the theme install pauses too. The firmware
update path was the only caller that did not. That is the whole reason
`POST /v1/device/reload-display` repaired the picture instantly in the previous
session while the update itself could not: same helper, one missing pause.

Fixed by pausing the stream around both reactivation attempts. The passive
render wait stays outside the pause because it needs frames to arrive. Locked by
`TestFirmwareUpdatePausesDisplayStreamWhileReactivatingTheme`, whose fake device
drops `/theme/active` whenever the stream is running — verified red against the
old code, green after. **Not yet re-run on hardware.**

## BUG-12 — a stored ThemeSpec outlives the capability that chose it

Firmware `1.0.39` advertises no `supportsUsageSlotsV1` and no
`supportsUsageWindowsV1`; `9999.0.27` does. The theme install picks the matching
revision: on `9999.0.27` it installed and activated `claude--3-afab9c.json`
(usage windows), on `1.0.39` it installed `claude--1-623de0.json`.

Nothing re-selects that revision when device capabilities change. After the
rehearsal's downgrade the device kept rev 3 active and `1.0.39` rendered the
theme with empty percentages and an empty reset time -- silently:
`renderOk: true`, `renderFailures: 0`. Re-installing the same pack on `1.0.39`
picked rev 1 and the picture came back complete (`Session 27% used`,
`Weekly 5% used`, `Resets in 1h 56m`).

Not a customer-facing regression: a downgrade is not a customer path, and the
update direction keeps a rev-1 spec that newer firmware still renders. It does
break the warm-start rehearsal's own baseline, which is how it was found, and it
makes the Mac-App-updated / firmware-pending state look broken when it is not.

## BUG-13 — the warm start could not flash its own baseline — FIXED

`vibetv-rehearse-warm-start.sh` flashed the public firmware in step 1 and purged
the Mac in step 2, so the installed runtime was still polling the device and the
direct CLI flash refused to start beside another device writer -- correctly, per
`651b726`. The baseline flash now stops the runtime first.

## Not a product bug — my own damage to this Mac

`cp -f` onto the installed app's companion helper unlinked the file and was then
denied by macOS App Management, leaving `Contents/Helpers` empty and no runtime
at all. Restored by writing the candidate's own companion back (SHA-256 verified
against the signed manifest; `codesign --verify --deep --strict` passes).

Also worth recording for the next override attempt: a companion running from a
user-owned path outside the app bundle gets no local network access. The runtime
reported `dial tcp 192.168.178.72:80: connect: no route to host` for every cycle
while `curl` on the same Mac reached the device, and the bundle's own signed
companion connected immediately. `--companion-override` therefore has to stay
inside the bundle, which App Management now blocks for a Sparkle-installed app.
A companion-side fix is best proven through a signed merge-gate candidate.

---

# BUG-9 fix confirmed on hardware, 2026-08-07 14:10-14:13

Candidate `9999.0.28` from merge-gate run `31174929610`, built from PR #348 head
`54a3b66` (the pause fix), installed from the signed DMG. Device `14799300`
brought to `1.0.39`, then updated through `POST /v1/updates/install`.

Same device, same baseline state, same code path as the failing run. Only the
display-stream pause differs:

| | `firmware-update.log` | Job |
|---|---|---|
| `9999.0.27`, no pause | `reactivated from baseline err=reactivate current VibeTV theme: Post ".../theme/active": EOF` | `attention`, `renderVerified: false` |
| `9999.0.28`, paused | `reactivated from baseline err=<nil>` | `complete`, `outcome: updated`, `renderVerified: true` |

Both runs entered the repair from `specActive=true`,
`specPath="/themes/u/claude--3-afab9c.json"`, `lastKind="connected_setup"`,
`counters=true/3/0`, `needsRepair=true`. Afterwards the device reported
`activeTheme: claude-creature`, `themeSpec.active: true`,
`render.lastKind: theme_spec_usage`, `cbaCompletedFrames` advancing.

BUG-9 is fixed and proven. The mechanism the previous session identified was
right; the delivery failed on one missing pause.

## BUG-7 — one stall in seven, and a measurable correlate

Seven RAW OTA uploads in this session, six completed. The stall:

```
ota-upload: VibeTV must restart before another firmware upload:
interrupted upload left firmware 1.0.39 installed on device 14799300:
timed out waiting for VibeTV to acknowledge firmware data (235 bytes pending)
```

It stopped being acknowledged 81 s in, after roughly 50 s of body writes. The
device did **not** restart (same `bootId`, uptime kept running) and kept its
theme, so BUG-8 did not fire this time.

Two things this session can rule out as the cause on this Mac: no second app
instance (one process, verified) and no other local process holding a connection
to the device (`lsof -i @192.168.178.72` empty during and after).

What does correlate is free heap on the device:

| Upload | freeHeap before | Fragmentation | Result |
|---|---|---|---|
| after ~14 min uptime | 14 616 B | 27 % | **stalled** |
| after a power cycle | 29 064 B | 4 % | completed |

`docs/firmware-guardrails.md` already says RAM pressure is the first suspect for
ESP8266 upload failures. Two points are not proof, but they are the first
measurable correlate this bug has had, and the next run should record
`/health` `system.freeHeap` and `heapFragmentationPercent` immediately before
every upload rather than guessing.
