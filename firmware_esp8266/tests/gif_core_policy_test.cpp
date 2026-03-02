#include <cstdint>
#include <cstdio>

#include "../src/gif_core_policy.h"

namespace {

using vibeblock::esp8266::GifCorePolicy;
using vibeblock::esp8266::GifFailureGuardState;

bool expect(bool cond, const char* message) {
  if (!cond) {
    std::fprintf(stderr, "FAIL: %s\n", message);
    return false;
  }
  return true;
}

bool testBackoffThresholdAndExpiry() {
  GifFailureGuardState guard;

  if (!expect(!GifCorePolicy::IsBlocked(guard, 0), "fresh guard must not be blocked")) {
    return false;
  }

  if (!expect(!GifCorePolicy::RecordFailure(guard, 100), "first failure must not enter backoff")) {
    return false;
  }
  if (!expect(guard.consecutiveFailures == 1, "first failure increments counter")) {
    return false;
  }

  if (!expect(!GifCorePolicy::RecordFailure(guard, 200), "second failure must not enter backoff")) {
    return false;
  }
  if (!expect(guard.consecutiveFailures == 2, "second failure increments counter")) {
    return false;
  }

  if (!expect(GifCorePolicy::RecordFailure(guard, 300), "third failure must enter backoff")) {
    return false;
  }
  if (!expect(guard.consecutiveFailures == 0, "counter resets after entering backoff")) {
    return false;
  }
  if (!expect(
          guard.backoffUntilMs == 300 + GifCorePolicy::kFailureBackoffMs,
          "backoff deadline must be now + fixed backoff")) {
    return false;
  }

  if (!expect(GifCorePolicy::IsBlocked(guard, 301), "guard should remain blocked before deadline")) {
    return false;
  }
  if (!expect(
          !GifCorePolicy::IsBlocked(guard, 300 + GifCorePolicy::kFailureBackoffMs),
          "guard should unblock at deadline")) {
    return false;
  }
  if (!expect(guard.backoffUntilMs == 0, "deadline must clear after unblock")) {
    return false;
  }

  return true;
}

bool testBackoffResetOnSuccess() {
  GifFailureGuardState guard;
  guard.consecutiveFailures = 2;
  guard.backoffUntilMs = 12345;

  GifCorePolicy::RecordSuccess(guard);

  if (!expect(guard.consecutiveFailures == 0, "success clears consecutive failure count")) {
    return false;
  }
  if (!expect(guard.backoffUntilMs == 0, "success clears backoff deadline")) {
    return false;
  }

  return true;
}

bool testRequestSwitching() {
  if (!expect(
          !GifCorePolicy::RequestChanged("/mini.gif", 0, 0, "/mini.gif", 0, 0),
          "identical request should not switch")) {
    return false;
  }

  if (!expect(
          GifCorePolicy::RequestChanged("/mini.gif", 0, 0, "/other.gif", 0, 0),
          "asset path change should switch")) {
    return false;
  }

  if (!expect(
          GifCorePolicy::RequestChanged("/mini.gif", 0, 0, "/mini.gif", 1, 0),
          "layout change should switch")) {
    return false;
  }

  if (!expect(
          GifCorePolicy::RequestChanged("/mini.gif", 0, 0, "/mini.gif", 0, 1),
          "failure slot change should switch")) {
    return false;
  }

  if (!expect(
          !GifCorePolicy::RequestChanged(nullptr, 0, 0, "", 0, 0),
          "null and empty path should be treated as equal")) {
    return false;
  }

  return true;
}

}  // namespace

int main() {
  if (!testBackoffThresholdAndExpiry()) {
    return 1;
  }
  if (!testBackoffResetOnSuccess()) {
    return 1;
  }
  if (!testRequestSwitching()) {
    return 1;
  }

  std::printf("ok: gif_core_policy_test\n");
  return 0;
}
