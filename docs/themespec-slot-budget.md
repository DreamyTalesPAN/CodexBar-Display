# ThemeSpec slot budget on the ESP8266

Answers the blocking question of #102/#277: can the ESP8266 keep a live theme
and a screensaver ThemeSpec resident at the same time, or must the second spec
be loaded from LittleFS on every standby transition?

**Result: both specs can stay resident, if the screensaver slot is capped.**
Loading on demand also stays inside the wake budget, so the second slot is an
optimisation, not a requirement.

Measured 2026-07-28 on the reference VibeTV (`esp8266-smalltv-st7789`,
firmware `1.0.40-dev.3f5344b`), live theme `claude-creature`.

## What a resident ThemeSpec actually costs

Today exactly one spec is cached. `activateStoredThemeSpec()` keeps the raw JSON
in `runtimeState.cachedThemeSpecRaw`, and `ensureThemeSpecSceneCached()` keeps
`cachedThemeSpecScene` (primitive array plus string pool) and, for pixels
primitives only, `cachedThemeSpecDoc`. Everything else the renderer allocates —
the CBA frame buffer, sprite caches, the GIF decoder — belongs to the theme that
is currently being drawn, not to the cached spec.

That split is what makes a second slot affordable: a cached-but-not-drawn spec
costs only the first group.

`tools/themespec-slot-budget` compiles a spec with the real firmware code and
reports that first group in xtensa-lx106 sizes (`sizeof(CompiledPrimitive)` is
104 bytes on the device, not the host size):

```
spec                                   raw prims strpool jsondoc  anim  resident
claude-creature/theme.json             913    10     146       0   yes      2114
clippy/theme.json                      865     9     149       0   yes      1965
cozy-meadow/theme.json                 796     6      44       0    no      1468
mini-classic/theme.json                697     9     101       0   yes      1741
synthwave/theme.json                   731     9      94       0    no      1766
fixtures/screensaver-countdown.json    604     5      31       0    no      1159
fixtures/worst-case-32-primitives.json 3374    32     864       0    no      7568
```

Worst case allowed by the firmware limits (`maxStoredThemeSpecBytes` 4096,
`kMaxCompiledThemeSpecPrimitives` 32, `kMaxCompiledThemeSpecStringBytes` 1024):
`4112 + 3328 + 1024 = 8464` bytes, plus roughly 1.5-2 KB more if the spec uses
`pixels` primitives and therefore pins the `JsonDocument`.

Run `tools/themespec-slot-budget/verify-target-sizes.sh` to confirm the size
constants still match the firmware build.

## Measured free heap

From `GET /health`, one spec active at a time:

| Active spec | freeHeap | maxFreeBlock | fragmentation |
|---|---:|---:|---:|
| `claude-creature` (2 CBA sprites, 11858 B frame buffer) | 15264 B | 13384 B | 13 % |
| `screensaver-countdown` (text only, no assets) | 28080 B | 27064 B | 4 % |

The 12816 B difference is almost entirely the CBA frame buffer plus sprite
caches — the per-spec structures are the small part.

Relevant firmware thresholds (`ThemeSpecRuntimePolicy`): rendering needs
≥ 6144 B free heap and ≥ 2048 B largest block, animation needs ≥ 8192 B and
≥ 3072 B.

### Headroom with a second slot

| Drawn theme | Cached second spec | Predicted freeHeap | Animation threshold (8192 B) |
|---|---|---:|---|
| `claude-creature` | countdown screensaver (1159 B) | ~14105 B | passes |
| `claude-creature` | worst-case screensaver (8464 B) | ~6800 B | **fails** |
| countdown screensaver | `claude-creature` (2114 B) | ~25966 B | passes |

So the asset-heavy direction is the binding one, and only against a screensaver
that uses the full 32 primitives and the full 4 KB spec budget.

### Correction after #280

The heap figures above were measured against firmware `1.0.40-dev.3f5344b`, before
the NTP clock landed. #280 adds 464 bytes of static RAM (`pio run` reports 42688
→ 43152 bytes), which comes straight off the free heap. The rows above should be
read roughly 464 bytes lower; the countdown-screensaver case lands near 13.6 KB
instead of 14.1 KB.

The recommendation does not change — that case keeps a wide margin over the
8192 B animation threshold, and the worst case already failed. But whoever builds
#284 should re-measure rather than reuse these absolute numbers: every slice that
adds static RAM shifts them again.

## Measured transition latency

`scripts/measure-themespec-standby-latency.sh`, 5 rounds in both directions on a
warm device. Values are wall clock from the client, so they include the
`POST /theme/active` round trip and up to one `/health` poll interval; a single
`/health` request measures 50-82 ms on this network, so roughly 110 ms of each
number is client and network overhead.

| Round | Direction | elapsed | freeHeap | maxFreeBlock | frag |
|---|---|---:|---:|---:|---:|
| 3 | → screensaver | 326 ms | 28080 B | 27064 B | 4 % |
| 3 | → live | 360 ms | 15264 B | 13384 B | 13 % |
| 4 | → screensaver | 334 ms | 28080 B | 27064 B | 4 % |
| 4 | → live | 400 ms | 15264 B | 13384 B | 13 % |
| 5 | → screensaver | 320 ms | 28080 B | 27064 B | 4 % |
| 5 | → live | 534 ms | 15264 B | 13384 B | 13 % |

Device-side load + parse + full redraw is therefore roughly **210 ms** into the
screensaver and **250-420 ms** back into the live theme. The wake direction is
the slower one because `claude-creature` has to reallocate the 11858 B CBA frame
buffer and repopulate its sprite caches — work that a resident second slot would
not avoid, because those buffers belong to the drawn theme either way.

`renderFailures` stayed at 0, `resetCount` did not move, and heap values were
bit-identical across rounds, so the release path leaves nothing behind.

## Recommendation

**Superseded on 2026-07-29 by a user decision:** the screensaver is loaded from
LittleFS on every standby transition and no second slot is held resident. The
250-420 ms wake latency measured above is accepted, and #284 ships exactly one
load path in each direction. The measurements below stand; the recommendation
they led to does not.

1. **Build the second slot as resident**, but cap the screensaver slot. A cap of
   ~2 KB resident (roughly 12 primitives and a 1 KB spec) keeps the asset-heavy
   live-theme case above the animation threshold with margin. Theme Studio
   already needs a tighter storage budget for screensavers per #102; this is the
   number it should enforce.
2. **Keep load-on-demand as the fallback** for specs above the cap, and for the
   case where `hasThemeSpecHeap()` reports pressure at the moment of the
   transition. At ~250-420 ms measured wake latency it is not a user-visible
   regression, so a spec that does not fit the resident budget can simply be
   reloaded instead of being rejected.
3. Do not size the decision off the drawn theme's buffers. The CBA frame buffer
   and sprite caches dominate free heap and are reallocated on every transition
   regardless of how many specs are cached.

## Reproducing

```sh
tools/themespec-slot-budget/verify-target-sizes.sh
tools/themespec-slot-budget/build.sh                 # all shipped theme packs
tools/themespec-slot-budget/build.sh path/to/spec.json

# writes to a live device, needs an explicit hardware-test approval
scripts/measure-themespec-standby-latency.sh --approved \
  --device http://<ip> --token "$VIBETV_TOKEN" \
  --live /themes/u/<live>.json --screensaver /themes/s/<screensaver>.json
```
