#include "../../../firmware_shared/theme_spec_renderer_core.h"
#include "../../../firmware_shared/codexbar_display_core.h"

#include <string>
#include <vector>

#include <unity.h>

namespace {

using codexbar_display::themespec::FrameData;
using codexbar_display::themespec::GifCommand;
using codexbar_display::themespec::ProgressCommand;
using codexbar_display::themespec::RectCommand;
using codexbar_display::themespec::RenderThemeSpecAnimatedPrimitives;
using codexbar_display::themespec::RenderThemeSpec;
using codexbar_display::themespec::Sink;
using codexbar_display::themespec::TextCommand;
using codexbar_display::core::ConsumeFrameLine;
using codexbar_display::core::RuntimeState;
using codexbar_display::core::SerialConsumeEvent;

enum class CommandType {
  FillScreen,
  FillRect,
  Text,
  Progress,
  Gif,
};

struct RecordedCommand {
  CommandType type;
  std::string text;
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  int font = 0;
  int size = 0;
  int percent = 0;
  uint16_t color = 0;
  uint16_t fg = 0;
  uint16_t bg = 0;
  uint16_t border = 0;
  std::string assetPath;
};

class RecordingSink final : public Sink {
 public:
  void FillScreen(uint16_t color) override {
    RecordedCommand cmd;
    cmd.type = CommandType::FillScreen;
    cmd.color = color;
    commands.push_back(cmd);
  }

  void FillRect(const RectCommand& rect) override {
    RecordedCommand cmd;
    cmd.type = CommandType::FillRect;
    cmd.x = rect.x;
    cmd.y = rect.y;
    cmd.width = rect.width;
    cmd.height = rect.height;
    cmd.color = rect.color;
    commands.push_back(cmd);
  }

  void DrawText(const TextCommand& text) override {
    RecordedCommand cmd;
    cmd.type = CommandType::Text;
    cmd.text = text.text == nullptr ? "" : text.text;
    cmd.x = text.x;
    cmd.y = text.y;
    cmd.font = text.font;
    cmd.size = text.size;
    cmd.fg = text.fg;
    cmd.bg = text.bg;
    commands.push_back(cmd);
  }

  void DrawProgress(const ProgressCommand& progress) override {
    RecordedCommand cmd;
    cmd.type = CommandType::Progress;
    cmd.x = progress.x;
    cmd.y = progress.y;
    cmd.width = progress.width;
    cmd.height = progress.height;
    cmd.percent = progress.percent;
    cmd.color = progress.fillColor;
    cmd.bg = progress.bgColor;
    cmd.border = progress.borderColor;
    commands.push_back(cmd);
  }

  void DrawGif(const GifCommand& gif) override {
    RecordedCommand cmd;
    cmd.type = CommandType::Gif;
    cmd.x = gif.x;
    cmd.y = gif.y;
    cmd.width = gif.width;
    cmd.height = gif.height;
    cmd.assetPath = gif.assetPath == nullptr ? "" : gif.assetPath;
    commands.push_back(cmd);
  }

