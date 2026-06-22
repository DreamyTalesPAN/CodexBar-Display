# Control Center Command Console Feature Backlog

Status: QA/Feature-Tracking für PR #120 (`codex/control-center-117`).
Diese Datei dokumentiert offene Lücken. Sie erstellt keine GitHub Issues und gibt keine Freigabe für Merge, Release oder Hardware-Schreibtests.

## Kurzfazit

PR #120 kann die Command Console als echte UI-Schicht bauen: Overview, Settings, Theme Library sowie klare Platzhalter für Updates und Logs. Die bestehende Companion API reicht für Verbindungsstatus, Device-Fakten, Pairing, Helligkeit, Theme-Katalog und sicher gesperrte Theme-Installation.

Nicht real in #120 ohne neue API-Arbeit: echte Update-Verfügbarkeit, persistente Event-Historie, vollständige aktive Theme-Metadaten und dauerhaft kundenfähige Install-Freigabe für die gehostete App.

## Bestehende API-Felder, die für Overview reichen

Quelle: `companion/internal/companionapi/server.go`.

- `GET /v1/status`
  - `companion.status`: Companion läuft und ist grundsätzlich bereit.
  - `companion.version`: Companion-Version für Bridge/Firmware-nahe Supportanzeige.
  - `companion.features.themeInstallEnabled`: Install-Lock/Write-Access in der UI.
  - `device.target`: gespeichertes Ziel, ohne Pairing-Token.
  - `device.connected`: bei Status bewusst `false`, weil dieser Endpoint das Gerät nicht probe-abfragt.
  - `device.paired`: gespeicherter Pairing-Token vorhanden.
- `GET /v1/device` und `POST /v1/device/discover`
  - `device.connected`: belastbarer Device-Online-Status nach `/hello`.
  - `device.paired`: Pairing-Zustand.
  - `device.target`: Ziel-URL ohne Token.
  - `device.board`: Hardware-Board.
  - `device.firmware`: Firmware-Version.
  - `device.capabilities.display.brightness`: Helligkeitsfähigkeit und erlaubter Bereich.
  - `device.capabilities.theme.supportsThemeSpecV1`: ThemeSpec-Readiness.
  - `device.capabilities.theme.cachedThemeId` und `cachedThemeRev`: grober aktiver/zwischengespeicherter ThemeSpec-Hinweis, aber keine vollen Theme-Metadaten.
  - `device.capabilities.transport.active` und `supported`: aktiver Transport und verfügbare Kanäle.
- `GET /v1/settings`
  - `settings.display.brightnessPercent`: aktueller Helligkeitswert.
  - `device`: Device-Fakten aus `/hello` werden erneut mitgeliefert.

Wichtig für die UI: `GET /v1/status` ist gut für "Bridge lebt", aber nicht ausreichend für "Device ist live". Für echte Device-Frische muss die UI danach `GET /v1/device` oder `POST /v1/device/discover` nutzen.

## Feature-Entscheidung für PR #120

| Feature | In PR #120 real implementierbar? | Neue Issue nötig? | Begründung |
| --- | --- | --- | --- |
| Overview | Ja | Nein | Bestehende Status-, Device- und Settings-Felder reichen für Bridge, Device, Firmware, Pairing, ThemeSpec-Readiness, Transport, Helligkeit und Install-Lock. |
| Settings | Ja | Nein | `POST /v1/device/discover`, `POST /v1/device/pair`, `GET/POST /v1/settings` decken die geforderten Controls ab. |
| Theme Library | Ja | Nein | Theme-Katalog ist im Control Center vorhanden; Install geht über `POST /v1/themes/install`, sobald die Mac-App als Kunden-PKG mit Theme-Install-Flag läuft und VibeTV verbunden/gepairt ist. |
| Updates | Nur Platzhalter | Ja | Daemon kennt `UpdateState`, aber Companion API veröffentlicht keinen `/v1/updates`-Endpoint und kein Update-Feld in `/v1/status` oder `/v1/device`. In #120 nur aktuelle Firmware anzeigen. |
| Logs | Nur lokale Session-Events | Ja | Es gibt keinen persistenten Companion-Event- oder Log-Endpoint. In #120 kann die UI nur eigene Browser-Events wie "Bridge geprüft" oder "Device gelesen" anzeigen. |
| Active theme metadata | Teilweise | Wahrscheinlich ja | `/hello` kann `cachedThemeId`/`cachedThemeRev` in `capabilities.theme` liefern. Das reicht für einen technischen Hinweis, aber nicht für Titel, Quelle, Preview, Install-Zeit, Renderstatus oder Abgleich mit dem Shopify-Katalog. |
| Install enablement | Ja | Nein | Die API meldet `themeInstallEnabled` und blockt ohne `VIBETV_ENABLE_WIFI_THEME_INSTALL=1`. Kunden-PKGs setzen den Flag im LaunchAgent; lokale Dev-/Support-Runs bleiben ohne Flag gesperrt. |

## Offene Feature-Lücken

### 1. Updates

Aktueller Stand:

- Companion Daemon kann intern `protocol.UpdateState` berechnen und in Frames ans Device hängen.
- Companion API bietet aktuell nur Companion-Version und Device-Firmware.
- Control Center kann deshalb nicht sauber sagen, ob eine neue Firmware verfügbar ist.

