#!/usr/bin/env bash
set -euo pipefail

elf_path="${1:-firmware_esp8266/.pio/build/esp8266_smalltv_st7789/firmware.elf}"
if [ ! -f "$elf_path" ]; then
  echo "firmware ELF not found: $elf_path" >&2
  exit 2
fi

tool_dir="${PLATFORMIO_XTENSA_TOOL_DIR:-${HOME}/.platformio/packages/toolchain-xtensa/bin}"
nm_tool="${tool_dir}/xtensa-lx106-elf-nm"
objdump_tool="${tool_dir}/xtensa-lx106-elf-objdump"
if [ ! -x "$nm_tool" ] || [ ! -x "$objdump_tool" ]; then
  echo "xtensa toolchain not found under: $tool_dir" >&2
  exit 2
fi

frame_bytes() {
  local symbol="$1"
  local address
  local disassembly
  local addi
  local reg
  local imm
  address="$("$nm_tool" -n -C "$elf_path" | awk -v symbol="$symbol" 'index($0, symbol) { print "0x"$1; exit }')"
  if [ -z "$address" ]; then
    echo "symbol not found: $symbol" >&2
    exit 1
  fi

  disassembly="$("$objdump_tool" -d -C --start-address="$address" --stop-address="$((address + 96))" "$elf_path")"
  addi="$(printf '%s\n' "$disassembly" | sed -nE 's/.*addi[[:space:]]+a1, a1, -([0-9]+).*/\1/p' | head -n 1)"
  addi="${addi:-0}"

  reg="$(printf '%s\n' "$disassembly" | sed -nE 's/.*sub[[:space:]]+a1, a1, a([0-9]+).*/\1/p' | head -n 1)"
  if [ -z "$reg" ]; then
    if [ "$addi" = "0" ]; then
      echo "stack prologue not found for symbol: $symbol" >&2
      exit 1
    fi
    echo "$addi"
    return
  fi

  imm="$(printf '%s\n' "$disassembly" | sed -nE "s/.*movi[[:space:]]+a${reg}, 0x([0-9a-fA-F]+).*/\\1/p" | head -n 1)"
  if [ -z "$imm" ]; then
    echo "stack subtraction immediate not found for symbol: $symbol" >&2
    exit 1
  fi
  echo $((addi + 0x$imm))
}

parse_frame="$(frame_bytes 'codexbar_display::core::ParseFrameLine')"
consume_frame="$(frame_bytes 'codexbar_display::core::ConsumeFrameLine')"
handle_frame="$(frame_bytes '(anonymous namespace)::handleFrame()')"
combined=$((parse_frame + consume_frame + handle_frame))

echo "stack frame ParseFrameLine=${parse_frame}/1408 bytes"
echo "stack frame ConsumeFrameLine=${consume_frame}/1152 bytes"
echo "stack frame handleFrame=${handle_frame}/128 bytes"
echo "stack frame combined_frame_path=${combined}/3000 bytes"

if [ "$parse_frame" -gt 1408 ] ||
   [ "$consume_frame" -gt 1152 ] ||
   [ "$handle_frame" -gt 128 ] ||
   [ "$combined" -gt 3000 ]; then
  echo "ESP8266 frame parse stack budget exceeded" >&2
  exit 1
fi
