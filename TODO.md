# vibeblock Roadmap to Production (Dual-Target)

## Prioritaet Jetzt: Refactor & Verbesserungen
Ziel: Nach dem Dual-Target-Merge die groessten Wartbarkeits- und Betriebsrisiken reduzieren.

- [x] Firmware weiter modularisieren:
  - [x] `firmware_esp8266/src/main.cpp` in klar getrennte Module fuer transport, parser, rendering, runtime state aufteilen.
  - [x] Gleiches Modul-Schnittbild fuer ESP8266 und ESP32 etablieren, damit Features auf beiden Targets gleich eingefuehrt werden.
- [x] Theme-Registry zentralisieren:
  - [x] Ein zentrales Mapping (`theme id -> protocol name -> compile default`) fuer Firmware + Companion statt mehrfacher String-Konstanten.
  - [x] Theme-Validierung in einem Shared-Ort halten (Companion + Protokollschema + Docs synchron).
- [ ] Protokoll-Hardening ausbauen:
  - [x] Golden-Frame-Tests fuer V1 (valid/invalid/oversized/capability-gated) zentral im `protocol/` Bereich pflegen.
  - Parser- und Serializer-Verhalten fuer ESP8266, ESP32 und Companion gegen dieselben Fixtures pruefen.
- [x] Setup/Runtime-Konfiguration konsolidieren:
  - [x] Prioritaetsregeln finalisieren und testen (`CLI > ENV > runtime config > firmware default`).
  - [x] `vibeblock setup` um `validate-only`/`dry-run` erweitern fuer sichere Produktions-Checks.
- [x] USB-Transport entkoppeln und testbarer machen:
  - [x] `usb` package weiter auf explizite Interfaces reduzieren (discover/open/send/read hello), um Race-/Reconnect-Pfade isoliert testen zu koennen.
  - [x] Serial-Integrationstests mit pseudo-tty/mock-device fuer reconnect/sleep-wake Fehlerbilder einfuehren.
- [x] Error-Codes und Logs standardisieren:
  - [x] Fehlertaxonomie finalisieren (`transport/*`, `protocol/*`, `runtime/*`, `setup/*`) und in Docs/Runbook spiegeln.
  - [x] Jeder user-facing Fehler bekommt einen stabilen Code + konkrete Recovery-Aktion.
- [x] CI-Qualitaetsgates erweitern:
  - [x] `golangci-lint`/`staticcheck` fuer Companion aktivieren.
  - [x] Firmware-Checks um grobe Groessenbudgets erweitern (Warnung/Fail bei deutlichen Regressions in Flash/RAM).
- [x] Benchmarks und Budgetgrenzen einfuehren:
  - [x] Polling-/Render-Zyklen im Companion und auf Firmware-Seite messbar machen.
  - [x] Zielbudgets fuer Latenz (frame render), CPU-Zeit und Speicherverbrauch je Target dokumentieren.

Acceptance:
- [ ] Kritische Kernlogik ist in kleine, isoliert testbare Module getrennt (Firmware + Companion).
- [ ] Protokoll- und Theme-Verhalten ist ueber Targets hinweg konsistent und fixture-getrieben getestet.
- [ ] Setup-, Runtime- und Support-Pfade sind ohne manuelle Sonderfaelle reproduzierbar.

## Prioritaet Jetzt: Dual-Target Merge Baseline
Ziel: Branch auf `main` integrieren, so dass ESP8266 und ESP32 sauber unter einer Architektur laufen.

- [x] Board-Registry einfuehren (`firmware-env -> project dir -> expected board ids -> capabilities`), keine Prefix-Heuristik mehr.
- [x] Default-Ziel fuer Setup auf ESP8266 umstellen, ESP32 als explizites Secondary-Target halten.
- [x] Firmware-Handshake standardisieren (`hello` mit `board`, `protocolVersion`, `features`, `maxFrameBytes`) fuer ESP8266 und ESP32.
- [x] Companion liest Device-Capabilities und gate't optionale Felder (z. B. `theme`) statt blind zu senden.
- [x] Setup nutzt Handshake fuer fruehes Mismatch-Feedback (`unsupported-hardware`) wenn Board-ID vorhanden ist.
- [x] Firmware-Codepfade auf gemeinsamen Core ausrichten (Parser/State/Render-Policy), Board-spezifisch nur Pins/Display.
- [x] CI/Test-Gates fuer beide Targets erweitern (Go-Tests + PlatformIO build je mindestens ein ESP8266- und ein ESP32-env).
- [x] Operator-/Setup-Doku auf Dual-Target und neuen Default synchronisieren.

