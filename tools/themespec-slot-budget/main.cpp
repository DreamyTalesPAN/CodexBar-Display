// Reports the ESP8266 RAM footprint of a stored ThemeSpec while it is resident
// in the renderer cache. Runs on the host, but every size constant below is the
// value the xtensa-lx106 compiler reports for the firmware build, so the numbers
// describe the device, not the host.
//
// See docs/themespec-slot-budget.md for the measurement this backs (issue #277).

#include <cstdio>
#include <cstring>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include <ArduinoJson.h>

#include "theme_spec_renderer_core.h"

namespace {

// Sizes as reported by xtensa-lx106-elf-g++ for the esp8266_smalltv_st7789 build
// flags. Verified by tools/themespec-slot-budget/verify-target-sizes.sh.
constexpr size_t kEspCompiledPrimitiveBytes = 104;
constexpr size_t kEspVariantSlotBytes = 8;
constexpr size_t kEspPoolCapacitySlots = 128;   // ARDUINOJSON_POOL_CAPACITY
constexpr size_t kEspStringNodeOverheadBytes = 12;
// Arduino String rounds its heap buffer up to a 16 byte boundary.
constexpr size_t kEspStringBlockAlignment = 16;

size_t RoundUp(size_t value, size_t alignment) {
  return ((value + alignment - 1) / alignment) * alignment;
}

// Number of variant slots ArduinoJson allocates for a parsed document: one per
// object member and one per array element, plus one for the root.
size_t CountSlots(ArduinoJson::JsonVariantConst value) {
  size_t slots = 0;
  if (value.is<ArduinoJson::JsonObjectConst>()) {
    for (ArduinoJson::JsonPairConst pair : value.as<ArduinoJson::JsonObjectConst>()) {
      slots += 1 + CountSlots(pair.value());
    }
  } else if (value.is<ArduinoJson::JsonArrayConst>()) {
    for (ArduinoJson::JsonVariantConst element : value.as<ArduinoJson::JsonArrayConst>()) {
      slots += 1 + CountSlots(element);
    }
  }
  return slots;
}

// ArduinoJson 7 copies and deduplicates every key and string value when parsing
// from a const char*, so the document owns one StringNode per distinct string.
void CollectStrings(ArduinoJson::JsonVariantConst value, std::set<std::string>& out) {
  if (value.is<ArduinoJson::JsonObjectConst>()) {
    for (ArduinoJson::JsonPairConst pair : value.as<ArduinoJson::JsonObjectConst>()) {
      out.insert(pair.key().c_str());
      CollectStrings(pair.value(), out);
    }
  } else if (value.is<ArduinoJson::JsonArrayConst>()) {
    for (ArduinoJson::JsonVariantConst element : value.as<ArduinoJson::JsonArrayConst>()) {
      CollectStrings(element, out);
    }
  } else if (value.is<const char*>()) {
    out.insert(value.as<const char*>());
  }
}

size_t DocumentHeapBytes(ArduinoJson::JsonDocument& doc) {
  const size_t slots = 1 + CountSlots(doc.as<ArduinoJson::JsonVariantConst>());
  const size_t pools = (slots + kEspPoolCapacitySlots - 1) / kEspPoolCapacitySlots;
  size_t bytes = pools * kEspPoolCapacitySlots * kEspVariantSlotBytes;

  std::set<std::string> strings;
  CollectStrings(doc.as<ArduinoJson::JsonVariantConst>(), strings);
  for (const std::string& value : strings) {
    bytes += kEspStringNodeOverheadBytes + value.size() + 1;
  }
  return bytes;
}

// Keeps the report readable when the caller passes absolute paths.
std::string ShortPath(const std::string& path) {
  const size_t last = path.find_last_of('/');
  if (last == std::string::npos || last == 0) {
    return path;
  }
  const size_t parent = path.find_last_of('/', last - 1);
  return parent == std::string::npos ? path : path.substr(parent + 1);
}

bool ReadFile(const std::string& path, std::string& out) {
  std::ifstream file(path, std::ios::binary);
  if (!file) {
    return false;
  }
  std::ostringstream buffer;
  buffer << file.rdbuf();
  out = buffer.str();
  return true;
}

struct Report {
  std::string path;
  size_t rawBytes = 0;
  size_t primitiveCount = 0;
  size_t primitiveCapacity = 0;
  size_t stringPoolUsed = 0;
  size_t stringPoolCapacity = 0;
  bool keepsJsonDocument = false;
  bool hasAnimatedAssets = false;
  size_t documentBytes = 0;
  size_t residentBytes = 0;
};

bool Measure(const std::string& path, Report& report, std::string& error) {
  std::string raw;
  if (!ReadFile(path, raw)) {
    error = "cannot read file";
    return false;
  }

  report.path = path;
  report.rawBytes = raw.size();

  ArduinoJson::JsonDocument doc;
  codexbar_display::themespec::CompiledThemeSpec scene;
  if (!codexbar_display::themespec::CompileThemeSpec(raw.c_str(), doc, scene)) {
    error = "spec does not compile";
    return false;
  }

  report.primitiveCount = scene.primitiveCount;
  report.primitiveCapacity = scene.primitiveCapacity;
  report.stringPoolUsed = scene.stringPoolUsed;
  report.stringPoolCapacity = scene.stringPoolCapacity;
  report.keepsJsonDocument = scene.requiresJsonDocument;
  report.hasAnimatedAssets = scene.hasAnimatedAssets;
  report.documentBytes = scene.requiresJsonDocument ? DocumentHeapBytes(doc) : 0;

  // What the device keeps allocated for as long as the spec stays cached:
  //   runtimeState.cachedThemeSpecRaw (Arduino String on the heap)
  // + cachedThemeSpecScene.primitives (new CompiledPrimitive[capacity])
  // + cachedThemeSpecScene.stringPool (new char[capacity])
  // + cachedThemeSpecDoc, but only when a pixels primitive keeps it alive.
  report.residentBytes =
      RoundUp(report.rawBytes + 1, kEspStringBlockAlignment) +
      report.primitiveCapacity * kEspCompiledPrimitiveBytes +
      report.stringPoolCapacity +
      report.documentBytes;

  codexbar_display::themespec::ReleaseCompiledThemeSpec(scene);
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: themespec-slot-budget <theme.json> [theme.json ...]\n");
    return 2;
  }

  std::vector<Report> reports;
  int failures = 0;
  for (int i = 1; i < argc; ++i) {
    Report report;
    std::string error;
    if (!Measure(argv[i], report, error)) {
      std::fprintf(stderr, "%s: %s\n", argv[i], error.c_str());
      ++failures;
      continue;
    }
    reports.push_back(report);
  }

  std::printf("%-34s %7s %5s %7s %7s %5s %9s\n",
              "spec", "raw", "prims", "strpool", "jsondoc", "anim", "resident");
  for (const Report& report : reports) {
    std::printf("%-34s %7zu %5zu %7zu %7zu %5s %9zu\n",
                ShortPath(report.path).c_str(),
                report.rawBytes,
                report.primitiveCapacity,
                report.stringPoolCapacity,
                report.documentBytes,
                report.hasAnimatedAssets ? "yes" : "no",
                report.residentBytes);
  }
  std::printf("\nresident = raw String + primitives[%zu B each] + string pool + retained JsonDocument\n",
              kEspCompiledPrimitiveBytes);
  std::printf("sizes are xtensa-lx106 (ESP8266) sizes, not host sizes\n");
  return failures == 0 ? 0 : 1;
}
