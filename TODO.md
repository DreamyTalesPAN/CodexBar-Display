# codexbar-display Status

## Aktueller Fokus

- stabiler Endkunden-Setup auf dem Mac
- ein Install-Befehl ohne manuelles Flashen
- automatischer Start des Hintergrunddiensts nach dem Setup

## Verifiziert

- [x] Frischer Kundenlauf über `install.sh` funktioniert auf macOS arm64.
- [x] CodexBar wird bei Bedarf automatisch installiert.
- [x] Der Setup-Flow erkennt den USB-Port automatisch.
- [x] Der LaunchAgent startet nach dem Setup automatisch.
- [x] Das Gerät bekommt nach dem Setup automatisch neue Frames.
- [x] `./scripts/smoke-daemon-sent-frame.sh` ist grün.
- [x] `go test ./...`, `go vet ./...`, `pio run -d firmware_esp8266 -e esp8266_smalltv_st7789` und `./scripts/check-esp8266-soak-gate.sh` sind grün.
- [x] E2E-Setup ist auf zwei macOS-Maschinen validiert.

## Nicht Teil des aktuellen Setup-Meilensteins

- formale Release-Readiness-Checklist
- `RC -> soak -> final`
- zusätzliche SDK- oder Theme-Packaging-Themen
