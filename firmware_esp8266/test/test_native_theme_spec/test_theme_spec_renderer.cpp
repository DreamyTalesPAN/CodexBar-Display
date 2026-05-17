#include "../../../firmware_shared/theme_spec_renderer_core.h"
#include "../../../firmware_shared/codexbar_display_core.h"

#include <string>
#include <vector>

#include <unity.h>

namespace {

using codexbar_display::themespec::FrameData;
using codexbar_display::themespec::GifCommand;
using codexbar_display::themespec::PixelsCommand;
using codexbar_display::themespec::ProgressCommand;
using codexbar_display::themespec::RectCommand;
using codexbar_display::themespec::RenderThemeSpecAnimatedPrimitives;
using codexbar_display::themespec::RenderThemeSpec;
using codexbar_display::themespec::Sink;
using codexbar_display::themespec::SpriteCommand;
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
  Sprite,
  Pixels,
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
  bool hasBg = false;
  std::string assetPath;
  std::string data;
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
    cmd.hasBg = text.hasBg;
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

  void DrawSprite(const SpriteCommand& sprite) override {
    RecordedCommand cmd;
    cmd.type = CommandType::Sprite;
    cmd.x = sprite.x;
    cmd.y = sprite.y;
    cmd.width = sprite.width;
    cmd.height = sprite.height;
    cmd.assetPath = sprite.assetPath == nullptr ? "" : sprite.assetPath;
    commands.push_back(cmd);
  }

  void DrawPixels(const PixelsCommand& pixels) override {
    RecordedCommand cmd;
    cmd.type = CommandType::Pixels;
    cmd.x = pixels.x;
    cmd.y = pixels.y;
    cmd.width = pixels.width;
    cmd.height = pixels.height;
    cmd.color = pixels.color;
    cmd.data = pixels.data == nullptr ? "" : pixels.data;
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
  frame.time = "21:25";
  frame.date = "7/5/2026";
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
    "bgColor": "#123456",
    "primitives": [
      {"type":"rect","x":1,"y":2,"width":3,"height":4,"color":"#FFFFFF"},
      {"type":"text","x":5,"y":6,"font":2,"fontSize":3,"color":"#CCFF00","bgColor":"#000000","text":"{label} {provider} {session}/{weekly} {reset} {usageMode} {time} {date} {sessionTokens} {weekTokens} {totalTokens}"},
      {"type":"text","x":7,"y":8,"fontSize":1,"binding":"weeklyPercent"},
      {"type":"progress","x":9,"y":10,"width":111,"height":12,"color":"#00FF00","bgColor":"#101010","borderColor":"#FFFFFF"},
      {"type":"progress","x":13,"y":14,"width":99,"height":15,"binding":"weekly","color":"#0000FF"},
      {"type":"gif","x":15,"y":16,"width":80,"height":64,"assetPath":"/themes/mini/mini.gif"},
      {"type":"sprite","x":17,"y":18,"width":24,"height":14,"assetPath":"/themes/u/cloud.cbi"},
      {"type":"pixels","x":2,"y":3,"width":4,"height":2,"color":"#FFFFFF","data":"A5"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(RenderThemeSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(9, sink.commands.size());

  const RecordedCommand& clear = sink.commands[0];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(clear.type));
  TEST_ASSERT_EQUAL_HEX16(0x11AA, clear.color);

  const RecordedCommand& rect = sink.commands[1];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(rect.type));
  TEST_ASSERT_EQUAL_INT(1, rect.x);
  TEST_ASSERT_EQUAL_INT(2, rect.y);
  TEST_ASSERT_EQUAL_INT(3, rect.width);
  TEST_ASSERT_EQUAL_INT(4, rect.height);
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, rect.color);

  const RecordedCommand& text = sink.commands[2];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(text.type));
  TEST_ASSERT_EQUAL_STRING("Codex codex 97/71 1h 29m remaining 21:25 7/5/2026 1234 5678 9012", text.text.c_str());
  TEST_ASSERT_EQUAL_INT(5, text.x);
  TEST_ASSERT_EQUAL_INT(6, text.y);
  TEST_ASSERT_EQUAL_INT(2, text.font);
  TEST_ASSERT_EQUAL_INT(3, text.size);
  TEST_ASSERT_EQUAL_HEX16(0xCFE0, text.fg);
  TEST_ASSERT_EQUAL_HEX16(0x0000, text.bg);
  TEST_ASSERT_TRUE(text.hasBg);