Acceptance:
- [ ] `vibeblock setup` funktioniert out-of-the-box fuer ESP8266 (Default) und explizit fuer ESP32.
- [ ] Companion sendet nur kompatible optionale Features, core Usage-Frames laufen auf beiden Targets.
- [ ] Board-Mismatch wird klar gemeldet, legacy/no-hello Devices bleiben mit fallback nutzbar.

## Produktannahme (v1)
- Wir supporten in v1 zwei Ziel-Boards:
  - ESP8266 SmallTV ST7789 (inkl. Alt-Mapping als eigener Firmware-Env)
  - LILYGO T-Display-S3 (ESP32-S3)
- Runtime bleibt USB-serial (kein WiFi/BLE).
- Companion bleibt "smart", Device/Firmware bleibt renderer- und protocol-only.
- Multi-Board-Abstraktion ist fuer v1 auf diese beiden Boards begrenzt und explizit im Scope.

## Ist-Stand (kompakt)
- Firmware + Companion-Daemon laufen auf macOS mit ESP8266 SmallTV und LILYGO T-Display-S3.
- Protokoll V1 (`protocol/PROTOCOL.md`) ist definiert und im Einsatz.
- LaunchAgent-Betrieb funktioniert.
- Provider-Auswahl laeuft deterministisch ueber lokale Activity-Signale + Fallback-Regeln.
- `vibeblock setup` ist idempotent und deckt Flash + Install + LaunchAgent ab.

## Milestone 1: Provider-Erkennung robust machen (P0) - abgeschlossen
Ziel: Das Display zeigt zuverlaessig den zuletzt aktiv genutzten Provider.

- [x] Provider-Adapter-Architektur eingefuehrt (`provider -> activity detector`).
- [x] Activity-Quellen dokumentiert und Fallback-/Konfliktregeln standardisiert.
- [x] Reproduzierbare Switching-Testmatrix umgesetzt.

Acceptance:
- [x] 30/30 deterministische Switch-Szenarien gruen (`TestProviderSelectionMatrix30Scenarios`).
- [x] Kein dauerhaftes Haengen auf falschem Provider ohne neues Activity-Event.

## Milestone 2: Runtime-Resilienz (P0) - abgeschlossen
Ziel: Stabiler Dauerbetrieb auf dem Schreibtisch.

- [x] USB-Reconnect, Sleep/Wake und Fehlerpfade gehaertet.
- [x] Strukturierte Laufzeit-Logs und erweiterter `doctor`-Check vorhanden.

Acceptance:
- [x] 24h Soak-Test (simuliert) ohne Daemon-Absturz.
- [x] 10x Unplug/Replug und 10x Sleep/Wake ohne manuellen Eingriff.

## Milestone 3: Setup "einmal ausfuehren" (P0) - abgeschlossen
Ziel: Neue User koennen ohne Handarbeit starten.

- [x] `vibeblock setup` vervollstaendigt.
- [x] Port-Autodetection + interaktive Auswahl stabilisiert.
- [x] Recovery-Hinweise und Idempotenz umgesetzt.

Acceptance:
- [x] Setup auf frischem macOS ohne manuelle Dateikopie.
- [x] Dienst startet nach Reboot automatisch.

## Milestone 4: Dual-Target Hardening (P0)
Ziel: Software ist robust gegen reale Produktionsabweichungen auf beiden Board-Familien.

- [ ] Hardwarevertrag als Software-Artefakt dokumentieren (`docs/hardware-contract.md`) fuer beide Targets:
  - Board-ID/SKU, Display-Controller, Aufloesung, Rotation, Touch-Controller (falls vorhanden), erwartete USB-Identitaet.
- [ ] Firmware sendet beim Boot einen klaren Handshake (`board`, `fwVersion`, `protocolVersion`).
- [ ] Companion prueft Handshake und gibt bei Mismatch eine klare `unsupported-hardware` Meldung.
- [ ] Setup validiert Ziel-Hardware vor dem Flashen (frueher Abbruch + Recovery-Hinweis).
- [ ] `doctor` um einen expliziten Device-Contract-Check erweitern.

Acceptance:
- [ ] Falsche/inkompatible Hardware wird innerhalb von 5s eindeutig erkannt (ESP8266 und ESP32).
- [ ] Korrekte ESP8266- und ESP32-Hardware zeigt nach Daemon-Start innerhalb von 15s einen gueltigen Frame.

## Milestone 5: Versionierung, Upgrade, Rollback (P0)
Ziel: Sicheres Updaten ohne Neu-Setup.

- [ ] SemVer und Kompatibilitaetsmatrix fuer `companion` <-> `firmware` definieren.
- [ ] Release-Prozess definieren (Tagging, Artefakte, Changelog, Checks).
- [ ] Upgrade-Command inkl. Preflight bauen (`port busy`, `version guard`, `flash`).
- [ ] Rollback auf last-known-good Firmware + Companion dokumentieren und scriptbar machen.
- [ ] Known-good Recovery-Firmware offiziell bereitstellen.

