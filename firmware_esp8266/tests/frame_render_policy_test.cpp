#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>

namespace {

bool expect(bool condition, const char* message) {
  if (!condition) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    return false;
  }
  return true;
}

std::string readFile(const char* path) {
  std::ifstream input(path);
  return std::string(
      std::istreambuf_iterator<char>(input),
      std::istreambuf_iterator<char>());
}

bool testWifiHandlerAcknowledgesBeforeDispatch(const std::string& source) {
  const std::size_t handlerStart = source.find("void handleFrame()");
  const std::size_t handlerEnd = source.find("\nvoid startHttpServer()", handlerStart);
  if (!expect(
          handlerStart != std::string::npos && handlerEnd != std::string::npos,
          "WiFi frame handler must remain discoverable")) {
    return false;
  }

  const std::string handler = source.substr(handlerStart, handlerEnd - handlerStart);
  const std::size_t ack = handler.find("webServer.send(200");
  const std::size_t dispatch = handler.find("markFrameAccepted(event, \"wifi\")");
  return expect(
      ack != std::string::npos && dispatch != std::string::npos && ack < dispatch,
      "WiFi frame handler must ACK before dispatching accepted frame work");
}

bool testHttpCallbackDispatchStoresOnePendingEvent(const std::string& source) {
  const std::size_t dispatchStart = source.find("void markFrameAccepted(");
  const std::size_t dispatchEnd = source.find("\nconst char* transportCapabilitiesJSON", dispatchStart);
  if (!expect(
          dispatchStart != std::string::npos && dispatchEnd != std::string::npos,
          "accepted-frame dispatcher must remain discoverable")) {
    return false;
  }

  const std::string dispatch = source.substr(dispatchStart, dispatchEnd - dispatchStart);
  const std::size_t deferCheck = dispatch.find("if (deferRender && event.visualChanged)");
  const std::size_t store = dispatch.find("pendingHttpRenderEvent = event", deferCheck);
  const std::size_t pending = dispatch.find("pendingHttpRender = true", store);
  const std::size_t directRender = dispatch.find("renderAcceptedFrame(event)", pending);
  return expect(
      deferCheck != std::string::npos && store != std::string::npos && pending != std::string::npos &&
          directRender != std::string::npos && deferCheck < store && store < pending && pending < directRender,
      "HTTP callback visual frames must store one pending event while USB frames render directly");
}

bool testThemeActivationUsesDeferredRenderTransport(const std::string& source) {
  const std::size_t policyStart = source.find("bool acceptedFrameRenderDeferredForTransport(");
  const std::size_t policyEnd = source.find("\nvoid markFrameAccepted(", policyStart);
  const std::size_t activateStart = source.find("void activateStoredThemeSpec(");
  const std::size_t activateEnd = source.find("\nbool activateStoredThemePath(", activateStart);
  if (!expect(
          policyStart != std::string::npos && policyEnd != std::string::npos &&
              activateStart != std::string::npos && activateEnd != std::string::npos,
          "theme activation render policy must remain discoverable")) {
    return false;
  }

  const std::string policy = source.substr(policyStart, policyEnd - policyStart);
  const std::string activate = source.substr(activateStart, activateEnd - activateStart);
  const std::size_t wifi = policy.find("strcmp(transport, \"wifi\") == 0");
  const std::size_t theme = policy.find("strcmp(transport, \"theme\") == 0");
  const std::size_t dispatch = activate.find("markFrameAccepted(event, \"theme\")");
  const std::size_t directRender = activate.find("renderAcceptedFrame(event)");
  return expect(
      wifi != std::string::npos && theme != std::string::npos &&
          dispatch != std::string::npos && directRender == std::string::npos,
      "theme activation must queue HTTP render work instead of rendering inside /theme/active");
}

bool testThemeActivationDoesNotCloseFilesystemBeforeResponse(const std::string& source) {
  const std::size_t activateStart = source.find("void activateStoredThemeSpec(");
  const std::size_t activateEnd = source.find("\nbool activateStoredThemePath(", activateStart);
  if (!expect(
          activateStart != std::string::npos && activateEnd != std::string::npos,
          "theme activation body must remain discoverable")) {
    return false;
  }

  const std::string activate = source.substr(activateStart, activateEnd - activateStart);
  return expect(
      activate.find("close_all_fs()") == std::string::npos &&
          activate.find("LittleFS.end()") == std::string::npos,
      "theme activation must not unmount LittleFS before the HTTP response");
}

bool testPendingHttpRenderRunsBeforeUsb(const std::string& source) {
  const std::size_t loopStart = source.find("void loop()");
  const std::size_t pending = source.find("if (pendingHttpRender)", loopStart);
  const std::size_t render = source.find("renderAcceptedFrame(event)", pending);
  const std::size_t usb = source.find("ConsumeSerial(runtimeCtx, millis(), event)", render);
  return expect(
      loopStart != std::string::npos && pending != std::string::npos && render != std::string::npos &&
          usb != std::string::npos && pending < render && render < usb,
      "the pending HTTP event must render before USB can replace the current frame");
}

bool testHelloAdvertisesEscapedUsageWindowCapacity(const std::string& source) {
  const std::size_t capabilitiesStart = source.find("String themeCapabilitiesJSON(");
  const std::size_t capabilitiesEnd = source.find("\nstruct WifiCredentials", capabilitiesStart);
  if (!expect(
          capabilitiesStart != std::string::npos && capabilitiesEnd != std::string::npos,
          "theme capabilities builder must remain discoverable")) {
    return false;
  }

  const std::string capabilities = source.substr(capabilitiesStart, capabilitiesEnd - capabilitiesStart);
  return expect(
      capabilities.find("String(codexbar_display::core::kAdvertisedMaxUsageWindows)") != std::string::npos,
      "hello must advertise escaped JSON-safe usage window capacity");
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: %s <firmware-main.cpp>\n", argv[0]);
    return 2;
  }

  const std::string source = readFile(argv[1]);
  if (!testWifiHandlerAcknowledgesBeforeDispatch(source) ||
      !testHttpCallbackDispatchStoresOnePendingEvent(source) ||
      !testThemeActivationUsesDeferredRenderTransport(source) ||
      !testThemeActivationDoesNotCloseFilesystemBeforeResponse(source) ||
      !testPendingHttpRenderRunsBeforeUsb(source) ||
      !testHelloAdvertisesEscapedUsageWindowCapacity(source)) {
    return 1;
  }

  std::puts("frame render policy tests passed");
  return 0;
}