  const RecordedCommand& boundText = sink.commands[3];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(boundText.type));
  TEST_ASSERT_EQUAL_STRING("71", boundText.text.c_str());
  TEST_ASSERT_FALSE(boundText.hasBg);

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

  const RecordedCommand& sprite = sink.commands[7];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Sprite), static_cast<int>(sprite.type));
  TEST_ASSERT_EQUAL_INT(17, sprite.x);
  TEST_ASSERT_EQUAL_INT(18, sprite.y);
  TEST_ASSERT_EQUAL_INT(24, sprite.width);
  TEST_ASSERT_EQUAL_INT(14, sprite.height);
  TEST_ASSERT_EQUAL_STRING("/themes/u/cloud.cbi", sprite.assetPath.c_str());

  const RecordedCommand& pixels = sink.commands[8];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Pixels), static_cast<int>(pixels.type));
  TEST_ASSERT_EQUAL_INT(2, pixels.x);
  TEST_ASSERT_EQUAL_INT(3, pixels.y);
  TEST_ASSERT_EQUAL_INT(4, pixels.width);
  TEST_ASSERT_EQUAL_INT(2, pixels.height);
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, pixels.color);
  TEST_ASSERT_EQUAL_STRING("A5", pixels.data.c_str());
}

void testRendersCompactCommandsAndBindings() {
  const char* spec = R"JSON({
    "v": 1,
    "id": "codex-test",
    "rev": 1,
    "bg": "#123456",
    "p": [
      {"t":"tx","x":5,"y":6,"f":2,"s":3,"c":"#FF00FF","bg":"#000000","v":"{l} {s}/{w} {r} {u} {dt}"},
      {"t":"p","x":9,"y":10,"w":111,"h":12,"b":"w","c":"#00FF00","bg":"#101010","bc":"#FFFFFF"},
      {"t":"g","x":15,"y":16,"w":80,"h":64,"a":"/themes/mini/mini.gif"},
      {"t":"sp","x":17,"y":18,"w":24,"h":14,"a":"/themes/u/cloud.cbi"},
      {"t":"px","x":2,"y":3,"w":4,"h":2,"c":"#FFFFFF","d":"A5"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(RenderThemeSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(6, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_HEX16(0x11AA, sink.commands[0].color);

  const RecordedCommand& text = sink.commands[1];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(text.type));
  TEST_ASSERT_EQUAL_STRING("Codex 97/71 1h 29m remaining 7/5/2026", text.text.c_str());
  TEST_ASSERT_EQUAL_INT(2, text.font);
  TEST_ASSERT_EQUAL_INT(3, text.size);
  TEST_ASSERT_EQUAL_HEX16(0xF81F, text.fg);

  const RecordedCommand& progress = sink.commands[2];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Progress), static_cast<int>(progress.type));
  TEST_ASSERT_EQUAL_INT(71, progress.percent);
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, progress.border);

  const RecordedCommand& gif = sink.commands[3];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Gif), static_cast<int>(gif.type));
  TEST_ASSERT_EQUAL_STRING("/themes/mini/mini.gif", gif.assetPath.c_str());

  const RecordedCommand& sprite = sink.commands[4];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Sprite), static_cast<int>(sprite.type));
  TEST_ASSERT_EQUAL_STRING("/themes/u/cloud.cbi", sprite.assetPath.c_str());
  TEST_ASSERT_EQUAL_INT(24, sprite.width);
  TEST_ASSERT_EQUAL_INT(14, sprite.height);

  const RecordedCommand& pixels = sink.commands[5];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Pixels), static_cast<int>(pixels.type));
  TEST_ASSERT_EQUAL_STRING("A5", pixels.data.c_str());
}

void testRendersMulticolorRlePixelsAsFillRects() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "primitives": [
      {"type":"pixels","x":10,"y":20,"width":5,"height":2,"p":["#FF0000","#00FF00","#0000FF"],"r":["2a.2b","3.2c"]}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(RenderThemeSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(4, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(sink.commands[0].type));

  const RecordedCommand& red = sink.commands[1];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(red.type));
  TEST_ASSERT_EQUAL_INT(10, red.x);
  TEST_ASSERT_EQUAL_INT(20, red.y);
  TEST_ASSERT_EQUAL_INT(2, red.width);
  TEST_ASSERT_EQUAL_INT(1, red.height);
  TEST_ASSERT_EQUAL_HEX16(0xF800, red.color);

  const RecordedCommand& green = sink.commands[2];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(green.type));
  TEST_ASSERT_EQUAL_INT(13, green.x);
  TEST_ASSERT_EQUAL_INT(20, green.y);
  TEST_ASSERT_EQUAL_INT(2, green.width);
  TEST_ASSERT_EQUAL_INT(1, green.height);
  TEST_ASSERT_EQUAL_HEX16(0x07E0, green.color);

  const RecordedCommand& blue = sink.commands[3];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(blue.type));
  TEST_ASSERT_EQUAL_INT(13, blue.x);
  TEST_ASSERT_EQUAL_INT(21, blue.y);
  TEST_ASSERT_EQUAL_INT(2, blue.width);
  TEST_ASSERT_EQUAL_INT(1, blue.height);
  TEST_ASSERT_EQUAL_HEX16(0x001F, blue.color);
}

