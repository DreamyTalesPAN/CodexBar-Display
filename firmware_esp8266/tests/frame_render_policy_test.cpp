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

bool testWifiDispatchStoresOnePendingEvent(const std::string& source) {
  const std::size_t dispatchStart = source.find("void markFrameAccepted(");
  const std::size_t dispatchEnd = source.find("\nconst char* transportCapabilitiesJSON", dispatchStart);
  if (!expect(
          dispatchStart != std::string::npos && dispatchEnd != std::string::npos,
          "accepted-frame dispatcher must remain discoverable")) {
    return false;
  }

  const std::string dispatch = source.substr(dispatchStart, dispatchEnd - dispatchStart);
  const std::size_t wifiCheck = dispatch.find("if (wifiTransport && event.visualChanged)");
  const std::size_t store = dispatch.find("pendingWifiRenderEvent = event", wifiCheck);
  const std::size_t pending = dispatch.find("pendingWifiRender = true", store);
  const std::size_t directRender = dispatch.find("renderAcceptedFrame(event)", pending);
  return expect(
      wifiCheck != std::string::npos && store != std::string::npos && pending != std::string::npos &&
          directRender != std::string::npos && wifiCheck < store && store < pending && pending < directRender,
      "WiFi visual frames must store one pending event while non-WiFi frames render directly");
}

bool testPendingWifiRenderRunsBeforeUsb(const std::string& source) {
  const std::size_t loopStart = source.find("void loop()");
  const std::size_t pending = source.find("if (pendingWifiRender)", loopStart);
  const std::size_t render = source.find("renderAcceptedFrame(event)", pending);
  const std::size_t usb = source.find("ConsumeSerial(runtimeCtx, millis(), event)", render);
  return expect(
      loopStart != std::string::npos && pending != std::string::npos && render != std::string::npos &&
          usb != std::string::npos && pending < render && render < usb,
      "the pending WiFi event must render before USB can replace the current frame");
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: %s <firmware-main.cpp>\n", argv[0]);
    return 2;
  }

  const std::string source = readFile(argv[1]);
  if (!testWifiHandlerAcknowledgesBeforeDispatch(source) ||
      !testWifiDispatchStoresOnePendingEvent(source) ||
      !testPendingWifiRenderRunsBeforeUsb(source)) {
    return 1;
  }

  std::puts("frame render policy tests passed");
  return 0;
}
