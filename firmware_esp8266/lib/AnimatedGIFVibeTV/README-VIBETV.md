# AnimatedGIFVibeTV

This directory vendors the minimal build files from Larry Bank's
`bitbank2/AnimatedGIF` release `2.2.0`:

- `src/AnimatedGIF.cpp`
- `src/AnimatedGIF.h`
- `src/gif.inl`
- `LICENSE`

Upstream: https://github.com/bitbank2/AnimatedGIF/tree/2.2.0

VibeTV patch: `MAX_CODE_SIZE` is reduced from 12 to 11. This saves 10 KiB of
contiguous decoder workspace on ESP8266. It is safe only because firmware
validates every GIF's LZW stream against the same 11-bit profile before decoder
allocation and before accepting direct GIF uploads.

The profile also sizes both palettes for RGB565 only (256 entries instead of
384) and the line buffer for the 240 px display (`MAX_WIDTH` 240 instead of
480). Together that is 752 bytes less decoder state, which a GIF theme needs in
WiFi mode (issue #520).

The `ANIMATEDGIF_VIBETV_PROFILE` compile-time profile retains only the runtime
path used by firmware: file callbacks, RGB565 big-endian palettes, RAW scanline
callbacks, regular LZW decoding, `reset`, and `close`. Turbo, COOKED and
framebuffer runtime branches remain unsupported. The parity test pins Mini
Classic's frame count, scanline count, duration and decoded-pixel hash across an
initial pass and a pass after `reset()`.

Do not update these files without rerunning the GIF profile, decoder-size,
firmware-build, and firmware-size tests.
