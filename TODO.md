# vibeblock TODO (v0, Open Work Only)

## Ziel (v0)
- Eine stabile ESP8266-Firmware auf SmallTV ST7789 mit drei Runtime-Themes: `classic`, `crt`, `mini`.
- `esp8266_smalltv_st7789` ist der einzige release-gated MVP-Pfad.
- `esp8266_smalltv_st7789_alt` bleibt supported Variante (best effort, non-blocking).
- ESP32-S3 bleibt Fallback/experimental und blockiert keinen Release.
- Mini-GIF bleibt erhalten, und der GIF-Teil soll als wiederverwendbarer Core fuer neue Themes ausbaubar sein.

## Scope-Fix (bleibt konstant)
- Release-gated Env: `esp8266_smalltv_st7789`.
- Non-blocking Envs: `esp8266_smalltv_st7789_alt` (supported Variante), `lilygo_t_display_s3` (experimental fallback).
- Standard-Operator-Flow nutzt nur Runtime-Theme-Switching, keine separaten Theme- oder GIF-Firmware-Builds.
- Theme-Contract fuer v0: strict feature-gated (`theme` nur senden, wenn `hello.features` `theme` enthaelt; bei unknown/legacy hello kein Theme-Override senden).
- Kein Runtime-Media-Upload-Protokoll fuer v0.

## P0 (Ship-Blocker, in Reihenfolge)
- [ ] Release-Policy konsistent ziehen: README/Runbook/Protocol/CI auf "nur `esp8266_smalltv_st7789` ist release-blockend" angleichen.
- [ ] Hardware-Contract als klare Referenz dokumentieren (`docs/hardware-contract.md`) fuer ESP8266-Zielhardware.
- [ ] Theme-Contract strict feature-gated im Code + Tests + Doku konsistent machen.
- [ ] Versioning-Contract schliessen: `protocol/compatibility_matrix.json` vs. Companion-Guard harmonisieren und Firmware-SemVer aus Release-Version ableiten (statt statisch `1.0.0`).
- [ ] `doctor`/`setup` auf stabile Feldfaelle haerten: Board/Protocol-Checks, busy ports, reconnect/sleep-wake, sichere Port-Affinity.
- [ ] Einen fokussierten ESP8266-Soak-Gate einfuehren (`classic`/`crt`/`mini` Theme-Switch + reconnect + sleep/wake).
- [ ] GIF-Core aus dem aktuellen Mini-Theme-Pfad extrahieren (wiederverwendbarer Player statt Mini-only-Logik).
- [ ] GIF-Core mit konfigurierbarem Asset-Pfad und Zeichenbereich aufbauen; `/mini.gif` bleibt kompatibel.
- [ ] Mindestens einen zweiten Theme-Use-Case ueber denselben GIF-Core anbinden (z. B. Fullscreen-Splash-GIF), ohne separaten Firmware-Mode.
- [ ] Garantieren: fehlendes/defektes GIF fuehrt nie zu Reboot-Loop oder Black-Screen-Loop.

## P1 (nach P0)
- [ ] Go/No-Go-Checkliste finalisieren (Funktion, Stabilitaet, Setup, Upgrade, Rollback, Docs).
- [ ] E2E-Abnahme auf mindestens 2 macOS-Maschinen laufen lassen.
- [ ] RC-Flow sauber ziehen (RC -> Soak -> Final).

## v0 Done-Kriterien
- [ ] Keine offenen P0/P1-Bugs auf dem release-gated Flow (`esp8266_smalltv_st7789`).
- [ ] `esp8266_smalltv_st7789_alt` ist lauffaehig als best-effort Variante (non-blocking).
- [ ] `classic`, `crt`, `mini` laufen stabil auf `esp8266_smalltv_st7789` ohne Reflash beim Theme-Wechsel.
- [ ] Mini-GIF und der neue GIF-Core bestehen die Stabilitaets-Gates.
- [ ] Setup/Upgrade/Rollback/Troubleshooting-Doku ist konsistent mit dem echten Operator-Flow.

## Out of Scope (v0)
- Externes Theme-SDK oder Third-Party-Theme-Packaging.
- `vibeblock theme init/dev/validate/build/flash/test` Command-Familie.
- Separater GIF-Player-Firmwarepfad mit eigenem Upload-Protokoll.
