# EN 18031 self-assessment (draft)

Status: **draft for the test lab**, issue #489. Scope: new VibeTV devices
(ESP8266 SmallTV Ultra) with the firmware of this change and the VibeTV Mac App
/ Companion. Devices already sold are out of scope.

Legal basis: RED 2014/53/EU Art. 3(3)(d) (network protection) and (e)
(personal data and privacy), made mandatory by Delegated Regulation (EU)
2022/30 from 1 August 2025. Harmonised standards: EN 18031-1:2024 (internet
connected radio equipment) and EN 18031-2:2024 (equipment processing personal
data), listed with restrictions by Implementing Decision (EU) 2025/138.
Art. 3(3)(f) (EN 18031-3, financial assets) does not apply: VibeTV handles no
payments.

## 1. Product and security principle

VibeTV is a small desk display. The Mac App reads AI-provider usage on the Mac
and sends ready-made frames, themes and display settings to VibeTV.

**Principle: everything critical runs only over the USB cable.** Pairing, WiFi
credentials, firmware updates and the factory reset have no network interface.
Over WiFi VibeTV accepts only display data (frames, themes, brightness and
screensaver settings), and only with the pairing token.

| Function | USB cable | WiFi |
| --- | --- | --- |
| Pairing (token issue) | yes | no (`404`) |
| Set / change WiFi credentials | yes | no (`404`) |
| Firmware update | yes | no (`404`) |
| Factory reset | yes | no |
| Frames, themes, display settings | yes | yes, token required |
| Read status (`/hello`, `/health`, `GET /assets`) | yes | yes, open, no secrets |

There is no setup access point, captive portal, cloud account, remote access
or telnet/debug service.

## 2. Assets

| Asset | Where | Protection |
| --- | --- | --- |
| WiFi SSID and password | ESP8266 flash (EEPROM record and SDK config) | Written only over USB; never sent back or logged; erased by factory reset. |
| Pairing token (128 bit) | Device LittleFS `/auth`; Mac config file (mode 0600) | Issued only over USB from the hardware RNG; never shown on the device page. |
| Firmware image | Device flash | Written only over USB, after token and device-ID check and a full MD5 check of the transfer. Release artifacts are checked against the manifest SHA-256 on the Mac. |
| Display data (usage percentages, provider names, themes) | Device RAM/flash | Token required for writes. Low sensitivity. |
| Device ID | Device | Public identifier, not a secret. |

Personal data (EN 18031-2): the WiFi password is the only secret of the user.
Usage values and provider names are shown on the screen by design. No name,
e-mail, location or account data is stored on the device.

## 3. Data flows

1. Mac App ⇄ VibeTV over USB serial: pairing, WiFi credentials, firmware,
   factory reset, frames, themes, settings.
2. Mac App → VibeTV over local WiFi (plain HTTP, port 80): frames, themes,
   settings, each with `X-VibeTV-Token`.
3. Mac App → GitHub Releases (HTTPS): firmware manifest and image, SHA-256
   checked before transfer.
4. Mac App local API: bound to `127.0.0.1` only.

VibeTV itself makes no internet connections apart from time sync (SNTP).

## 4. Threats and treatment

| Threat | Treatment | Residual risk |
| --- | --- | --- |
| Someone on the same WiFi takes over the device (pairing, new WiFi, firmware) | No network path for these functions. | None over the network. |
| Someone on the same WiFi installs malicious firmware | No WiFi update route; the USB transfer needs the token and matching device ID. | Needs physical access and the token. |
| Someone on the same WiFi sniffs the token (plain HTTP) and sends frames/themes | Token only authorises display data. | Accepted: wrong picture on the display; no data leak, no control of the device or the network. Fixed with "Erase VibeTV" plus a new pairing. |
| Guessing the token | 128 bit random token. | Negligible. |
| Denial of service on the local network (flooding port 80) | ESP8266 limits; device keeps its settings, recovers after a restart. | Accepted (local attacker only). |
| Theft / resale of a device with WiFi password | "Erase VibeTV" (USB) removes WiFi credentials, token, settings and themes. | Flash is not encrypted (ESP8266 has no flash encryption); physical attacker with a flasher can read credentials before an erase. Documented to the user. |
| Tampered release artifact | SHA-256 from the manifest (HTTPS) checked before transfer. | No on-device signature check (see section 7). |

## 5. Requirement-by-requirement assessment (EN 18031-1 / -2)

The mechanism names follow the standard. "N/A" gives the reason.

