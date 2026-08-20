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
swift -e 'import ApplicationServices; print(AXIsProcessTrusted())'   # false = your clicks are dead
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
scripts/vibetv-rehearse-cold-start.sh --pr <number>
scripts/vibetv-rehearse-warm-start.sh --pr <number>
scripts/vibetv-rehearse-cold-start.sh --restore
```

A signed merge-gate candidate is only needed for release evidence. For a normal
validation run, build locally and pass `--companion-override <path>`.

Warm start puts a Sparkle "Install Update" dialog in front of you. `AGENTS.md`
calls that click unscriptable; a Sparkle dialog does answer `Return` on its
default button, verified on the up-to-date dialog. Try `Return` before you ask
the user to click, and say which of the two happened.

Read the **Customer Rehearsal** section in `AGENTS.md` before the first run. It
records the traps that cost bench time: the restore chain not reaching the
original state after cold+warm, token rotation on every flash,
`--keep-codexbar` being a decision, firmware not being restored, and a device
already on the candidate not producing a real cold start.

## Showing the screen is part of the job

Report the rendered UI, not `stream.healthy:true`.

## Driving the installed app

Drive the app the customer actually got. Screenshots and `zoom` always work, so
you can always see; the question is only how you act.

**Synthetic mouse clicks are silently swallowed** unless the host process is
trusted for Accessibility (`AXIsProcessTrusted()`). The click still reports
`Clicked.` and nothing happens -- not in the WebView, not in a native Sparkle
dialog. Do not read that as a broken UI, and do not spend the run hunting a
coordinate offset: `zoom` proves the coordinate frame is already correct. The
one-time fix is the user's to make, in System Settings -> Privacy & Security ->
Accessibility, for the app that hosts this session (`/Applications/Claude.app`).

**The keyboard is delivered either way** -- this is the path that works today:

| goal | keys |
| --- | --- |
| move focus | `Tab`, `shift+Tab` |
| activate the focused control | `Return` |
| scroll a screen | `pagedown`, `pageup` (`Page_Down` is rejected) |
| confirm a native dialog | `Return` hits its default button |
| reload the WebView | `cmd+r` |

Every customer-facing control in this UI is a real `<button>` or `<a>`, so
tab-and-Return reaches all of them. Take a screenshot after each step: the focus
ring tells you where you are.

**Native actions have a URL scheme**, which needs no input at all:

```bash
open "vibetv://check-for-updates"        # verified end to end
open "vibetv://repair-codexbar"          # the provider recovery this PR added
open "vibetv://repair-runtime"
open "vibetv://restart-control-center"
```

Only if the installed app cannot be driven at all, fall back to `npm run dev` in
`apps/control-center` and the real Companion through `http://localhost:3000`.
Treat that as the last resort: it renders the working tree, not the candidate
bundle, so it proves nothing about the native shell. The DMG's local
`/control-center` answers non-native user agents with 410, and hosted
`app.vibetv.shop` proxies server-side and never reaches loopback. The local dev
server cannot load the theme catalog, so a custom theme will not preview there.

When checking a message that suggests an action, verify the action exists in the
UI. `grep` the component name; if only its own test file imports it, it is dead
code and the message points nowhere.

## Do not

- Do not run the rehearsals against a device the user has not approved for this run.
- Do not retry a failed hardware write without new approval.
- Do not report a change as validated when only the API was checked.
