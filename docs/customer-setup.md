# Vibe TV Setup auf dem Mac

Diese Anleitung ist für Endkunden gedacht: Gerät anschließen, einen Befehl ausführen, fertig.

## Das brauchst du

- ein Vibe TV
- ein USB-Datenkabel
- einen Mac mit Internetzugang

## Installation

1. Verbinde das Vibe TV mit deinem Mac.
2. Öffne das Terminal.
3. Führe diesen Befehl aus:

```bash
curl -fsSL https://github.com/DreamyTalesPAN/CodexBar-Display/releases/latest/download/install.sh | bash
```

## Was der Installer macht

Der Installer erledigt alles automatisch:

1. Er erkennt die Architektur deines Macs.
2. Er lädt die passende `codexbar-display`-Version aus dem neuesten GitHub Release.
3. Er prüft die Checksumme.
4. Er installiert CodexBar, falls CodexBar noch fehlt.
5. Er führt `codexbar-display setup --yes --skip-flash` aus.
6. Er startet den Hintergrunddienst, der die Frames an das Display sendet.
7. Er führt am Ende einen Health-Check aus.

## Woran du Erfolg erkennst

- Im Terminal erscheint eine erfolgreiche Setup-Meldung.
- Das Gerät bleibt nicht mehr auf `Waiting for frames` stehen.
- Die Nutzung erscheint automatisch auf dem Display.

## Wenn etwas nicht klappt

- `Waiting for frames` bedeutet meist: Der Mac hat noch keine Frames geschickt.
- Wenn das Gerät nicht erkannt wird, ziehe das USB-Kabel kurz ab und stecke es wieder ein.
- Wenn CodexBar fehlt oder nicht startet, führe den Installer einfach noch einmal aus.
- Wenn du ein USB-Hub benutzt, teste direkt am Mac.

## Wichtig

- Der Kunden-Flow ist für macOS gedacht.
- Du musst die Firmware im normalen Kunden-Setup nicht selbst flashen.
