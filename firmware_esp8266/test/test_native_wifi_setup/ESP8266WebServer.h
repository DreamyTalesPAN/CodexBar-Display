#pragma once

#include "Arduino.h"

#define CONTENT_LENGTH_UNKNOWN static_cast<size_t>(-1)

class ESP8266WebServer {
 public:
  void setContentLength(size_t) {}

  void send(int statusCode, const char*, const String& content) {
    status = statusCode;
    output += content;
  }

  void sendContent_P(PGM_P content) {
    output += content;
  }

  void sendContent(const String& content) {
    output += content;
  }

  int status = 0;
  String output;
};
