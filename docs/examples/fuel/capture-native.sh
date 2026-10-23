#!/bin/sh
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$BASE/../../.." && pwd)
mkdir -p "$BASE/out"
c++ -std=c++17 -O2 -I"$REPO/firmware_shared" -I"$REPO/firmware_esp8266/.pio/libdeps/esp8266_smalltv_st7789/TFT_eSPI" -I"$REPO/firmware_esp8266/.pio/libdeps/native_theme_spec_renderer/ArduinoJson/src" "$BASE/capture-native.cpp" -o "$BASE/render"
"$BASE/render" "$BASE"
python3 - "$BASE/out" <<'PY'
from PIL import Image, ImageDraw
from pathlib import Path
import sys
base=Path(sys.argv[1])
for p in base.glob('*.ppm'):
 Image.open(p).save(p.with_suffix('.png'))
canvas=Image.new('RGB',(780,320),'#181b1f')
d=ImageDraw.Draw(canvas)
for n,pct in enumerate([0,50,100]):
 canvas.paste(Image.open(base/f'fuel-native-{pct}.png'),(10+n*260,44))
 d.text((10+n*260,16),f'Fuel / {pct}% used',fill='white')
d.text((10,299),'Host framebuffer simulation: shared firmware renderer; no physical-device capture',fill='#bbc0c5')
canvas.save(base/'fuel-native-contact-sheet.png')
for pct in [0,50,100]:
 im=Image.open(base/f'fuel-native-{pct}.png')
 assert im.size==(240,240)
 red=[(x,y) for y in range(240) for x in range(240) if (lambda c:c[0]>200 and c[1]<100 and c[2]<60)(im.getpixel((x,y)))]
 # Exclude permanent empty marker at x<50; needle changes position with usage.
 blade=[(x,y) for x,y in red if x>=50]
 assert blade
 if pct==0: assert min(x for x,y in blade)<60 and max(x for x,y in blade)<120
 if pct==50: assert min(y for x,y in blade)<80 and min(x for x,y in blade)>110
 if pct==100: assert max(x for x,y in blade)>190 and min(x for x,y in blade)>120
 print(f'{pct}%: frame 240x240; red blade bounds',min(x for x,y in blade),min(y for x,y in blade),max(x for x,y in blade),max(y for x,y in blade))
PY
