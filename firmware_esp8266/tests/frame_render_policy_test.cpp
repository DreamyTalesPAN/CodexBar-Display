#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>

#include "../src/frame_render_policy.h"

namespace {

using codexbar_display::esp8266::FrameRenderPolicy;

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

bool testTransportPolicy() {
  if (!expect(
          FrameRenderPolicy::ShouldDeferToMainLoop(true, true),
          "visual WiFi frames must be deferred to the main loop")) {
    return false;
  }
  if (!expect(
          !FrameRenderPolicy::ShouldDeferToMainLoop(true, false),
          "metadata-only WiFi frames must not create display work")) {
    return false;
  }
  if (!expect(
          !FrameRenderPolicy::ShouldDeferToMainLoop(false, true),
          "USB visual frames must keep their existing render path")) {
    return false;
  }
  return expect(
      !FrameRenderPolicy::ShouldDeferToMainLoop(false, false),
      "metadata-only USB frames must not create display work");
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

bool testWifiDispatchForcesDeferredRender(const std::string& source) {
  const std::size_t dispatchStart = source.find("void markFrameAccepted(");
  const std::size_t dispatchEnd = source.find("\nconst char* transportCapabilitiesJSON", dispatchStart);
  if (!expect(
          dispatchStart != std::string::npos && dispatchEnd != std::string::npos,
          "accepted-frame dispatcher must remain discoverable")) {
    return false;
  }

  const std::string dispatch = source.substr(dispatchStart, dispatchEnd - dispatchStart);
  const std::size_t policy = dispatch.find("FrameRenderPolicy::ShouldDeferToMainLoop");
  const std::size_t dirty = dispatch.find("runtimeCtx.screenDirty = true", policy);
  const std::size_t renderer = dispatch.find("renderer.OnFrameAccepted", policy);
  return expect(
      policy != std::string::npos && dirty != std::string::npos &&
          renderer != std::string::npos && dirty < renderer,
      "WiFi visual frames must mark the screen dirty before renderer dispatch");
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: %s <firmware-main.cpp>\n", argv[0]);
    return 2;
  }

  const std::string source = readFile(argv[1]);
  if (!testTransportPolicy() ||
      !testWifiHandlerAcknowledgesBeforeDispatch(source) ||
      !testWifiDispatchForcesDeferredRender(source)) {
    return 1;
  }

  std::puts("frame render policy tests passed");
  return 0;
}
