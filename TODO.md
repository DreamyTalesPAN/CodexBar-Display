# vibeblock Roadmap to Production

## Ist-Stand (kompakt)
- Firmware + Companion-Daemon laufen auf macOS mit LILYGO T-Display-S3.
- Protokoll V1 (`protocol/PROTOCOL.md`) ist definiert und im Einsatz.
- LaunchAgent-Betrieb funktioniert grundsätzlich.
- Provider-Auswahl ist auf lokale Aktivitätslogs (Codex/Claude) umgestellt, Codex-`0/0`-Repair bleibt aktiv.

## Milestone 1: Provider-Erkennung robust machen (P0)
Ziel: Das Display zeigt zuverlässig den zuletzt aktiv genutzten Provider.

- [ ] Provider-Adapter-Architektur einführen (`provider -> activity detector`).
- [ ] Für alle aktiv unterstützten Provider Activity-Quellen dokumentieren (Pfad/Signalqualität/Fallback).
- [ ] Fallback-Regeln standardisieren (lokale Activity -> usage delta -> sticky current).
- [ ] Konfliktregeln definieren, wenn mehrere Provider fast gleichzeitig aktiv sind.
- [ ] Testmatrix mit reproduzierbaren Switching-Szenarien erstellen (Codex <-> Claude, Idle, Fehlerfälle).

Acceptance:
- [ ] In 30 manuellen Switch-Tests liegt die Fehlanzeigequote unter 1/30.
- [ ] Kein dauerhaftes "Hängen" auf falschem Provider ohne neuen lokalen Activity-Event.

## Milestone 2: Runtime-Resilienz (P0)
Ziel: Stabiler Dauerbetrieb auf dem Schreibtisch.

- [ ] USB-Reconnect-Verhalten bei kabelziehen/stecken hart testen und dokumentieren.
- [ ] macOS Sleep/Wake-Verhalten stabilisieren (automatisches Recover ohne manuellen Restart).
- [ ] Fehlerzustände vereinheitlichen (CodexBar-Fehler, Parse-Fehler, Serial-Fehler).
- [ ] Log-Ausgaben strukturieren (klare Gründe für Providerwahl, Fallback, Repair).
- [ ] Minimales Health-Command ergänzen (`vibeblock doctor` um Runtime-Checks erweitern).

Acceptance:
- [ ] 24h Soak-Test ohne Absturz des Daemons.
- [ ] 10x Unplug/Replug + 10x Sleep/Wake ohne manuelle Eingriffe.

## Milestone 3: Setup auf "einmal ausführen" bringen (P0)
Ziel: Neue User können ohne Handarbeit starten.

- [ ] `vibeblock setup` vervollständigen (Firmware-Flash, Binary-Install, LaunchAgent-Install/Start).
- [ ] Port-Autodetection stabilisieren und interaktive Auswahl bei mehreren Geräten anbieten.
- [ ] Setup-Fehler mit konkreten Recovery-Hinweisen versehen.
- [ ] Setup idempotent machen (mehrfach ausführbar ohne Seiteneffekte).

Acceptance:
- [ ] Frisches macOS-System: Setup durchlaufbar ohne manuelle Dateikopie.
- [ ] Nach Reboot startet der Dienst automatisch und sendet Frames.

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
