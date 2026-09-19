#pragma once

#include <cstring>

namespace codexbar_display {
namespace agentactivity {

inline bool IsWorking(const char* value) {
  if (value == nullptr) return false;
  return std::strcmp(value, "coding") == 0 ||
      std::strcmp(value, "working") == 0 ||
      std::strcmp(value, "thinking") == 0 ||
      std::strcmp(value, "tool_use") == 0 ||
      std::strcmp(value, "compacting") == 0;
}

inline bool HasLease(const char* value) {
  if (value == nullptr) return false;
  return (IsWorking(value) && std::strcmp(value, "coding") != 0) ||
      std::strcmp(value, "waiting_for_permission") == 0 ||
      std::strcmp(value, "waiting_for_answer") == 0 ||
      std::strcmp(value, "waiting_for_review") == 0 ||
      std::strcmp(value, "done") == 0 ||
      std::strcmp(value, "error") == 0 ||
      std::strcmp(value, "stale") == 0;
}

}  // namespace agentactivity
}  // namespace codexbar_display