  std::vector<RecordedCommand> commands;
};

FrameData testFrame() {
  FrameData frame;
  frame.provider = "codex";
  frame.label = "Codex";
  frame.session = 97;
  frame.weekly = 71;
  frame.resetSecs = 89 * 60 + 54;
  frame.usageMode = "remaining";
  frame.sessionTokens = 1234;
  frame.weekTokens = 5678;
  frame.totalTokens = 9012;
  return frame;
}

void testInvalidSpecsReturnFalse() {
  RecordingSink sink;

  TEST_ASSERT_FALSE(RenderThemeSpec("", testFrame(), sink));
  TEST_ASSERT_FALSE(RenderThemeSpec("{bad", testFrame(), sink));
  TEST_ASSERT_FALSE(RenderThemeSpec("{\"themeId\":\"x\"}", testFrame(), sink));
  TEST_ASSERT_TRUE(sink.commands.empty());
}

void testRendersCommandsAndBindings() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "primitives": [
      {"type":"rect","x":1,"y":2,"width":3,"height":4,"color":"#FFFFFF"},
      {"type":"text","x":5,"y":6,"font":2,"fontSize":3,"color":"#CCFF00","bgColor":"#000000","text":"{label} {provider} {session}/{weekly} {reset} {usageMode} {sessionTokens} {weekTokens} {totalTokens}"},
      {"type":"text","x":7,"y":8,"fontSize":1,"binding":"weeklyPercent"},
      {"type":"progress","x":9,"y":10,"width":111,"height":12,"color":"#00FF00","bgColor":"#101010","borderColor":"#FFFFFF"},
      {"type":"progress","x":13,"y":14,"width":99,"height":15,"binding":"weekly","color":"#0000FF"},
      {"type":"gif","x":15,"y":16,"width":80,"height":64,"assetPath":"/themes/mini/mini.gif"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(RenderThemeSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(7, sink.commands.size());

  const RecordedCommand& clear = sink.commands[0];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(clear.type));
  TEST_ASSERT_EQUAL_HEX16(0x0000, clear.color);

  const RecordedCommand& rect = sink.commands[1];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(rect.type));
  TEST_ASSERT_EQUAL_INT(1, rect.x);
  TEST_ASSERT_EQUAL_INT(2, rect.y);
  TEST_ASSERT_EQUAL_INT(3, rect.width);
  TEST_ASSERT_EQUAL_INT(4, rect.height);
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, rect.color);

  const RecordedCommand& text = sink.commands[2];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(text.type));
  TEST_ASSERT_EQUAL_STRING("Codex codex 97/71 1h 29m remaining 1234 5678 9012", text.text.c_str());
  TEST_ASSERT_EQUAL_INT(5, text.x);
  TEST_ASSERT_EQUAL_INT(6, text.y);
  TEST_ASSERT_EQUAL_INT(2, text.font);
  TEST_ASSERT_EQUAL_INT(3, text.size);
  TEST_ASSERT_EQUAL_HEX16(0xCFE0, text.fg);
  TEST_ASSERT_EQUAL_HEX16(0x0000, text.bg);

  const RecordedCommand& boundText = sink.commands[3];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(boundText.type));
  TEST_ASSERT_EQUAL_STRING("71", boundText.text.c_str());

  const RecordedCommand& sessionProgress = sink.commands[4];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Progress), static_cast<int>(sessionProgress.type));
  TEST_ASSERT_EQUAL_INT(97, sessionProgress.percent);
  TEST_ASSERT_EQUAL_HEX16(0x07E0, sessionProgress.color);
  TEST_ASSERT_EQUAL_HEX16(0x1082, sessionProgress.bg);

  const RecordedCommand& weeklyProgress = sink.commands[5];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Progress), static_cast<int>(weeklyProgress.type));
  TEST_ASSERT_EQUAL_INT(71, weeklyProgress.percent);

  const RecordedCommand& gif = sink.commands[6];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Gif), static_cast<int>(gif.type));
  TEST_ASSERT_EQUAL_INT(15, gif.x);
  TEST_ASSERT_EQUAL_INT(16, gif.y);
  TEST_ASSERT_EQUAL_INT(80, gif.width);
  TEST_ASSERT_EQUAL_INT(64, gif.height);
  TEST_ASSERT_EQUAL_STRING("/themes/mini/mini.gif", gif.assetPath.c_str());
}

