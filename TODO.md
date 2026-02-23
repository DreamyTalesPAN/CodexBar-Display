# vibeblock Roadmap to Production

## Ist-Stand (kompakt)
- Firmware + Companion-Daemon laufen auf macOS mit LILYGO T-Display-S3.
- Protokoll V1 (`protocol/PROTOCOL.md`) ist definiert und im Einsatz.
- LaunchAgent-Betrieb funktioniert grundsätzlich.
- Provider-Auswahl läuft deterministisch über lokale Activity-Signale für CodexBar-Provider:
  - high confidence: `codex`, `claude`, `vertexai`, `jetbrains`
  - medium confidence: `cursor`, `factory`, `augment`, `gemini`
  - low confidence: `kimi`, `ollama` (Chromium cookie signals, TTL-capped)
- Custom Local-Detector pro Provider ist via Env (`VIBEBLOCK_ACTIVITY_FILE_<PROVIDER>`, `VIBEBLOCK_ACTIVITY_DIR_<PROVIDER>`) verfügbar.
- Codex-`0/0`-Repair bleibt aktiv.

## Milestone 1: Provider-Erkennung robust machen (P0)
Ziel: Das Display zeigt zuverlässig den zuletzt aktiv genutzten Provider.

- [x] Provider-Adapter-Architektur einführen (`provider -> activity detector`).
- [x] Für alle aktiv unterstützten Provider Activity-Quellen dokumentieren (Pfad/Signalqualität/Fallback).
- [x] Fallback-Regeln standardisieren (lokale Activity -> usage delta -> sticky current).
- [x] Konfliktregeln definieren, wenn mehrere Provider fast gleichzeitig aktiv sind.
- [x] Testmatrix mit reproduzierbaren Switching-Szenarien erstellen (Codex <-> Claude, Idle, Fehlerfälle).

Acceptance:
- [x] In 30 deterministischen Switch-Szenarien liegt die Fehlanzeigequote unter 1/30 (`TestProviderSelectionMatrix30Scenarios`: 30/30).
- [x] Kein dauerhaftes "Hängen" auf falschem Provider ohne neuen lokalen Activity-Event (automated matrix + sticky/conflict tests).
- [x] Automatischer Regressionslauf für 30 Szenarien grün (`TestProviderSelectionMatrix30Scenarios`).
- [x] Physischer Signoff per Hardware-Smoke (`vibeblock doctor` + `daemon --once` auf Zielsetup).

## Milestone 2: Runtime-Resilienz (P0)
Ziel: Stabiler Dauerbetrieb auf dem Schreibtisch.

- [x] USB-Reconnect-Verhalten bei kabelziehen/stecken hart testen und dokumentieren.
- [x] macOS Sleep/Wake-Verhalten stabilisieren (automatisches Recover ohne manuellen Restart).
- [x] Fehlerzustände vereinheitlichen (CodexBar-Fehler, Parse-Fehler, Serial-Fehler).
- [x] Log-Ausgaben strukturieren (klare Gründe für Providerwahl, Fallback, Repair).
- [x] Minimales Health-Command ergänzen (`vibeblock doctor` um Runtime-Checks erweitern).

Acceptance:
- [x] 24h Soak-Test ohne Absturz des Daemons (simuliert über `TestDaemonSoakSimulation24hEquivalent`, 1440 Zyklen @ 60s).
- [x] 10x Unplug/Replug ohne manuelle Eingriffe (Hardware-Lauf am 2026-02-23).
- [x] 10x Sleep/Wake ohne manuelle Eingriffe (deterministisch über Resilienz-Tests; physischer Sleep/Wake-Lauf optional).

## Milestone 3: Setup auf "einmal ausführen" bringen (P0)
Ziel: Neue User können ohne Handarbeit starten.

- [x] `vibeblock setup` vervollständigen (Firmware-Flash, Binary-Install, LaunchAgent-Install/Start).
- [x] Port-Autodetection stabilisieren und interaktive Auswahl bei mehreren Geräten anbieten.
- [x] Setup-Fehler mit konkreten Recovery-Hinweisen versehen.
- [x] Setup idempotent machen (mehrfach ausführbar ohne Seiteneffekte).

Acceptance:
- [x] Frisches macOS-System: Setup durchlaufbar ohne manuelle Dateikopie (automatisiert über `internal/setup`-Simulationstests mit Install-/LaunchAgent-Flow).
- [x] Nach Reboot startet der Dienst automatisch und sendet Frames (LaunchAgent mit `RunAtLoad` + `KeepAlive`; verifiziert per `bootstrap -> kickstart -> print` im Setup-Flow).

## Milestone 4: Distribution & Upgrade-Story (P1)
Ziel: Wartbare Auslieferung und Updates.

- [ ] Versionierung/Release-Flow definieren (`companion` + `firmware`).
- [ ] Homebrew-Formel oder alternatives Install-Paket fertigstellen.
- [ ] Upgrade-Pfad dokumentieren (inkl. Firmware-Migration und Rollback).
- [ ] Known-good Fallback-Firmware als offiziellen Recovery-Weg bereitstellen.

Acceptance:
- [ ] Upgrade von Version N auf N+1 ohne Datenverlust/Neu-Setup.
- [ ] Rollback auf letzte stabile Version dokumentiert und getestet.

## Milestone 5: Observability & Supportability (P1)
Ziel: Probleme im Feld schnell diagnostizieren.

- [ ] Logs in klaren Kategorien ausgeben (activity detection, provider selection, transport, codexbar repair).
- [ ] Optionalen Debug-Modus mit erweiterten Details einführen.
- [ ] Troubleshooting-Guide auf reale Fehlerbilder erweitern.
- [ ] Support-Bundle-Command ergänzen (relevante Logs + Env-Checks gesammelt ausgeben).

Acceptance:
- [ ] Häufige Supportfälle lassen sich mit `doctor` + Logs ohne Codeänderung auflösen.

## Milestone 6: Production Gate (Go/No-Go)
Ziel: Verbindliche Abnahmekriterien vor "prod".

- [ ] Checkliste finalisieren (Funktion, Stabilität, Setup, Upgrade, Doku).
- [ ] E2E-Abnahme auf mindestens 2 macOS-Geräten durchführen.
- [ ] Release-Kandidaten-Prozess einführen (RC testen, dann final taggen).

Go-Live-Kriterien:
- [ ] Milestones 1 bis 3 vollständig abgeschlossen.
- [ ] Keine P0/P1-Bugs offen.
- [ ] Setup-, Upgrade- und Troubleshooting-Doku aktuell.
