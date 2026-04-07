# Vibe TV for Mac

This repository ships the firmware, macOS companion, and release artifacts for [Vibe TV](https://vibetv.shop/).
Vibe TV is the hardware. CodexBar provides the usage signal. `codexbar-display` sends that signal to the screen over USB so usage stays off-screen and on-desk.

## Endkunden-Setup

1. Verbinde dein Vibe TV per USB-Datenkabel mit deinem Mac.
2. Führe diesen Installer aus:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
```

3. Warte, bis der Setup-Lauf fertig ist.
4. Die Anzeige sollte danach automatisch starten.

Der Installer:

- prüft, dass du auf macOS bist
- lädt die passende `codexbar-display`-Version für deinen Mac
- verifiziert die Checksumme
- installiert CodexBar, falls es noch fehlt
- richtet den Hintergrunddienst ein
- wärmt CodexBar bei frischen Installationen auf
- führt am Ende einen Health-Check aus

Wenn auf dem Gerät `Waiting for frames` steht, ist die Hardware normalerweise in Ordnung. Dann hat dein Mac nur noch keine Frames gesendet.

Die vollständige Endkunden-Anleitung steht in [docs/customer-setup.md](docs/customer-setup.md).

## Was dieses Repo enthält

- ESP8266-Firmware für das aktuelle Vibe-TV-Zielgerät
- den macOS-Companion `codexbar-display`
- Release-Artefakte wie Companion-Binaries, Firmware-Binaries und Checksummen

## Technische Referenzen

Diese Seiten sind für Entwicklung, Support und Betrieb:

- Hardware-Vertrag: [docs/hardware-contract.md](docs/hardware-contract.md)
- Operator-Runbook: [docs/operator-runbook.md](docs/operator-runbook.md)
- Protokoll: [protocol/PROTOCOL.md](protocol/PROTOCOL.md)

## Lokale Entwicklung

```bash
cd companion
go test ./...
go vet ./...

cd ..
./scripts/check-esp8266-soak-gate.sh
pio run -d firmware_esp8266 -e esp8266_smalltv_st7789
```

## Lizenz

Released under the MIT License. See [LICENSE](LICENSE).