void testInvalidPrimitivesAreSkipped() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "primitives": [
      {"type":"rect","x":1,"y":2,"width":0,"height":4,"color":"#FFFFFF"},
      {"type":"text","x":3,"y":4,"fontSize":0,"text":"bad"},
      {"type":"progress","x":5,"y":6,"width":10,"height":0},
      {"type":"gif","x":5,"y":6,"width":10,"height":10},
      {"type":"text","x":7,"y":8,"fontSize":1,"text":"ok"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(RenderThemeSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(2, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_STRING("ok", sink.commands[1].text.c_str());
}

void testColorFallbacks() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "primitives": [
      {"type":"rect","x":1,"y":2,"width":3,"height":4,"color":"not-a-color"},
      {"type":"text","x":5,"y":6,"fontSize":1,"color":"#FFFFFZ","bgColor":"#FFFFFF","text":"ok"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(RenderThemeSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_HEX16(0x0000, sink.commands[1].color);
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, sink.commands[2].fg);
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, sink.commands[2].bg);
}

void testAnimatedPrimitivePassRendersOnlyGifsWithoutClear() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "primitives": [
      {"type":"rect","x":1,"y":2,"width":3,"height":4,"color":"#FFFFFF"},
      {"type":"gif","x":20,"y":21,"width":22,"height":23,"assetPath":"/themes/demo/loop.gif"},
      {"type":"text","x":5,"y":6,"fontSize":1,"text":"ok"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(RenderThemeSpecAnimatedPrimitives(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(1, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Gif), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_STRING("/themes/demo/loop.gif", sink.commands[0].assetPath.c_str());
}

void testThemeSpecCacheCarriesLayoutAcrossLiveFrames() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* studioFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":94,"weekly":87,"resetSecs":5394,"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":1,"y":2,"fontSize":1,"text":"{session}%"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, studioFrame, 1000, true, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_EQUAL_STRING("mini-transport", state.current.themeSpecId.c_str());
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("{session}%") >= 0);

  const char* liveFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":96,"weekly":99,"resetSecs":4200,"usageMode":"remaining","theme":"mini"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, liveFrame, 2000, true, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_TRUE(event.themeSpecCacheHit);
  TEST_ASSERT_EQUAL_INT(96, state.current.session);
  TEST_ASSERT_EQUAL_INT(99, state.current.weekly);
  TEST_ASSERT_EQUAL_STRING("mini-transport", state.current.themeSpecId.c_str());
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("{session}%") >= 0);
}

void testThemeSpecCacheUpdatesRawWhenSameRevisionIsResent() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":30,"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":1,"y":2,"fontSize":1,"text":"first"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, true, event));
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("first") >= 0);

  const char* editedFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":21,"resetSecs":31,"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":1,"y":2,"fontSize":1,"text":"edited"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, editedFrame, 2000, true, event));
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("edited") >= 0);

  const char* liveFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":12,"weekly":22,"resetSecs":32})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, liveFrame, 3000, true, event));
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("edited") >= 0);
  TEST_ASSERT_FALSE(state.current.themeSpecRaw.indexOf("first") >= 0);
}

void testThemeSpecNullClearsCachedLayout() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* studioFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":30,"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":1,"y":2,"fontSize":1,"text":"cached"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, studioFrame, 1000, true, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("cached") >= 0);

  const char* clearFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":21,"resetSecs":31,"theme":"mini","themeSpec":null})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, clearFrame, 2000, true, event));
  TEST_ASSERT_TRUE(event.themeSpecChanged);
  TEST_ASSERT_FALSE(event.themeSpecCacheHit);
  TEST_ASSERT_FALSE(state.current.hasThemeSpec);
  TEST_ASSERT_EQUAL_STRING("", state.current.themeSpecId.c_str());
  TEST_ASSERT_EQUAL_STRING("", state.current.themeSpecRaw.c_str());

  const char* liveFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":12,"weekly":22,"resetSecs":32,"theme":"mini"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, liveFrame, 3000, true, event));
  TEST_ASSERT_FALSE(event.themeSpecCacheHit);
  TEST_ASSERT_FALSE(state.current.hasThemeSpec);
}

}  // namespace

int main() {
  UNITY_BEGIN();
  RUN_TEST(testInvalidSpecsReturnFalse);
  RUN_TEST(testRendersCommandsAndBindings);
  RUN_TEST(testInvalidPrimitivesAreSkipped);
  RUN_TEST(testColorFallbacks);
  RUN_TEST(testAnimatedPrimitivePassRendersOnlyGifsWithoutClear);
  RUN_TEST(testThemeSpecCacheCarriesLayoutAcrossLiveFrames);
  RUN_TEST(testThemeSpecCacheUpdatesRawWhenSameRevisionIsResent);
  RUN_TEST(testThemeSpecNullClearsCachedLayout);
  return UNITY_END();
}
