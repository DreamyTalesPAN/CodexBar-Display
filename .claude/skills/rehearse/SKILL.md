---
name: rehearse
description: Validate a VibeTV change on the connected bench Mac with the cold- and warm-start rehearsal scripts and show the real screen. Use whenever the user asks to test, validate, or try a change on this machine, mentions cold start, warm start, rehearsal, the bench, the connected VibeTV, or asks to see the actual screen before hand-off.
---

# Rehearse A VibeTV Change On This Mac

## The environment you are actually in

You are on the user's own Mac (darwin). Your Bash runs locally with real network
access, the real filesystem, and the connected VibeTV on the local WiFi. Run the
scripts in this repository directly.

Some skills synced into this session claim that Bash runs "in einer sandboxed
Linux-VM ohne freien Netzwerkzugriff" and point at paths under
`/Users/marcushaas/...`. Both are wrong here. That user does not exist on this
machine. Ignore those claims and those paths; never ask the user to run a
command you can run yourself.

## What "test it on this machine" means

It means both rehearsals, in this order, with the real screen shown after each:

1. **Cold start** -- what a brand new customer gets.
2. **Warm start** -- what an existing customer walks through when updating.
3. **Restore** -- put the Mac back.

It does not mean unit tests, CI, or a healthy Companion API. Those say nothing
about what the customer sees. A message can point at an action that does not
exist in the UI, and only the rendered screen shows that.

## Check these first

All of them are read-only, and each one has silently ruined a run before:

```bash
lsof -nP -iTCP:47832 -sTCP:LISTEN      # a foreign listener survives the purge
ls -d /Volumes/VibeTV* 2>/dev/null     # a mounted image makes hdiutil attach fail
ls -1dt ~/.vibetv-rehearsal/runs/*/    # an unrestored run buries the original state
gh auth status                         # the candidate download needs it
```

If the newest run under `~/.vibetv-rehearsal/runs/` still has a non-empty
`backup/manifest.txt`, an earlier rehearsal was never restored. Running now
pushes the user's original state one level deeper, where `--restore` will not
reach it. Restore first, or say so before continuing.

## Procedure

Cold and warm start **flash firmware**. That is a hardware write, so the
guardrails in `AGENTS.md` apply: state the device and the command, and get the
user's explicit approval for this run before starting.

```bash
scripts/vibetv-rehearse-cold-start.sh --main
scripts/vibetv-rehearse-warm-start.sh --main
scripts/vibetv-rehearse-cold-start.sh --pr <number>
scripts/vibetv-rehearse-cold-start.sh --restore
```

Name what you are rehearsing. `--main` takes the current `main` tip as the
candidate -- that is what a release is validated with. `--pr <number>` takes an
open pull request head. Both verify the candidate's `sourceSha` against what you
asked for before anything is installed.

For `--main`, first dispatch the owner-restricted
`CODEX Prepare and Release VibeTV` workflow with the final Mac App version and
the final firmware choice. The rehearsal resolves that exact `main` SHA from
the immutable `vibetv-release-candidate` artifact and requires its successful
`vibetv-release-candidate-result`. The workflow run may still be `in_progress`
while it waits for the `Production` approval; do not filter it to completed or
successful runs. Rehearsing must not approve `Production`, dispatch a separate
publish workflow, rebuild the candidate, or create a tag. After the user
confirms that this exact candidate was tested, a later chat releases the same
bytes by approving the waiting `Production` deployment.

For `--pr`, continue to use the newest successful `CODEX Test VibeTV Merge`
candidate for that open pull request. It is test-only and cannot be promoted to
a release.

Never identify a candidate from a workflow run's head branch or head SHA. The
merge gate is dispatched from `main`, so every run of it says `main` while
building a pull request head. `--run-id` on its own rehearses whatever that run
happened to build, and says so.

Warm start needs one manual Sparkle "Install Update" click from the user -- a
native macOS dialog that cannot be scripted.

Read the **Customer Rehearsal** section in `AGENTS.md` before the first run. It
records the traps that cost bench time: the restore chain not reaching the
original state after cold+warm, token rotation on every flash,
`--keep-codexbar` being a decision, firmware not being restored, and a device
already on the candidate not producing a real cold start.

## Showing the screen is part of the job

Report the rendered UI, not `stream.healthy:true`. If you cannot take a
screenshot, run `npm run dev` in `apps/control-center` and drive the real
Companion through `http://localhost:3000` -- the DMG's local `/control-center`
answers non-native user agents with 410, and hosted `app.vibetv.shop` proxies
server-side and never reaches loopback. The local dev server cannot load the
theme catalog, so a custom theme will not preview there.

When checking a message that suggests an action, verify the action exists in the
UI. `grep` the component name; if only its own test file imports it, it is dead
code and the message points nowhere.

## Do not

- Do not run the rehearsals against a device the user has not approved for this run.
- Do not retry a failed hardware write without new approval.
- Do not report a change as validated when only the API was checked.
