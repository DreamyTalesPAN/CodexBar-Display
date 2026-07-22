#include "wifi_setup_portal.h"

#include <ESP8266WiFi.h>
#include <cstring>

namespace codexbar_display {
namespace esp8266 {
namespace wifi_setup {

const char kSupportUrl[] = "https://vibetv.shop/pages/setup";

namespace {

const char kPageStart[] PROGMEM = R"HTML(<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>VibeTV Wi-Fi Setup</title><style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d0e10;color:#f7f7f2}*{box-sizing:border-box}body{margin:0;background:#0d0e10;color:#f7f7f2}main{width:min(100%,480px);margin:0 auto;padding:calc(24px + env(safe-area-inset-top)) 20px calc(28px + env(safe-area-inset-bottom))}h1{margin:0;font-size:clamp(2rem,9vw,2.7rem);line-height:1.02;letter-spacing:-.04em}.card{margin-top:22px;padding:18px;border:1px solid #303238;border-radius:16px;background:#17191c;box-shadow:0 18px 45px rgba(0,0,0,.24)}.notice{margin:0 0 16px;padding:13px 14px;border-radius:12px;background:#29220f;color:#fff1b5;line-height:1.45}.notice strong{color:#fff}label{display:block;margin:16px 0 7px;font-size:.9rem;font-weight:750}.field-help{margin:-2px 0 7px;color:#9d9fa4;font-size:.82rem;line-height:1.35}select,input,button{width:100%;min-height:48px;border-radius:11px;font:inherit}select,input{border:1px solid #464950;background:#0f1012;color:#fff;padding:12px}select:focus,input:focus,button:focus-visible,a:focus-visible{outline:3px solid rgba(199,255,0,.35);outline-offset:2px}.actions{display:grid;gap:11px;margin-top:18px}.scan-form{margin-top:11px}button{border:0;padding:12px 16px;font-weight:800;cursor:pointer}.primary{background:#c7ff00;color:#111}.secondary{border:1px solid #4d5057;background:#222429;color:#fff}.secondary[disabled]{cursor:wait;opacity:.7}.empty{margin:0 0 14px;color:#c8c9c4;line-height:1.45}.help{display:block;margin-top:17px;color:#c7ff00;font-weight:750;text-align:center;text-underline-offset:3px}.foot{margin:22px 0 0;color:#85878c;font-size:.82rem;text-align:center}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(min-width:600px){main{padding-top:48px}.card{padding:22px}}
</style></head><body><main><header><h1>Connect to Wi-Fi</h1></header><section class="card" aria-labelledby="wifi-heading"><h2 id="wifi-heading" class="sr-only">Wi-Fi network</h2>)HTML";

const char kScanForm[] PROGMEM = R"HTML(<form class="scan-form" method="post" action="/scan" onsubmit="const b=this.querySelector('button');if(b.disabled)return false;b.disabled=true;b.textContent='Searching…';b.setAttribute('aria-busy','true')"><button class="secondary" type="submit">Search again</button></form>)HTML";

const char kFieldsStart[] PROGMEM = R"HTML(<form method="post" action="/save"><label for="ssid">Wi-Fi network</label><p id="wifi-band-help" class="field-help">Only 2.4 GHz networks are shown.</p><select id="ssid" name="ssid" aria-describedby="setup-status wifi-band-help">)HTML";
const char kFieldsManual[] PROGMEM = R"HTML(</select><label for="custom_ssid">Hidden network</label><input id="custom_ssid" name="custom_ssid" maxlength="32" autocomplete="off" placeholder="Enter Wi-Fi name" aria-describedby="setup-status")HTML";
const char kFieldsPassword[] PROGMEM = R"HTML(><label for="password">Password</label><input id="password" name="password" type="password" maxlength="64" autocomplete="current-password" aria-describedby="setup-status"><div class="actions"><button class="primary" type="submit">Connect</button></div></form>)HTML";
const char kPageEnd[] PROGMEM = R"HTML(</section><p class="foot">Setup address: http://)HTML";
const char kDocumentEnd[] PROGMEM = R"HTML(</p></main></body></html>)HTML";

void copySsid(char* target, const String& ssid) {
  const size_t length = ssid.length() < (kMaxSsidBytes - 1) ? ssid.length() : (kMaxSsidBytes - 1);
  memcpy(target, ssid.c_str(), length);
  target[length] = '\0';
}

int compareNetworks(const Network& left, const Network& right) {
  if (left.rssi != right.rssi) {
    return left.rssi > right.rssi ? -1 : 1;
  }
  return strcmp(left.ssid, right.ssid);
}

void sortNetworks(State& state) {
  for (uint8_t i = 1; i < state.networkCount; ++i) {
    Network current = state.networks[i];
    int j = static_cast<int>(i) - 1;
    while (j >= 0 && compareNetworks(current, state.networks[j]) < 0) {
      state.networks[j + 1] = state.networks[j];
      --j;
    }
    state.networks[j + 1] = current;
  }
}

void sendDynamic(ESP8266WebServer& server, const String& content) {
  if (content.length() > 0) {
    server.sendContent(content);
  }
}

String connectionErrorHTML(const State& state) {
  if (state.connectionError == ConnectionError::None) {
    return String();
  }

  String html;
  html.reserve(260);
  html += F("<p class=\"notice\" role=\"alert\">");
  switch (state.connectionError) {
    case ConnectionError::MissingSsid:
      html += F("Choose a network or enter its name.");
      break;
    case ConnectionError::InvalidCredentials:
      html += F("The Wi-Fi name or password is too long.");
      break;
    case ConnectionError::None:
      break;
  }
  html += F("</p>");
  return html;
}

String scanStatusHTML(const State& state) {
  if (state.scanStatus == ScanStatus::Empty) {
    return F("<p class=\"empty\" role=\"status\">No networks found. Search again or enter the Wi-Fi name manually.</p>");
  }
  if (state.scanStatus == ScanStatus::Failed) {
    return F("<p class=\"empty\" role=\"alert\">The scan failed. Try again or enter the Wi-Fi name manually.</p>");
  }
  return String();
}

}  // namespace

bool BeginScan(State& state) {
  if (state.scanInProgress) {
    return false;
  }
  state.scanInProgress = true;
  state.scanStatus = ScanStatus::Scanning;
  state.networkCount = 0;
  return true;
}

bool AddScanResult(State& state, const String& ssid, int32_t rssi, int32_t channel) {
  if (!state.scanInProgress || ssid.length() == 0 || ssid.length() >= kMaxSsidBytes || channel < 1 || channel > 14) {
    return false;
  }

  for (uint8_t i = 0; i < state.networkCount; ++i) {
    if (ssid == state.networks[i].ssid) {
      if (rssi > state.networks[i].rssi) {
        state.networks[i].rssi = static_cast<int16_t>(rssi);
        sortNetworks(state);
      }
      return true;
    }
  }

  if (state.networkCount < kMaxNetworks) {
    Network& network = state.networks[state.networkCount++];
    copySsid(network.ssid, ssid);
    network.rssi = static_cast<int16_t>(rssi);
    sortNetworks(state);
    return true;
  }

  Network candidate;
  copySsid(candidate.ssid, ssid);
  candidate.rssi = static_cast<int16_t>(rssi);
  if (compareNetworks(candidate, state.networks[state.networkCount - 1]) >= 0) {
    return false;
  }
  state.networks[state.networkCount - 1] = candidate;
  sortNetworks(state);
  return true;
}

void FinishScan(State& state, int rawNetworkCount) {
  state.scanInProgress = false;
  if (rawNetworkCount < 0) {
    state.scanStatus = ScanStatus::Failed;
  } else if (state.networkCount == 0) {
    state.scanStatus = ScanStatus::Empty;
  } else {
    state.scanStatus = ScanStatus::Ready;
  }
}

const char* SignalLabel(int32_t rssi) {
  if (rssi >= -60) {
    return "🟢";
  }
  if (rssi >= -75) {
    return "🟡";
  }
  return "🔴";
}

void SetConnectionError(State& state, ConnectionError error) {
  state.connectionError = error;
}

void ClearConnectionError(State& state) {
  state.connectionError = ConnectionError::None;
}

String HtmlEscape(const String& raw) {
  String escaped;
  escaped.reserve(raw.length() + 12);
  for (size_t i = 0; i < raw.length(); ++i) {
    switch (raw[i]) {
      case '&': escaped += F("&amp;"); break;
      case '<': escaped += F("&lt;"); break;
      case '>': escaped += F("&gt;"); break;
      case '"': escaped += F("&quot;"); break;
      case '\'': escaped += F("&#39;"); break;
      default: escaped += raw[i]; break;
    }
  }
  return escaped;
}

String BuildNetworkOptionsHTML(const State& state) {
  String options;
  options.reserve(kMaxOptionsHtmlBytes);
  for (uint8_t i = 0; i < state.networkCount; ++i) {
    const String escapedSsid = HtmlEscape(String(state.networks[i].ssid));
    String option;
    option.reserve(escapedSsid.length() * 2 + 72);
    option += F("<option value=\"");
    option += escapedSsid;
    option += '"';
    option += '>';
    option += escapedSsid;
    option += F(" — ");
    option += SignalLabel(state.networks[i].rssi);
    option += F("</option>");
    if (options.length() + option.length() > kMaxOptionsHtmlBytes) {
      break;
    }
    options += option;
  }
  if (options.length() == 0) {
    options = F("<option value=\"\">No networks available</option>");
  }
  return options;
}

void SendSetupPage(
    ESP8266WebServer& server,
    const State& state,
    const char* supportUrl,
    const char* setupAddress,
    int statusCode) {
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(statusCode, "text/html; charset=utf-8", "");
  server.sendContent_P(kPageStart);
  server.sendContent_P(PSTR("<div id=\"setup-status\" aria-live=\"polite\">"));
  sendDynamic(server, connectionErrorHTML(state));
  sendDynamic(server, scanStatusHTML(state));
  server.sendContent_P(PSTR("</div>"));
  server.sendContent_P(kFieldsStart);
  sendDynamic(server, BuildNetworkOptionsHTML(state));
  server.sendContent_P(kFieldsManual);
  server.sendContent_P(kFieldsPassword);
  server.sendContent_P(kScanForm);

  if (supportUrl != nullptr && supportUrl[0] != '\0') {
    String help;
    help.reserve(strlen(supportUrl) + 160);
    help += F("<a class=\"help\" href=\"");
    help += HtmlEscape(String(supportUrl));
    help += F("\" target=\"_blank\" rel=\"noopener noreferrer\">Troubleshooting: vibetv.shop/pages/setup</a>");
    sendDynamic(server, help);
  }

  server.sendContent_P(kPageEnd);
  sendDynamic(server, HtmlEscape(String(setupAddress == nullptr ? "" : setupAddress)));
  server.sendContent_P(kDocumentEnd);
  server.sendContent(String());
}

}  // namespace wifi_setup
}  // namespace esp8266
}  // namespace codexbar_display