void testInvalidMulticolorRlePixelsAreSkippedWithoutPartialDraw() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "primitives": [
      {"type":"pixels","x":1,"y":2,"width":4,"height":2,"p":["#FF0000"],"r":["4a","2a"]},
      {"type":"pixels","x":3,"y":4,"width":2,"height":1,"p":["#00FF00"],"r":["aB"]},
      {"type":"text","x":7,"y":8,"fontSize":1,"text":"ok"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(RenderThemeSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(2, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_STRING("ok", sink.commands[1].text.c_str());
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
      {"type":"pixels","x":1,"y":1,"width":8,"height":1,"data":"X0"},
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
  TEST_ASSERT_TRUE(sink.commands[2].hasBg);
}

void testAnimatedPrimitivePassRendersGifsAndSpritesWithoutClear() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "primitives": [
      {"type":"rect","x":1,"y":2,"width":3,"height":4,"color":"#FFFFFF"},
      {"type":"gif","x":20,"y":21,"width":22,"height":23,"assetPath":"/themes/demo/loop.gif"},
      {"type":"sprite","x":30,"y":31,"width":32,"height":33,"assetPath":"/themes/demo/hero.cba"},
      {"type":"text","x":5,"y":6,"fontSize":1,"text":"ok"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(RenderThemeSpecAnimatedPrimitives(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(2, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Gif), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_STRING("/themes/demo/loop.gif", sink.commands[0].assetPath.c_str());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Sprite), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_INT(32, sink.commands[1].width);
  TEST_ASSERT_EQUAL_INT(33, sink.commands[1].height);
  TEST_ASSERT_EQUAL_STRING("/themes/demo/hero.cba", sink.commands[1].assetPath.c_str());
}

void testStateAssetsUseActivityWithIdleFallback() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "primitives": [
      {"type":"gif","x":1,"y":2,"width":3,"height":4,"stateAssets":{"idle":"/themes/demo/idle.gif","coding":"/themes/demo/coding.gif"}},
      {"type":"sprite","x":5,"y":6,"width":7,"height":8,"sa":{"idle":"/themes/demo/idle.cba","coding":"/themes/demo/coding.cba"}}
    ]
  })JSON";

  FrameData codingFrame = testFrame();
  codingFrame.activity = "coding";
  RecordingSink codingSink;
  TEST_ASSERT_TRUE(RenderThemeSpec(spec, codingFrame, codingSink));
  TEST_ASSERT_EQUAL_STRING("/themes/demo/coding.gif", codingSink.commands[1].assetPath.c_str());
  TEST_ASSERT_EQUAL_STRING("/themes/demo/coding.cba", codingSink.commands[2].assetPath.c_str());

  FrameData waitingFrame = testFrame();
  waitingFrame.activity = "waiting";
  RecordingSink waitingSink;
  TEST_ASSERT_TRUE(RenderThemeSpec(spec, waitingFrame, waitingSink));
  TEST_ASSERT_EQUAL_STRING("/themes/demo/idle.gif", waitingSink.commands[1].assetPath.c_str());
  TEST_ASSERT_EQUAL_STRING("/themes/demo/idle.cba", waitingSink.commands[2].assetPath.c_str());
}

void testFrameActivityDefaultsToCodingWhenUsageChanges() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, true, event));
  TEST_ASSERT_EQUAL_STRING("idle", state.current.activity.c_str());

  const char* idleFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, idleFrame, 2000, true, event));
  TEST_ASSERT_EQUAL_STRING("idle", state.current.activity.c_str());

  const char* codingFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":120,"weekTokens":220,"totalTokens":340})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, codingFrame, 3000, true, event));
  TEST_ASSERT_EQUAL_STRING("coding", state.current.activity.c_str());
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

void testCompactThemeSpecFrameIsCached() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* frame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":94,"weekly":87,"resetSecs":5394,"themeSpec":{"v":1,"id":"mini-transport","rev":1,"fb":"mini","p":[{"t":"tx","x":1,"y":2,"s":1,"v":"{s}%"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, frame, 1000, true, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_EQUAL_STRING("mini-transport", state.current.themeSpecId.c_str());
  TEST_ASSERT_EQUAL_INT(1, state.current.themeSpecRev);
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("\"t\":\"tx\"") >= 0);
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
  RUN_TEST(testRendersCompactCommandsAndBindings);
  RUN_TEST(testRendersMulticolorRlePixelsAsFillRects);
  RUN_TEST(testInvalidMulticolorRlePixelsAreSkippedWithoutPartialDraw);
  RUN_TEST(testInvalidPrimitivesAreSkipped);
  RUN_TEST(testColorFallbacks);
  RUN_TEST(testAnimatedPrimitivePassRendersGifsAndSpritesWithoutClear);
  RUN_TEST(testStateAssetsUseActivityWithIdleFallback);
  RUN_TEST(testFrameActivityDefaultsToCodingWhenUsageChanges);
  RUN_TEST(testThemeSpecCacheCarriesLayoutAcrossLiveFrames);
  RUN_TEST(testCompactThemeSpecFrameIsCached);
  RUN_TEST(testThemeSpecCacheUpdatesRawWhenSameRevisionIsResent);
  RUN_TEST(testThemeSpecNullClearsCachedLayout);
  return UNITY_END();
}