PR #120:

- Updates-Tab als Platzhalter bauen.
- Aktuelle bekannte Firmware aus `device.firmware` anzeigen.
- Keine Update-Aktion und keine "current/latest"-Behauptung ohne API-Daten.

Neues Issue:

- API für Update-Status, z. B. `GET /v1/updates`.
- Felder: current firmware, latest firmware, board, channel, status, severity, last error, recommended action.
- Später separater kundenfähiger Update-Flow.

### 2. Logs und Event-History

Aktueller Stand:

- Es gibt Daemon-Logs und interne Runtime-Logs, aber keinen Companion API Endpoint für persistente UI-Events.
- Die Command Console Spec erlaubt lokale Session-Events als MVP.

PR #120:

- `LastEvents`/Logs nur aus Browser-State ableiten.
- Beispiele: Bridge geprüft, Device gelesen, Settings geladen, Install gesperrt, Install gestartet/fehlgeschlagen.
- Events klar als Session-Verlauf markieren.

Neues Issue:

- Persistenter Companion Event Store.
- API z. B. `GET /v1/events?limit=...`.
- Event-Modell mit `timestamp`, `type`, `severity`, `source`, `message`, optional `target`, optional `correlationId`.
- Keine sensiblen Tokens oder URLs mit Token in Events speichern.

### 3. Active Theme Metadata

Aktueller Stand:

- `protocol.ThemeCapabilities` enthält `cachedThemeId` und `cachedThemeRev`.
- Device-/Firmware-Dokumente nennen zusätzlich `/health.display.activeTheme` und ThemeSpec-Renderdiagnostik.
- Companion API liest für `/v1/settings` zwar `/health`, gibt aber nur `settings.display.brightnessPercent` weiter.

PR #120:

- Wenn TypeScript-Typen und UI angepasst werden, kann die Overview `cachedThemeId`/`cachedThemeRev` als technischen Theme-Hinweis anzeigen.
- Falls diese Felder leer sind, neutral bleiben: "nicht gemeldet" statt "kein Theme".
- Keine vollen Theme-Details erfinden.

Neues Issue:

- Companion API soll aktive Theme-Metadaten sauber modellieren.
- Mögliche Felder: `activeTheme.id`, `activeTheme.rev`, `activeTheme.source`, `activeTheme.title`, `activeTheme.renderOk`, `activeTheme.lastActivatedAt`.
- Optional Health-Forwarding aus `/health.display.activeTheme` und `/health.display.themeSpec`.

### 4. Install Enablement

Aktueller Stand:

- `GET /v1/status` liefert `companion.features.themeInstallEnabled`.
- `POST /v1/themes/install` blockt ohne `VIBETV_ENABLE_WIFI_THEME_INSTALL=1`.
- Control Center sendet bereits `skipFirmwareUpdate: true`.

PR #120:

- Install-Button nur aktivieren, wenn alle Bedingungen stimmen: kostenlos/installierbar, Companion online, Device verbunden, Feature-Flag aktiv.
- Sperrgrund direkt anzeigen.
- Weiterhin `skipFirmwareUpdate: true` senden.
- Keine automatische Aktivierung von Hardware-Schreibtests.

Neues Issue:

- Kundenfähiger Install-Enablement-Flow für Hosted App.
- Explizites Sicherheitsmodell für Pairing, Token-Schutz, Schreibfenster, Recovery und Wiederholung nach Fehlern.

## Brand-Farbregel: aktueller Stand

Geprüft nach der Umsetzung per:

```bash
rg -n "#[0-9A-Fa-f]{3,8}|rgb\\(|rgba\\(|hsl\\(|hsla\\(|blue|red|orange|purple|amber|rose|emerald|slate|gray|zinc|neutral|stone|cyan|sky|indigo|violet|pink|yellow|green|lime|teal" apps/control-center/src -S
```

Erlaubte Palette laut Spec:

- `#CCFF00`
- `#ABD600`
- `#506600`
- `#1B1B1B`
- `#444933`
- `#F9F9F9`
- `#EEEEEE`
- `#747A60`
- `#EDEDED`

Aktueller PR-Stand:

- Direkte Hex-Werte in `apps/control-center/src` sind auf die erlaubte Palette begrenzt.
- Die frühere Alt-UI in `components/control-center-app.tsx` mit Nicht-Brand-Hexwerten wurde durch Shell- und Screen-Komponenten ersetzt.
- `bg-white`, `text-white` und `accent-[#2f7d46]` wurden aus dem Control-Center-UI-Code entfernt.
- Status wird über Label, Icon, Hierarchie und Position erklärt, nicht über neue Statusfarben.

Rest-Risiko:

- Neu hinzukommende Komponenten müssen weiter gegen diese Palette geprüft werden.
- Theme-Preview-Bilder aus Shopify/GitHub dürfen eigene Bildfarben enthalten; die UI-Chrome-Farbregel gilt für Control-Center-Layout, Text, Borders und Controls.

## Nicht in Scope für diesen Subagent

- Keine Änderungen in `apps/control-center/src/**`.
- Keine Änderungen in `companion/**`.
- Keine GitHub Issues, kein Merge, kein Tag, kein Release.
- Keine Hardware-Schreibtests.