| Requirement | Assessment |
| --- | --- |
| ACM-1/2 Access control | Security and network assets are reachable only over the USB cable. Display writes over WiFi require the token. Open reads return no secrets. |
| AUM-1 Authentication mechanism | Network interface: 128 bit token (`X-VibeTV-Token`). USB interface: physical access is the authentication, plus the token for firmware transfer. **Lab question, see section 8.** |
| AUM-2 Appropriate mechanisms | Token from the hardware RNG, 128 bit, hex. Not user-chosen, so no weak or default password exists. |
| AUM-3 Factory default passwords | There is no default password. Each device creates its token on first USB pairing. |
| AUM-4 Changing authentication values | Factory reset over USB deletes the token; the next USB pairing creates a new one. |
| AUM-5 Password strength | N/A: no user password. The token has 128 bit entropy. |
| AUM-6 Brute-force protection | 128 bit token makes online guessing impractical; USB functions are not reachable over the network. |
| SUM-1/2/3 Secure update | Updates only over USB, only with token and matching device ID, full MD5 check before commit, SHA-256 check of the release on the Mac. Update check and install are started by the user in the Mac App. On-device signature check: see section 7. |
| SSM-1/2 Secure storage | Token and WiFi credentials are not readable over any interface. The Mac stores the token in a file with mode 0600. Flash encryption is not available on the ESP8266; physical-access risk accepted and documented. |
| SCM-1/2/3 Secure communication | USB: point-to-point, physical. WiFi: plain HTTP carries display data only; WiFi-level encryption (WPA2/WPA3) of the user's network protects against outsiders. No security or personal asset is sent over WiFi after setup. **Justification for the lab: confidentiality of display data is not required; integrity abuse is limited to the picture.** |
| RLM-1 Resilience | Device restarts and resumes with saved settings; WiFi loss leads to "Connect USB cable" and keeps retrying. |
| NMM-1 Network monitoring | N/A: VibeTV is not network equipment. |
| TCM-1 Traffic control | N/A: VibeTV is not network equipment. |
| CCK-1/2/3 Confidential keys | The only secret is the token: unique per device, random, never output over the network. |
| GEC-1 Up-to-date software / no known vulnerabilities | Release gate (see section 7: SBOM and vulnerability check per release). |
| GEC-2 Limit exposure of services | Only HTTP port 80 with the routes listed in `protocol/PROTOCOL.md`. No AP, no mDNS responder, no telnet, no remote update. |
| GEC-3 Input validation | Size limits and validation on frames, settings, theme assets (GIF/sprite validators), JSON parsing with fixed buffers. |
| GEC-4 Documented interfaces | `protocol/PROTOCOL.md`, `docs/hardware-contract.md`. |
| GEC-5 No unnecessary services | See GEC-2. |
| GEC-6 Physical interfaces | USB serial is the intended configuration interface (by design, not a debug back door). |
| GEC-7 Security of exposed interfaces | Open read routes expose no secrets (tested). |
| GEC-8 Robustness | See RLM-1 and GEC-3. |
| LGM-1..4 Logging (EN 18031-2) | Serial logs never contain the WiFi password. The token leaves the device only in the USB pairing reply to the Mac. No persistent log of personal data. |
| DLM-1 Deletion (EN 18031-2) | "Erase VibeTV" in the Mac App (USB) deletes WiFi credentials, token, settings and themes; "Run setup again" removes the pairing on the Mac. |
| UNM-1 User notification (EN 18031-2) | Settings and the erase dialog state what is stored and what erasing removes. |
| CRY-1 Best-practice cryptography | Token: hardware RNG. Release integrity: SHA-256. Transfer integrity: MD5 (error detection only, not a security control). |

## 6. Test cases

Automated (run in CI):

- Firmware source contains no `/update` route and exactly one `Update.begin`,
  inside the USB transfer, after the token check
  (`testFirmwareUpdatesOnlyOverCable`).
- Token is 16 bytes from `ESP.random`, no `randomSeed`/`random()`
  (`testPairingTokenUsesHardwareRandom`).
- Factory reset exists only as a USB request, checks the device ID and busy
  state first, erases EEPROM, SDK config and LittleFS, then restarts
  (`testFactoryResetIsCableOnlyAndErasesCustomerData`).
- Pairing, WiFi save/scan/reset over HTTP are absent (existing policy tests of
  #489).
- Mac side: a `404` on the WiFi update route is reported as "updates only over
  the USB cable" and not as a partial write; erasing refuses without the cable;
  erasing removes the token on the Mac.

Manual on hardware (open, to be run before release):

1. Fresh device: WiFi scan shows no `VibeTV-Setup` network.
2. From another computer on the same WiFi: `POST /api/pair`, `/save`,
   `/reset-wifi`, `/update/firmware`, `/update/filesystem`, `GET /update`
   → all `404`.
3. `POST /frame` without / with a wrong token → `401`.
4. Update over USB succeeds; update started with a WiFi target → clear
   "USB cable" message, device unchanged.
5. "Erase VibeTV" → device shows "Connect USB cable", `/hello` reports not
   paired, old token rejected, old WiFi not joined.
6. Serial log during WiFi setup contains no password; the token appears only
   in the pairing reply.

## 7. Open items and decisions

- **SBOM and vulnerability check:** generate per release from
  `firmware_esp8266/platformio.ini` (ESP8266 Arduino core and libraries)
  and `companion/go.mod`; check against known CVEs before release. Not yet
  automated.
- **Support period:** to be stated in the declaration of conformity and on the
  product page (proposal: security updates for at least 5 years from sale).
- **Vulnerability contact:** hello@vibetv.shop. Still to be published as the
  security contact on vibetv.shop.
- **RNG caveat:** the ESP8266 hardware RNG is documented as truly random while
  the radio is on. USB pairing can run with the radio off. The lab should
  confirm whether this is acceptable or whether pairing must mix in radio
  noise.
- **Signed firmware:** not implemented. The ESP8266 core supports signed
  updates, but only about 15 KB of the flash budget are left. Implement only
  if the lab requires it, because updates already need physical access.

## 8. Question for the test lab

Implementing Decision (EU) 2025/138 restricts EN 18031-1 where "the user may
choose not to set or use a password". VibeTV has no user password at all: the
**USB cable is the authorisation** for every security-relevant function, and
the network interface only carries display data behind a random 128 bit token.
Please confirm that this satisfies AUM-1/ACM for Art. 3(3)(d)/(e), or whether a
notified-body assessment is required instead of self-declaration.
