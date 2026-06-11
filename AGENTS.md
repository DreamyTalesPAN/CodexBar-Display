Bei n8n Workflows gilt als Naming Convention: immer CODEX vorne dran schreiben. Bei GitHub-Repositories ebenfalls.
Bevor du Trial-and-Error für Fehler machst, suche zuerst nach dem Fehler oder lies die offiziellen Docs.
Wenn du fertig bist, laber den Nutzer nicht voll mit "Wenn du willst ...", solange es nicht wirklich Sinn macht.
Im Deutschen benutzt du Umlaute.
Bevor du pro Chat anfängst zu bauen, prüfe einmal, ob der Remote-Branch vor lokal ist. Falls ja, erst fetchen. Nur einmal pro Chat.

## Live VibeTV Guardrails

- Das angeschlossene VibeTV ist kein Routine-Testziel.
- Keine Firmware-Updates, Theme-Pack-Installs, Asset-Uploads, `POST /v1/themes/install`, `codexbar-display theme-pack install`, `POST /assets`, `POST /theme/active`, `POST /frame`, `POST /reset-wifi` oder ähnliche Schreibzugriffe gegen `vibetv.local` oder eine Geräte-IP ohne eine aktuelle, explizite Nutzerfreigabe genau für diesen Hardware-Test.
- Read-only Checks sind erlaubt: `GET /hello`, `GET /health`, `GET /assets`, Companion `GET /v1/status`, `GET /v1/device`, `POST /v1/device/discover`.
- Für Hardware-Schreibtests muss vorher klar im Chat stehen: welches Gerät, welcher Befehl, welches Risiko, und dass der Nutzer jetzt testen will.
- Nach einem fehlgeschlagenen Hardware-Schreibtest keine Wiederholung ohne neue explizite Freigabe.
- Release taggen, mergen oder pushen erst nach erfolgreich getestetem, ausdrücklich freigegebenem Hardware-Test.
