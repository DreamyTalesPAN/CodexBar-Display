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

1. **Preflight** -- read-only, always safe, run it first.
2. **Cold start** -- what a brand new customer gets.
3. **Warm start** -- what an existing customer walks through when updating.
4. **Restore** -- put the Mac back.

It does not mean unit tests, CI, or a healthy Companion API. Those say nothing
about what the customer sees. A message can point at an action that does not
exist in the UI, and only the rendered screen shows that.

## Procedure

```bash
scripts/vibetv-rehearse-cold-start.sh --preflight
```

Preflight changes nothing. It checks the device, the app port, mounted images,
disk space, the candidate, and whether an earlier rehearsal is still unrestored.
Fix what it reports before going further.

Cold and warm start **flash firmware**. That is a hardware write, so the
guardrails in `AGENTS.md` apply: state the device and the command, and get the
user's explicit approval for this run before starting.

```bash
scripts/vibetv-rehearse-cold-start.sh --pr <number>
scripts/vibetv-rehearse-warm-start.sh --pr <number>
scripts/vibetv-rehearse-cold-start.sh --restore
```

A signed merge-gate candidate is only needed for release evidence. For a normal
validation run, build locally and pass `--companion-override <path>`.

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
