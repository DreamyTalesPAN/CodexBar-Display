#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>

#define PROGMEM
#define PSTR(value) (value)
#define F(value) (value)
using PGM_P = const char*;

inline size_t strlen_P(PGM_P value) {
  return std::strlen(value);
}

inline uint32_t pgm_read_dword(const uint32_t* value) {
  return *value;
}

class String : public std::string {
 public:
  using std::string::string;

  String() = default;
  String(const char* value) : std::string(value == nullptr ? "" : value) {}
  String(const std::string& value) : std::string(value) {}
  String(int value) : std::string(std::to_string(value)) {}
  String(unsigned int value) : std::string(std::to_string(value)) {}
  String(long value) : std::string(std::to_string(value)) {}
  String(unsigned long value) : std::string(std::to_string(value)) {}

  const char* c_str() const {
    return std::string::c_str();
  }

  void trim() {
    const auto first = find_if_not(begin(), end(), [](unsigned char c) { return std::isspace(c) != 0; });
    const auto last = find_if_not(rbegin(), rend(), [](unsigned char c) { return std::isspace(c) != 0; }).base();
    if (first >= last) {
      clear();
      return;
    }
    *this = substr(static_cast<size_t>(first - begin()), static_cast<size_t>(last - first));
  }
};

inline String operator+(const String& left, const String& right) {
  return String(static_cast<const std::string&>(left) + static_cast<const std::string&>(right));
}

inline String operator+(const String& left, const char* right) {
  return String(static_cast<const std::string&>(left) + (right == nullptr ? "" : right));
}

inline String operator+(const char* left, const String& right) {
  return String((left == nullptr ? "" : left) + static_cast<const std::string&>(right));
}
