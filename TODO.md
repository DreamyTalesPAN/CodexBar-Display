# vibeblock Roadmap to Production (Single-Board First)

## Produktannahme (v1)
- Wir supporten genau **ein** Ziel-Board in v1: LILYGO T-Display-S3 (ESP32-S3).
- Runtime bleibt USB-serial (kein WiFi/BLE).
- Companion bleibt "smart", Device/Firmware bleibt renderer- und protocol-only.
- Multi-Board-Abstraktion ist fuer v1 explizit out of scope.

## Ist-Stand (kompakt)
- Firmware + Companion-Daemon laufen auf macOS mit LILYGO T-Display-S3.
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

## Milestone 4: Single-Board Hardening (P0)
Ziel: Software ist robust gegen reale Produktionsabweichungen bei *einem* Board.

- [ ] Hardwarevertrag als Software-Artefakt dokumentieren (`docs/hardware-contract.md`):
  - Board-ID/SKU, Display-Controller, Aufloesung, Rotation, Touch-Controller, erwartete USB-Identitaet.
- [ ] Firmware sendet beim Boot einen klaren Handshake (`board`, `fwVersion`, `protocolVersion`).
- [ ] Companion prueft Handshake und gibt bei Mismatch eine klare `unsupported-hardware` Meldung.
- [ ] Setup validiert Ziel-Hardware vor dem Flashen (frueher Abbruch + Recovery-Hinweis).
- [ ] `doctor` um einen expliziten Device-Contract-Check erweitern.

Acceptance:
- [ ] Falsche/inkompatible Hardware wird innerhalb von 5s eindeutig erkannt.
- [ ] Korrekte Hardware zeigt nach Daemon-Start innerhalb von 15s einen gueltigen Frame.

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