Acceptance:
- [ ] Upgrade von N auf N+1 ohne Neu-Setup moeglich.
- [ ] Inkompatible Versionen werden blockiert und mit konkretem Fix-Hinweis versehen.
- [ ] Rollback-Pfad ist dokumentiert und getestet.

## Milestone 6: Observability & Supportability (P1)
Ziel: Feldprobleme schnell diagnostizieren, ohne Codeaenderung.

- [ ] Logs in stabile Kategorien + Error-Codes gliedern (`transport/*`, `codexbar/*`, `protocol/*`, `runtime/*`).
- [ ] Optionalen Debug-Modus mit erhoehtem Detailgrad einfuehren.
- [ ] Support-Bundle-Command bauen (doctor-output, letzte Logs, relevante Env-Konfiguration).
- [ ] Troubleshooting-Guide auf Top-Feldfehler erweitern.

Acceptance:
- [ ] Haeufige Supportfaelle sind mit `doctor` + Support-Bundle reproduzierbar aufloesbar.

## Milestone 7: Production Gate (Go/No-Go)
Ziel: Verbindliche Abnahmekriterien vor erstem produktiven Rollout.

- [ ] Finale Go/No-Go-Checkliste erstellen (Funktion, Stabilitaet, Setup, Upgrade, Doku).
- [ ] E2E-Abnahme auf mindestens 2 macOS-Geraeten durchfuehren.
- [ ] Release-Kandidaten-Prozess (RC -> soak -> final) einfuehren.

Go-Live-Kriterien:
- [ ] Milestones 4 bis 6 abgeschlossen.
- [ ] Keine offenen P0/P1-Bugs.
- [ ] Setup-, Upgrade-, Rollback- und Troubleshooting-Doku aktuell.

## Milestone 8: Rich Rendering & Media (P1, post-v1)
Ziel: Formen/GIF/JPG integrieren, ohne den CodexBar-Usage-Kern zu verlieren.

- [ ] Protocol-v2-Draft finalisieren (`protocol/PROTOCOL_V2_DRAFT.md`).
- [ ] V2-Felder als optionale Erweiterung spezifizieren (`renderMode`, `shapePreset`, `mediaSlot`, `mediaFit`, `mediaLoop`).
- [ ] Companion-Protokollmodell erweitern, Defaults auf `usage` setzen.
- [ ] Firmware-Parser fuer V2-Felder erweitern (unknown fields weiterhin ignorieren).
- [ ] Render-Pipeline in Schichten umsetzen (usage -> shapes -> media -> error override).
- [ ] Asset-Manifestformat definieren (`/.sys/assets.json`, `slot -> path -> sha256`).
- [ ] Device-Assetstore auf LittleFS einfuehren (Slot-basierte Referenzierung statt Stream).
- [ ] `vibeblock media sync` (Upload + Verify + Manifest write) implementieren.
- [ ] Capability-Handshake fuer V2 einfuehren (`protocolVersion`, `features`, `codecs`, `maxAssetBytes`) und im Companion vor V2-Nutzung pruefen.
- [ ] `media sync` atomisch machen (staging dir + checksum verify + commit/swap), damit kein halbfertiger Asset-Stand aktiv wird.
- [ ] V2-Schema formal definieren (Enums + Grenzen) und Golden-Frame-Tests fuer Companion/Firmware-Paare einfuehren.
- [ ] GIF/JPG-Decoder integrieren mit harten Guards (size, timeout, single decoder).
- [ ] Decoder-Ressourcenbudgets und Schutzmechanismen implementieren (watchdog-safe decode slices, memory caps, decode retry/backoff).
- [ ] Runtime/Health um Media-Telemetrie erweitern (`media/decode-error`, `media/slot-miss`, `media/fallback-count`).
- [ ] ESP8266-first Renderprofil festlegen (Asset-Limits, erlaubte Aufloesungen, FPS/loop limits, bevorzugte Codecs) und als Baseline dokumentieren.
- [ ] Fallback-Strategie implementieren: bei Asset/Decode-Fehler automatisch auf Usage-UI.
- [ ] Testmatrix erweitern: corrupted GIF, missing slot, sleep/wake, reconnect, long soak.

Acceptance:
- [ ] Usage-Daten bleiben in allen Render-Modi korrekt sichtbar (ausser `media_only`).
- [ ] V1-Kompatibilitaet bleibt erhalten (V1-Firmware ignoriert neue Felder).
- [ ] Defekte Assets fuehren nicht zu Reboot/Haenger.
- [ ] Runtime bleibt robust bei USB-Reconnect und Sleep/Wake.
- [ ] ESP8266-Baseline bleibt stabil (keine OOM/Watchdog-Resets unter soak und bei fehlerhaften Assets).
