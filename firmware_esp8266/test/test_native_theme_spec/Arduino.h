#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <string>

class String : public std::string {
 public:
  using std::string::string;

  String() = default;
  String(const char* value) : std::string(value == nullptr ? "" : value) {}
  String(const std::string& value) : std::string(value) {}
  String(int value) : std::string(std::to_string(value)) {}
  String(long value) : std::string(std::to_string(value)) {}
  String(long long value) : std::string(std::to_string(value)) {}

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

  void toLowerCase() {
    std::transform(begin(), end(), begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  }

  int indexOf(const char* needle) const {
    const size_t pos = find(needle == nullptr ? "" : needle);
    if (pos == npos) {
      return -1;
    }
    return static_cast<int>(pos);
  }

  int indexOf(char needle, int from = 0) const {
    if (from < 0) {
      from = 0;
    }
    const size_t pos = find(needle, static_cast<size_t>(from));
    if (pos == npos) {
      return -1;
    }
    return static_cast<int>(pos);
  }

  String substring(int from) const {
    if (from < 0 || static_cast<size_t>(from) > size()) {
      return String();
    }
    return String(substr(static_cast<size_t>(from)));
  }

  String substring(int from, int to) const {
    if (from < 0 || to < from || static_cast<size_t>(from) > size()) {
      return String();
    }
    if (static_cast<size_t>(to) > size()) {
      to = static_cast<int>(size());
    }
    return String(substr(static_cast<size_t>(from), static_cast<size_t>(to - from)));
  }

  long toInt() const {
    return std::strtol(c_str(), nullptr, 10);
  }

  size_t write(uint8_t c) {
    push_back(static_cast<char>(c));
    return 1;
  }

  size_t write(const uint8_t* buffer, size_t size) {
    append(reinterpret_cast<const char*>(buffer), size);
    return size;
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
