Bei n8n Workflows gilt als Naming Convention: immer CODEX vorne dran schreiben. Bei GitHub-Repositories ebenfalls.
Bevor du Trial-and-Error für Fehler machst, suche zuerst nach dem Fehler oder lies die offiziellen Docs.
Wenn du fertig bist, laber den Nutzer nicht voll mit "Wenn du willst ...", solange es nicht wirklich Sinn macht.
Im Deutschen benutzt du Umlaute.
Bevor du pro Chat anfängst zu bauen, prüfe einmal, ob der Remote-Branch vor lokal ist. Falls ja, erst fetchen. Nur einmal pro Chat.

## Merge-, Release- und Production-Guardrails

- Niemals `gh pr merge`, `git merge` nach `main`, `git push origin main`, `git tag`, `git push origin refs/tags/*`, `gh release ...` oder einen Release-Workflow auslösen, außer der Nutzer gibt in der aktuellen Unterhaltung eine explizite Freigabe für genau diese Aktion und genau dieses Ziel.
- Eine Freigabe für `deploy`, `live app ready`, `push branch`, `prüfen`, `vorbereiten`, `testen` oder `fixen` ist keine Freigabe für Merge, Main-Push, Release oder Tag.
- Vor jeder Merge-, Main-Push-, Tag- oder Release-Aktion: in einer separaten Nachricht Aktion, Ziel und Risiko nennen und auf ausdrückliche Bestätigung warten. Ohne Bestätigung stoppen.
- `app.vibetv.shop` deployen ist ein anderer Vorgang als `main` mergen oder einen Release-Tag setzen.
- Lokale Git-Guardrails müssen aktiv sein: `./scripts/install-agent-git-guardrails.sh` installiert einen `pre-push`-Hook, der `main`-Pushes und Tag-Pushes blockiert, solange nicht bewusst ein Override gesetzt wurde.
- Wenn versehentlich eine verbotene Aktion gestartet wurde: sofort stoppen, laufende Release-Jobs abbrechen, lokale/remote Tags entfernen, Status melden und keine weitere Änderung an `main` ohne neue Freigabe.

## Live VibeTV Guardrails

- Das angeschlossene VibeTV ist kein Routine-Testziel.
- Keine Firmware-Updates, Theme-Pack-Installs, Asset-Uploads, `POST /v1/themes/install`, `codexbar-display theme-pack install`, `POST /assets`, `POST /theme/active`, `POST /frame`, `POST /reset-wifi` oder ähnliche Schreibzugriffe gegen `vibetv.local` oder eine Geräte-IP ohne eine aktuelle, explizite Nutzerfreigabe genau für diesen Hardware-Test.
- Read-only Checks sind erlaubt: `GET /hello`, `GET /health`, `GET /assets`, Companion `GET /v1/status`, `GET /v1/device`, `POST /v1/device/discover`.
- Für Hardware-Schreibtests muss vorher klar im Chat stehen: welches Gerät, welcher Befehl, welches Risiko, und dass der Nutzer jetzt testen will.
- Nach einem fehlgeschlagenen Hardware-Schreibtest keine Wiederholung ohne neue explizite Freigabe.
- Release taggen, mergen oder `main` pushen fällt zusätzlich unter die Merge-, Release- und Production-Guardrails oben.
