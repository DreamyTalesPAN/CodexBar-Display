#include "../../../firmware_shared/theme_spec_renderer_core.h"
#include "../../../firmware_shared/codexbar_display_core.h"
#include "../../../firmware_shared/update_notice_policy.h"
#include "../../src/theme_spec_runtime_policy.h"

#include <string>
#include <vector>

#include <unity.h>

namespace {

using codexbar_display::themespec::FrameData;
using codexbar_display::themespec::GifCommand;
using codexbar_display::themespec::PixelsCommand;
using codexbar_display::themespec::ProgressCommand;
using codexbar_display::themespec::RectCommand;
using codexbar_display::themespec::CompileThemeSpec;
using codexbar_display::themespec::CompiledThemeSpec;
using codexbar_display::themespec::CompiledThemeSpecHasGifAssets;
using codexbar_display::themespec::CompiledThemeSpecReferencesAsset;
using codexbar_display::themespec::AnyAnimatedCompiledPrimitiveOverlaps;
using codexbar_display::themespec::Bounds;
using codexbar_display::themespec::RenderCompiledThemeSpec;
using codexbar_display::themespec::RenderCompiledThemeSpecAnimatedPrimitives;
using codexbar_display::themespec::RenderCompiledThemeSpecChangedPrimitives;
using codexbar_display::themespec::RenderCompiledThemeSpecRegionPrimitives;
using codexbar_display::themespec::RenderCompiledThemeSpecStaticPrimitives;
using codexbar_display::themespec::ReleaseCompiledThemeSpec;
using codexbar_display::themespec::Sink;
using codexbar_display::themespec::SpriteCommand;
using codexbar_display::themespec::TextCommand;
using codexbar_display::themespec::kThemeSpecFieldActivity;
using codexbar_display::themespec::kThemeSpecFieldLabel;
using codexbar_display::themespec::kThemeSpecFieldReset;
using codexbar_display::themespec::kThemeSpecFieldSession;
using codexbar_display::themespec::kThemeSpecFieldUsageWindows;
using codexbar_display::themespec::kThemeSpecFieldWeekly;
using codexbar_display::core::ConsumeFrameLine;
using codexbar_display::core::CurrentRemainingSecs;
using codexbar_display::core::CurrentResetTrust;
using codexbar_display::core::DecodeResetTrustRecord;
using codexbar_display::core::EncodeResetTrustRecord;
using codexbar_display::core::ResetTrust;
using codexbar_display::core::ResetTrustBudgetSecs;
using codexbar_display::core::ResetTrustState;
using codexbar_display::core::RuntimeState;
using codexbar_display::core::SerialConsumeEvent;
using codexbar_display::esp8266::ThemeSpecRuntimePolicy;

enum class CommandType {
  BeginClip,
  EndClip,
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
  int maxWidth = 0;
  bool fitShrink = false;
  int align = 0;
  int percent = 0;
  int style = 0;
  int segments = 0;
  int segmentGap = 0;
  int borderRadius = 0;
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
  void BeginClip(int x, int y, int width, int height) override {
    RecordedCommand cmd;
    cmd.type = CommandType::BeginClip;
    cmd.x = x;
    cmd.y = y;
    cmd.width = width;
    cmd.height = height;
    commands.push_back(cmd);
  }

  void EndClip() override {
    RecordedCommand cmd;
    cmd.type = CommandType::EndClip;
    commands.push_back(cmd);
  }

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
    cmd.borderRadius = rect.borderRadius;
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
    cmd.maxWidth = text.maxWidth;
    cmd.fitShrink = text.fitShrink;
    cmd.align = text.align;
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
    cmd.style = progress.style;
    cmd.segments = progress.segments;
    cmd.segmentGap = progress.segmentGap;
    cmd.borderRadius = progress.borderRadius;
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
  frame.hasTokenTotals = true;
  return frame;
}

bool renderSpec(const char* spec, const FrameData& frame, RecordingSink& sink) {
  JsonDocument doc;
  CompiledThemeSpec scene;
  if (!CompileThemeSpec(spec, doc, scene)) {
    return false;
  }
  const bool ok = RenderCompiledThemeSpec(scene, frame, sink);
  ReleaseCompiledThemeSpec(scene);
  return ok;
}

bool renderAnimatedSpec(const char* spec, const FrameData& frame, RecordingSink& sink) {
  JsonDocument doc;
  CompiledThemeSpec scene;
  if (!CompileThemeSpec(spec, doc, scene)) {
    return false;
  }
  const bool ok = RenderCompiledThemeSpecAnimatedPrimitives(scene, frame, sink);
  ReleaseCompiledThemeSpec(scene);
  return ok;
}

bool renderStaticSpec(const char* spec, const FrameData& frame, RecordingSink& sink) {
  JsonDocument doc;
  CompiledThemeSpec scene;
  if (!CompileThemeSpec(spec, doc, scene)) {
    return false;
  }
  const bool ok = RenderCompiledThemeSpecStaticPrimitives(scene, frame, sink);
  ReleaseCompiledThemeSpec(scene);
  return ok;
}

bool renderChangedSpec(const char* spec, const FrameData& frame, uint32_t changedFields, RecordingSink& sink) {
  JsonDocument doc;
  CompiledThemeSpec scene;
  if (!CompileThemeSpec(spec, doc, scene)) {
    return false;
  }
  const bool ok = RenderCompiledThemeSpecChangedPrimitives(scene, frame, changedFields, sink);
  ReleaseCompiledThemeSpec(scene);
  return ok;
}

bool renderChangedSpecWithError(
    const char* spec,
    const FrameData& frame,
    uint32_t changedFields,
    RecordingSink& sink,
    const char*& error) {
  JsonDocument doc;
  CompiledThemeSpec scene;
  error = "";
  if (!CompileThemeSpec(spec, doc, scene)) {
    error = "compile_failed";
    return false;
  }
  const bool ok = RenderCompiledThemeSpecChangedPrimitives(scene, frame, changedFields, sink, &error);
  ReleaseCompiledThemeSpec(scene);
  return ok;
}

bool renderChangedSpecWithSkippedAnimated(
    const char* spec,
    const FrameData& frame,
    uint32_t changedFields,
    RecordingSink& sink,
    bool& skippedAnimated) {
  JsonDocument doc;
  CompiledThemeSpec scene;
  skippedAnimated = false;
  if (!CompileThemeSpec(spec, doc, scene)) {
    return false;
  }
  const bool ok = RenderCompiledThemeSpecChangedPrimitives(
      scene,
      frame,
      changedFields,
      sink,
      nullptr,
      &skippedAnimated);
  ReleaseCompiledThemeSpec(scene);
  return ok;
}

void testInvalidSpecsReturnFalse() {
  RecordingSink sink;

  TEST_ASSERT_FALSE(renderSpec("", testFrame(), sink));
  TEST_ASSERT_FALSE(renderSpec("{bad", testFrame(), sink));
  TEST_ASSERT_FALSE(renderSpec("{\"themeId\":\"x\"}", testFrame(), sink));
  TEST_ASSERT_TRUE(sink.commands.empty());
}

void testGifLimitsRejectOversizedOrMultipleGifs() {
  RecordingSink sink;

  const char* oversized = R"JSON({"v":1,"id":"mini-transport","rev":1,"p":[{"t":"g","x":0,"y":0,"w":81,"h":80,"a":"/themes/u/a.gif"}]})JSON";
  TEST_ASSERT_FALSE(renderSpec(oversized, testFrame(), sink));

  const char* multiple = R"JSON({"v":1,"id":"mini-transport","rev":1,"p":[{"t":"g","x":0,"y":0,"w":40,"h":40,"a":"/themes/u/a.gif"},{"t":"g","x":50,"y":0,"w":40,"h":40,"a":"/themes/u/b.gif"}]})JSON";
  TEST_ASSERT_FALSE(renderSpec(multiple, testFrame(), sink));

  const char* miniSized = R"JSON({"v":1,"id":"mini-transport","rev":1,"p":[{"t":"g","x":80,"y":115,"w":80,"h":80,"a":"/themes/mini/mini.gif"}]})JSON";
  TEST_ASSERT_TRUE(renderSpec(miniSized, testFrame(), sink));
}

void testCompiledThemeSpecFindsEveryReferencedAsset() {
  const char* spec = R"JSON({"v":1,"id":"asset-references","rev":1,"p":[{"t":"g","x":0,"y":0,"w":40,"h":40,"a":"/themes/s/clock.gif"},{"t":"sp","x":0,"y":40,"w":40,"h":40,"a":"/themes/s/base.cba","sa":{"idle":"/themes/s/idle.cba","coding":"/themes/s/rc-orbit.cba"}}]})JSON";
  JsonDocument doc;
  CompiledThemeSpec scene;
  TEST_ASSERT_TRUE(CompileThemeSpec(spec, doc, scene));
  TEST_ASSERT_TRUE(CompiledThemeSpecReferencesAsset(scene, "/themes/s/clock.gif"));
  TEST_ASSERT_TRUE(CompiledThemeSpecReferencesAsset(scene, "/themes/s/base.cba"));
  TEST_ASSERT_TRUE(CompiledThemeSpecReferencesAsset(scene, "/themes/s/idle.cba"));
  TEST_ASSERT_TRUE(CompiledThemeSpecReferencesAsset(scene, "/themes/s/rc-orbit.cba"));
  TEST_ASSERT_FALSE(CompiledThemeSpecReferencesAsset(scene, "/themes/s/orphan.cba"));
  TEST_ASSERT_FALSE(CompiledThemeSpecReferencesAsset(scene, ""));
  TEST_ASSERT_FALSE(CompiledThemeSpecReferencesAsset(scene, nullptr));
  ReleaseCompiledThemeSpec(scene);
}

void testRendersCommandsAndBindings() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "bgColor": "#123456",
    "primitives": [
      {"type":"rect","x":1,"y":2,"width":3,"height":4,"borderRadius":2,"color":"#FFFFFF"},
      {"type":"text","x":5,"y":6,"font":2,"fontSize":3,"maxWidth":120,"fit":"shrink","align":"center","color":"#CCFF00","bgColor":"#000000","text":"{label} {provider} {session}/{weekly} {reset} {usageMode} {time} {date} {sessionTokens} {weekTokens} {totalTokens}"},
      {"type":"text","x":7,"y":8,"fontSize":1,"binding":"weeklyPercent"},
      {"type":"progress","x":9,"y":10,"width":111,"height":12,"borderRadius":6,"progressStyle":"segments","segments":16,"segmentGap":2,"color":"#00FF00","bgColor":"#101010","borderColor":"#FFFFFF"},
      {"type":"progress","x":13,"y":14,"width":99,"height":15,"binding":"weekly","color":"#0000FF"},
      {"type":"gif","x":15,"y":16,"width":80,"height":64,"assetPath":"/themes/mini/mini.gif"},
      {"type":"sprite","x":17,"y":18,"width":24,"height":14,"assetPath":"/themes/u/cloud.cbi"},
      {"type":"pixels","x":2,"y":3,"width":4,"height":2,"color":"#FFFFFF","data":"A5"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(9, sink.commands.size());

  const RecordedCommand& clear = sink.commands[0];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(clear.type));
  TEST_ASSERT_EQUAL_HEX16(0x11AA, clear.color);

  const RecordedCommand& rect = sink.commands[1];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(rect.type));
  TEST_ASSERT_EQUAL_INT(1, rect.x);
  TEST_ASSERT_EQUAL_INT(2, rect.y);
  TEST_ASSERT_EQUAL_INT(2, rect.borderRadius);
  TEST_ASSERT_EQUAL_INT(3, rect.width);
  TEST_ASSERT_EQUAL_INT(4, rect.height);
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, rect.color);

  const RecordedCommand& text = sink.commands[2];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(text.type));
  TEST_ASSERT_EQUAL_STRING("Codex codex 97/71 1h 29m remaining 21:25 7/5/2026 1.23K 5.67K 9.01K", text.text.c_str());
  TEST_ASSERT_EQUAL_INT(5, text.x);
  TEST_ASSERT_EQUAL_INT(6, text.y);
  TEST_ASSERT_EQUAL_INT(2, text.font);
  TEST_ASSERT_EQUAL_INT(3, text.size);
  TEST_ASSERT_EQUAL_INT(120, text.maxWidth);
  TEST_ASSERT_TRUE(text.fitShrink);
  TEST_ASSERT_EQUAL_INT(1, text.align);
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

void testAbsentTokenTotalsRenderUnavailable() {
  const char* spec = R"JSON({"v":1,"id":"tokens","rev":1,"p":[
    {"t":"tx","x":0,"y":0,"b":"st","s":1},
    {"t":"tx","x":0,"y":10,"b":"wt","s":1},
    {"t":"tx","x":0,"y":20,"v":"{totalTokens}","s":1}
  ]})JSON";

  FrameData frame = testFrame();
  frame.hasTokenTotals = false;
  RecordingSink sink;
  TEST_ASSERT_TRUE(renderSpec(spec, frame, sink));
  TEST_ASSERT_EQUAL_UINT32(4, sink.commands.size());
  TEST_ASSERT_EQUAL_STRING("--", sink.commands[1].text.c_str());
  TEST_ASSERT_EQUAL_STRING("--", sink.commands[2].text.c_str());
  TEST_ASSERT_EQUAL_STRING("--", sink.commands[3].text.c_str());
}

void testConsumeFrameLineTracksTokenTotalPresence() {
  RuntimeState state;
  SerialConsumeEvent event;
  TEST_ASSERT_TRUE(codexbar_display::core::ConsumeFrameLine(
      state,
      "{\"v\":2,\"provider\":\"codex\",\"label\":\"Codex\",\"session\":10,\"weekly\":20,\"resetSecs\":60,\"sessionTokens\":5}",
      1000,
      event));
  TEST_ASSERT_TRUE(state.current.hasTokenTotals);

  TEST_ASSERT_TRUE(codexbar_display::core::ConsumeFrameLine(
      state,
      "{\"v\":2,\"provider\":\"codex\",\"label\":\"Codex\",\"session\":11,\"weekly\":21,\"resetSecs\":59}",
      2000,
      event));
  TEST_ASSERT_FALSE(state.current.hasTokenTotals);

  // A finished all-zero token history omits every total on the wire, so the
  // Companion marks it explicitly and the device renders 0 instead of "--".
  TEST_ASSERT_TRUE(codexbar_display::core::ConsumeFrameLine(
      state,
      "{\"v\":2,\"provider\":\"codex\",\"label\":\"Codex\",\"session\":12,\"weekly\":22,\"resetSecs\":58,\"tokenTotalsKnown\":true}",
      3000,
      event));
  TEST_ASSERT_TRUE(state.current.hasTokenTotals);
}

void testTokenAvailabilityFlipRepaintsTokenBindings() {
  // Only hasTokenTotals changes between these frames: the totals stay zero.
  codexbar_display::core::Frame previous;
  codexbar_display::core::Frame next;
  next.hasThemeSpec = true;
  next.hasTokenTotals = true;
  const String raw(R"JSON({"p":[{"t":"tx","b":"st"}]})JSON");
  TEST_ASSERT_TRUE(
      codexbar_display::core::FrameTokenStatsVisualChanged(previous, next, raw));
  TEST_ASSERT_FALSE(codexbar_display::core::FrameTokenStatsVisualChanged(
      previous, previous, raw));
}

void testUsageUnavailableKeepsThemeAndProgress() {
  const char* spec = R"JSON({"v":1,"id":"usage-unavailable","rev":1,"p":[{"t":"tx","x":0,"y":0,"b":"l"},{"t":"tx","x":0,"y":20,"b":"s"},{"t":"tx","x":0,"y":40,"v":"{weekly}% left"},{"t":"tx","x":0,"y":60,"v":"Reset in {reset}"},{"t":"p","x":0,"y":80,"w":100,"h":8,"b":"s"}]})JSON";

  FrameData frame;
  frame.label = "Gemini";
  frame.session = 73;
  frame.weekly = 21;
  frame.resetSecs = 3600;
  frame.usageUnavailable = true;

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderSpec(spec, frame, sink));
  TEST_ASSERT_EQUAL_UINT32(6, sink.commands.size());
  TEST_ASSERT_EQUAL_STRING("Gemini", sink.commands[1].text.c_str());
  TEST_ASSERT_EQUAL_STRING("??", sink.commands[2].text.c_str());
  TEST_ASSERT_EQUAL_STRING("??% left", sink.commands[3].text.c_str());
  TEST_ASSERT_EQUAL_STRING("Reset unavailable", sink.commands[4].text.c_str());
  TEST_ASSERT_EQUAL_INT(73, sink.commands[5].percent);

  FrameData coldStart = frame;
  coldStart.session = 0;
  RecordingSink coldStartSink;
  TEST_ASSERT_TRUE(renderSpec(spec, coldStart, coldStartSink));
  TEST_ASSERT_EQUAL_INT(0, coldStartSink.commands[5].percent);

  frame.usageUnavailable = false;
  frame.resetSecs = 0;
  char reset[32] = {0};
  codexbar_display::themespec::BoundValue("reset", frame, reset, sizeof(reset));
  TEST_ASSERT_EQUAL_STRING("Reset unavailable", reset);
}

void testUsageWindowOwnershipHidesCompleteMissingLane() {
  const char* spec = R"JSON({
    "v":1,
    "id":"usage-windows",
    "rev":1,
    "p":[
      {"t":"tx","x":0,"y":0,"sl":1,"v":"{usageSlot1Label}"},
      {"t":"r","x":0,"y":20,"w":100,"h":8,"sl":2,"c":"#FFFFFF"},
      {"t":"p","x":0,"y":40,"w":100,"h":8,"sl":2,"b":"us2p"},
      {"t":"tx","x":0,"y":60,"sl":2,"v":"{usageSlot2Label}"}
    ]
  })JSON";

  FrameData frame;
  frame.usageSlot1Label = "Weekly";
  frame.usageSlot1Percent = 42;
  frame.usageSlot1Available = true;

  RecordingSink oneSlotSink;
  TEST_ASSERT_TRUE(renderSpec(spec, frame, oneSlotSink));
  TEST_ASSERT_EQUAL_UINT32(2, oneSlotSink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(oneSlotSink.commands[0].type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(oneSlotSink.commands[1].type));
  TEST_ASSERT_EQUAL_STRING("Weekly", oneSlotSink.commands[1].text.c_str());

  frame.usageSlot2Label = "Codex Spark Weekly";
  frame.usageSlot2Percent = 7;
  frame.usageSlot2Available = true;
  RecordingSink twoSlotSink;
  TEST_ASSERT_TRUE(renderSpec(spec, frame, twoSlotSink));
  TEST_ASSERT_EQUAL_UINT32(5, twoSlotSink.commands.size());
}

void testTokenTotalsRenderCompactAndTruncated() {
  char out[16];
  codexbar_display::themespec::FormatTokenCount(0, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("0", out);
  codexbar_display::themespec::FormatTokenCount(999, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("999", out);
  codexbar_display::themespec::FormatTokenCount(1400000, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("1.4M", out);
  codexbar_display::themespec::FormatTokenCount(384000000, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("384M", out);
  codexbar_display::themespec::FormatTokenCount(1070000000, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("1.07B", out);
  // Three significant digits: two decimals below 10 units, one below 100,
  // none above — every value stays at most five glyphs wide.
  codexbar_display::themespec::FormatTokenCount(43930900, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("43.9M", out);
  codexbar_display::themespec::FormatTokenCount(156140000, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("156M", out);
  codexbar_display::themespec::FormatTokenCount(9970000000, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("9.97B", out);
  // Truncated, never rounded, so the Mac preview parity holds.
  codexbar_display::themespec::FormatTokenCount(1999999, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("1.99M", out);
  codexbar_display::themespec::FormatTokenCount(12345, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("12.3K", out);
}

void testProviderSlotBindingsRenderLabelAndFormattedReset() {
  const char* spec = R"JSON({
    "v":1,
    "id":"provider-slots",
    "rev":1,
    "p":[
      {"t":"tx","x":0,"y":0,"pl":1,"v":"{providerSlot1Label}"},
      {"t":"tx","x":0,"y":20,"pl":1,"b":"pv1r"},
      {"t":"tx","x":0,"y":40,"pl":2,"v":"{pv2l}"},
      {"t":"tx","x":0,"y":60,"pl":2,"b":"pv2r"}
    ]
  })JSON";

  FrameData frame;
  frame.providerSlots[0].label = "Claude";
  frame.providerSlots[0].resetSecs = 3600;
  frame.providerSlots[0].available = true;

  RecordingSink oneProviderSink;
  TEST_ASSERT_TRUE(renderSpec(spec, frame, oneProviderSink));
  TEST_ASSERT_EQUAL_UINT32(3, oneProviderSink.commands.size());
  TEST_ASSERT_EQUAL_STRING("Claude", oneProviderSink.commands[1].text.c_str());
  TEST_ASSERT_EQUAL_STRING("1h 0m", oneProviderSink.commands[2].text.c_str());

  frame.providerSlots[1].label = "Codex";
  frame.providerSlots[1].resetSecs = 12000;
  frame.providerSlots[1].available = true;
  RecordingSink twoProviderSink;
  TEST_ASSERT_TRUE(renderSpec(spec, frame, twoProviderSink));
  TEST_ASSERT_EQUAL_UINT32(5, twoProviderSink.commands.size());
  TEST_ASSERT_EQUAL_STRING("Codex", twoProviderSink.commands[3].text.c_str());
  TEST_ASSERT_EQUAL_STRING("3h 20m", twoProviderSink.commands[4].text.c_str());
}

void testProviderSlotsParseTickAndTriggerLiveRedraw() {
  RuntimeState state;
  SerialConsumeEvent event;
  const char* frameLine =
      R"JSON({"v":2,"provider":"claude","label":"Claude","resetSecs":3600,"resetAgeSecs":0,"resetTrustSecs":18000,"resetSource":"claude:primary","resetTrust":"live","providerSlots":[{"id":"claude","label":"Claude","percent":12,"resetSecs":3600},{"id":"codex","label":"Codex","percent":4,"resetSecs":7200}],"themeSpec":{"v":1,"id":"provider-slot-redraw","rev":1,"p":[{"t":"tx","x":0,"y":0,"pl":1,"b":"pv1r"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, frameLine, 1000, event));
  TEST_ASSERT_TRUE(state.current.providerSlots[0].available);
  TEST_ASSERT_EQUAL_STRING("Claude", state.current.providerSlots[0].label.c_str());
  TEST_ASSERT_EQUAL_STRING("Codex", state.current.providerSlots[1].label.c_str());
  TEST_ASSERT_EQUAL_INT64(3600, state.current.providerSlots[0].resetSecs);

  // The device ticks the countdown from its own clock between frames.
  TEST_ASSERT_EQUAL_INT64(
      3540, codexbar_display::core::CurrentProviderSlotRemainingSecs(state, 0, 61000));

  const char* resetAdvances =
      R"JSON({"v":2,"provider":"claude","label":"Claude","resetSecs":1800,"resetAgeSecs":0,"resetTrustSecs":18000,"resetSource":"claude:primary","resetTrust":"live","providerSlots":[{"id":"claude","label":"Claude","percent":12,"resetSecs":1800},{"id":"codex","label":"Codex","percent":4,"resetSecs":7200}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, resetAdvances, 2000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
  TEST_ASSERT_TRUE((event.themeSpecChangedFields & codexbar_display::themespec::kThemeSpecFieldProviderSlots) != 0);
}

void testIndexedProgressHidesMissingWindow() {
  const char* spec = R"JSON({"v":1,"id":"indexed-progress","rev":1,"p":[{"t":"p","x":0,"y":0,"w":100,"h":8,"b":"usage.2.percent"}]})JSON";

  FrameData frame;
  frame.usageWindows[0].available = true;
  frame.usageWindows[1].available = true;

  RecordingSink missingWindowSink;
  TEST_ASSERT_TRUE(renderSpec(spec, frame, missingWindowSink));
  TEST_ASSERT_EQUAL_UINT32(1, missingWindowSink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(missingWindowSink.commands[0].type));

  frame.usageWindows[2].available = true;
  frame.usageWindows[2].percent = 37;
  RecordingSink availableWindowSink;
  TEST_ASSERT_TRUE(renderSpec(spec, frame, availableWindowSink));
  TEST_ASSERT_EQUAL_UINT32(2, availableWindowSink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Progress), static_cast<int>(availableWindowSink.commands[1].type));
  TEST_ASSERT_EQUAL_INT(37, availableWindowSink.commands[1].percent);
}

void testUsageWindowResetCountdownsTickIndependently() {
  RuntimeState state;
  state.hasFrame = true;
  state.reset.hasDeadline = true;
  state.reset.enforced = true;
  state.reset.hostLive = true;
  state.reset.deadlineSecs = 3600;
  state.reset.trustSecs = codexbar_display::core::kResetTrustHorizonSecs;
  state.reset.baseMillis = 1000;
  state.resetBaseMillis = 1000;
  state.current.usageWindows[0].available = true;
  state.current.usageWindows[0].resetSecs = 100;
  state.current.usageWindows[1].available = true;
  state.current.usageWindows[1].resetSecs = 200;

  TEST_ASSERT_EQUAL_INT64(
      40,
      codexbar_display::core::CurrentUsageWindowRemainingSecs(state, 0, 61000));
  TEST_ASSERT_EQUAL_INT64(
      140,
      codexbar_display::core::CurrentUsageWindowRemainingSecs(state, 1, 61000));
  TEST_ASSERT_EQUAL_INT64(
      0,
      codexbar_display::core::CurrentUsageWindowRemainingSecs(state, 0, 121000));
  TEST_ASSERT_TRUE(codexbar_display::core::RemainingMinuteBucketChanged(40, 1));
  TEST_ASSERT_TRUE(codexbar_display::core::RemainingMinuteBucketChanged(140, 3));
  TEST_ASSERT_FALSE(codexbar_display::core::RemainingMinuteBucketChanged(139, 2));
  TEST_ASSERT_TRUE(codexbar_display::core::ThemeSpecUsesUsageWindowResetBinding(
      String(R"JSON({"p":[{"t":"tx","v":"{usageSlot1Reset}"}]})JSON"), 0));
  TEST_ASSERT_TRUE(codexbar_display::core::ThemeSpecUsesUsageWindowResetBinding(
      String(R"JSON({"p":[{"t":"tx","v":"{us2r}"}]})JSON"), 1));
}

void testAdvertisedUsageWindowCapacityFitsFrameBufferAndParses() {
  std::string frameLine;
  const auto appendEscapedText = [&frameLine](size_t decodedBytes, size_t variant) {
    for (size_t j = 0; j < decodedBytes; ++j) {
      if (variant == 0) {
        frameLine += "\\\"";
      } else if (variant == 1) {
        frameLine += "\\\\";
      } else if (j % 3 == 0) {
        frameLine += "\\u0026";
      } else if (j % 3 == 1) {
        frameLine += "\\u003c";
      } else {
        frameLine += "\\u003e";
      }
    }
  };
  frameLine =
      "{\"v\":2,\"provider\":\"";
  appendEscapedText(codexbar_display::core::kProviderWireBytes, 2);
  frameLine += "\",\"label\":\"";
  appendEscapedText(codexbar_display::core::kProviderLabelWireBytes, 2);
  frameLine += "\",\"session\":100,\"weekly\":100,\"resetSecs\":9223372036854775807,\"usageMode\":\"remaining\",\"usageWindows\":[";
  for (size_t i = 0; i < codexbar_display::core::kAdvertisedMaxUsageWindows; ++i) {
    if (i > 0) {
      frameLine += ",";
    }
    frameLine += "{\"id\":\"";
    appendEscapedText(codexbar_display::core::kUsageWindowIDWireBytes, i);
    frameLine += "\",\"label\":\"";
    appendEscapedText(codexbar_display::core::kUsageWindowLabelWireBytes, i);
    frameLine += "\",\"percent\":100,\"resetSecs\":9223372036854775807}";
  }
  frameLine += "]}";

  TEST_ASSERT_EQUAL_UINT32(3, codexbar_display::core::kAdvertisedMaxUsageWindows);
  TEST_ASSERT_EQUAL_UINT32(
      codexbar_display::core::kAdvertisedMaxUsageWindows,
      codexbar_display::core::kMaxUsageWindows);
  TEST_ASSERT_EQUAL_UINT32(
      codexbar_display::core::kMaxUsageWindows,
      codexbar_display::themespec::kMaxThemeSpecUsageWindows);
  TEST_ASSERT_TRUE(codexbar_display::core::kAdvertisedMaxUsageWindows > 0);
  TEST_ASSERT_TRUE(frameLine.size() + 1 <= codexbar_display::core::kFrameLineBufferBytes);

  codexbar_display::core::Frame frame;
  TEST_ASSERT_TRUE(codexbar_display::core::ParseFrameLine(frameLine.c_str(), frame));
  for (size_t i = 0; i < codexbar_display::core::kAdvertisedMaxUsageWindows; ++i) {
    TEST_ASSERT_TRUE(frame.usageWindows[i].available);
    TEST_ASSERT_EQUAL_UINT32(codexbar_display::core::kUsageWindowIDWireBytes, frame.usageWindows[i].id.length());
    TEST_ASSERT_EQUAL_UINT32(codexbar_display::core::kUsageWindowLabelWireBytes, frame.usageWindows[i].label.length());
    TEST_ASSERT_EQUAL_INT(100, frame.usageWindows[i].percent);
    TEST_ASSERT_EQUAL_INT64(9223372036854775807LL, frame.usageWindows[i].resetSecs);
  }
  TEST_ASSERT_TRUE(frame.usageWindows[codexbar_display::core::kAdvertisedMaxUsageWindows - 1].available);
}

void testRawUsageWindowParserCapacityStillAcceptsNormalLabels() {
  std::string frameLine =
      "{\"v\":2,\"provider\":\"p\",\"label\":\"Provider\",\"session\":100,\"weekly\":100,\"resetSecs\":9223372036854775807,\"usageMode\":\"remaining\",\"usageWindows\":[";
  for (size_t i = 0; i < codexbar_display::core::kMaxUsageWindows; ++i) {
    if (i > 0) {
      frameLine += ",";
    }
    frameLine += "{\"id\":\"";
    frameLine += std::string(codexbar_display::core::kUsageWindowIDWireBytes, 'i');
    frameLine += "\",\"label\":\"";
    frameLine += std::string(codexbar_display::core::kUsageWindowLabelWireBytes, 'L');
    frameLine += "\",\"percent\":100,\"resetSecs\":9223372036854775807}";
  }
  frameLine += "]}";

  TEST_ASSERT_TRUE(frameLine.size() + 1 <= codexbar_display::core::kFrameLineBufferBytes);

  codexbar_display::core::Frame frame;
  TEST_ASSERT_TRUE(codexbar_display::core::ParseFrameLine(frameLine.c_str(), frame));
  TEST_ASSERT_TRUE(frame.usageWindows[codexbar_display::core::kMaxUsageWindows - 1].available);
}

void testHighestAdvertisedUsageWindowBindingCompiles() {
  char binding[40];
  std::snprintf(
      binding,
      sizeof(binding),
      "{usageSlot%uLabel}",
      static_cast<unsigned>(codexbar_display::core::kAdvertisedMaxUsageWindows));
  std::string spec = "{\"p\":[{\"t\":\"tx\",\"x\":0,\"y\":0,\"v\":\"";
  spec += binding;
  spec += "\"}]}";

  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, spec.c_str()));
  CompiledThemeSpec scene;
  TEST_ASSERT_TRUE(CompileThemeSpec(spec.c_str(), doc, scene));
  TEST_ASSERT_TRUE(scene.primitiveCount == 1);
  ReleaseCompiledThemeSpec(scene);
}

void testCompactUsageWindowBindingTriggersLiveRedraw() {
  RuntimeState state;
  SerialConsumeEvent event;
  const char* firstFrame = R"JSON({"v":2,"provider":"codex","usageWindows":[{"id":"weekly","label":"Weekly","percent":42,"resetSecs":100}],"themeSpec":{"v":1,"id":"slot-redraw","rev":1,"p":[{"t":"p","x":0,"y":0,"w":100,"h":8,"sl":1,"b":"us1p"}]}})JSON";
  const char* nextFrame = R"JSON({"v":2,"provider":"codex","usageWindows":[{"id":"weekly","label":"Weekly","percent":43,"resetSecs":99}]})JSON";

  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, nextFrame, 2000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
  TEST_ASSERT_TRUE((event.themeSpecChangedFields & codexbar_display::themespec::kThemeSpecFieldUsageWindows) != 0);
}

void testConsumeFrameLineComparesCurrentBeforeAssignment() {
  RuntimeState state;
  SerialConsumeEvent event;
  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":100,"usageWindows":[{"id":"weekly","label":"Weekly","percent":42,"resetSecs":100}],"themeSpec":{"v":1,"id":"clippy","rev":1,"p":[{"t":"sp","x":83,"y":54,"w":74,"h":74,"a":"/themes/u/cp-i.cba","sa":{"idle":"/themes/u/cp-i.cba","coding":"/themes/u/cp-c.cba"}},{"t":"p","x":0,"y":0,"w":100,"h":8,"sl":1,"b":"us1p"}]}})JSON";
  const char* nextFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":100,"usageWindows":[{"id":"weekly","label":"Weekly","percent":43,"resetSecs":99}]})JSON";

  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_FALSE(event.hadFrame);
  TEST_ASSERT_FALSE(event.themeSpecPartialRender);
  TEST_ASSERT_EQUAL_STRING("idle", state.current.activity.c_str());

  TEST_ASSERT_TRUE(ConsumeFrameLine(state, nextFrame, 2000, event));
  TEST_ASSERT_TRUE(event.hadFrame);
  TEST_ASSERT_TRUE(event.themeSpecCacheHit);
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
  TEST_ASSERT_EQUAL_STRING("coding", state.current.activity.c_str());
  TEST_ASSERT_TRUE((event.themeSpecChangedFields & codexbar_display::themespec::kThemeSpecFieldActivity) != 0);
  TEST_ASSERT_TRUE((event.themeSpecChangedFields & codexbar_display::themespec::kThemeSpecFieldUsageWindows) != 0);
}

void testQuotaReplenishmentDoesNotCountAsUsageProgress() {
  RuntimeState state;
  SerialConsumeEvent event;
  const char* usedBeforeReset = R"JSON({"v":2,"provider":"codex","usageMode":"used","session":80,"weekly":90,"usageWindows":[{"id":"weekly","label":"Weekly","percent":90}]})JSON";
  const char* usedAfterReset = R"JSON({"v":2,"provider":"codex","usageMode":"used","session":0,"weekly":0,"usageWindows":[{"id":"weekly","label":"Weekly","percent":0}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, usedBeforeReset, 1000, event));
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, usedAfterReset, 2000, event));
  TEST_ASSERT_FALSE(event.usageProgressed);

  const char* remainingBeforeReset = R"JSON({"v":2,"provider":"codex","usageMode":"remaining","session":20,"weekly":10,"usageWindows":[{"id":"weekly","label":"Weekly","percent":10}]})JSON";
  const char* remainingAfterReset = R"JSON({"v":2,"provider":"codex","usageMode":"remaining","session":100,"weekly":100,"usageWindows":[{"id":"weekly","label":"Weekly","percent":100}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, remainingBeforeReset, 3000, event));
  TEST_ASSERT_FALSE(event.usageProgressed);
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, remainingAfterReset, 4000, event));
  TEST_ASSERT_FALSE(event.usageProgressed);

  const char* remainingAfterUsage = R"JSON({"v":2,"provider":"codex","usageMode":"remaining","session":99,"weekly":100,"usageWindows":[{"id":"weekly","label":"Weekly","percent":99}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, remainingAfterUsage, 5000, event));
  TEST_ASSERT_TRUE(event.usageProgressed);
}

void testUsageProgressRequiresStableProviderAndWindowIdentity() {
  RuntimeState state;
  SerialConsumeEvent event;
  const char* codexFrame = R"JSON({"v":2,"provider":"codex","usageMode":"used","session":10,"weekly":20,"usageWindows":[{"id":"gone","label":"Gone","percent":10},{"id":"stable","label":"Stable","percent":20}]})JSON";
  const char* claudeFrame = R"JSON({"v":2,"provider":"claude","usageMode":"used","session":30,"weekly":40,"usageWindows":[{"id":"stable","label":"Stable","percent":40}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, codexFrame, 1000, event));
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, claudeFrame, 2000, event));
  TEST_ASSERT_FALSE(event.usageProgressed);

  TEST_ASSERT_TRUE(ConsumeFrameLine(state, codexFrame, 3000, event));
  TEST_ASSERT_FALSE(event.usageProgressed);
  const char* compactedFrame = R"JSON({"v":2,"provider":"codex","usageMode":"used","session":20,"weekly":0,"usageWindows":[{"id":"stable","label":"Stable","percent":20}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, compactedFrame, 4000, event));
  TEST_ASSERT_FALSE(event.usageProgressed);

  const char* progressedFrame = R"JSON({"v":2,"provider":"codex","usageMode":"used","session":21,"weekly":0,"usageWindows":[{"id":"stable","label":"Stable","percent":21}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, progressedFrame, 5000, event));
  TEST_ASSERT_TRUE(event.usageProgressed);
}

void testUsageWindowOwnershipAndCompactTemplateTriggerLiveRedraw() {
  RuntimeState ownershipState;
  SerialConsumeEvent event;
  const char* ownershipFrame = R"JSON({"v":2,"provider":"codex","themeSpec":{"v":1,"id":"slot-owner-redraw","rev":1,"p":[{"t":"r","x":0,"y":0,"w":100,"h":8,"sl":1,"c":"#FFFFFF"}]}})JSON";
  const char* slotAppears = R"JSON({"v":2,"provider":"codex","usageWindows":[{"id":"weekly","label":"Weekly","percent":0,"resetSecs":0}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(ownershipState, ownershipFrame, 1000, event));
  TEST_ASSERT_TRUE(ConsumeFrameLine(ownershipState, slotAppears, 2000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
  TEST_ASSERT_TRUE((event.themeSpecChangedFields & codexbar_display::themespec::kThemeSpecFieldUsageWindows) != 0);

  RuntimeState compactTemplateState;
  const char* compactTemplateFrame = R"JSON({"v":2,"provider":"codex","usageWindows":[{"id":"weekly","label":"Weekly","percent":0,"resetSecs":0}],"themeSpec":{"v":1,"id":"slot-template-redraw","rev":1,"p":[{"t":"tx","x":0,"y":0,"v":"{us1l}"}]}})JSON";
  const char* labelChanges = R"JSON({"v":2,"provider":"codex","usageWindows":[{"id":"weekly","label":"This week","percent":0,"resetSecs":0}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(compactTemplateState, compactTemplateFrame, 1000, event));
  TEST_ASSERT_TRUE(ConsumeFrameLine(compactTemplateState, labelChanges, 2000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
}

void testWhitespaceUsageWindowOwnersTriggerLiveRedraw() {
  RuntimeState usageIndexState;
  SerialConsumeEvent event;
  const char* usageIndexFrame = R"JSON({"v":2,"provider":"codex","themeSpec":{"v":1,"id":"usage-index-owner-redraw","rev":1,"p":[{"t":"r","x":0,"y":0,"w":100,"h":8,"usageIndex":
  0,"c":"#FFFFFF"}]}})JSON";
  const char* slotAppears = R"JSON({"v":2,"provider":"codex","usageWindows":[{"id":"weekly","label":"Weekly","percent":0,"resetSecs":0}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(usageIndexState, usageIndexFrame, 1000, event));
  TEST_ASSERT_TRUE(ConsumeFrameLine(usageIndexState, slotAppears, 2000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);

  RuntimeState slotState;
  const char* slotFrame = "{\"v\":2,\"provider\":\"codex\",\"themeSpec\":{\"v\":1,\"id\":\"slot-owner-tab-redraw\",\"rev\":1,\"p\":[{\"t\":\"r\",\"x\":0,\"y\":0,\"w\":100,\"h\":8,\"slot\":\t1,\"c\":\"#FFFFFF\"}]}}";
  TEST_ASSERT_TRUE(ConsumeFrameLine(slotState, slotFrame, 1000, event));
  TEST_ASSERT_TRUE(ConsumeFrameLine(slotState, slotAppears, 2000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
}

void testPartialUsageProtocolRendersOnlyUnknownLane() {
  RuntimeState state;
  SerialConsumeEvent event;
  const char* frameLine =
      R"JSON({"v":2,"provider":"codex","label":"Codex","session":0,"weekly":57,"resetSecs":3600,"sessionUnavailable":true})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, frameLine, 1000, event));
  TEST_ASSERT_FALSE(state.current.usageUnavailable);
  TEST_ASSERT_TRUE(state.current.sessionUnavailable);
  TEST_ASSERT_FALSE(state.current.weeklyUnavailable);

  FrameData frame;
  frame.label = state.current.label.c_str();
  frame.session = state.current.session;
  frame.weekly = state.current.weekly;
  frame.resetSecs = state.current.resetSecs;
  frame.usageUnavailable = state.current.usageUnavailable;
  frame.sessionUnavailable = state.current.sessionUnavailable;
  frame.weeklyUnavailable = state.current.weeklyUnavailable;

  char session[8] = {0};
  char weekly[8] = {0};
  char reset[32] = {0};
  codexbar_display::themespec::BoundValue("session", frame, session, sizeof(session));
  codexbar_display::themespec::BoundValue("weekly", frame, weekly, sizeof(weekly));
  codexbar_display::themespec::BoundValue("reset", frame, reset, sizeof(reset));
  TEST_ASSERT_EQUAL_STRING("??", session);
  TEST_ASSERT_EQUAL_STRING("57", weekly);
  TEST_ASSERT_EQUAL_STRING("1h 0m", reset);

  const char* spec =
      R"JSON({"v":1,"id":"partial-usage","rev":1,"p":[{"t":"p","x":0,"y":0,"w":100,"h":8,"b":"s"},{"t":"p","x":0,"y":10,"w":100,"h":8,"b":"w"}]})JSON";
  RecordingSink sink;
  TEST_ASSERT_TRUE(renderSpec(spec, frame, sink));
  TEST_ASSERT_EQUAL_UINT32(2, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Progress), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_INT(57, sink.commands[1].percent);
}

void testResetCountdownFormatsDaysAndHours() {
  FrameData frame;
  frame.resetSecs = (6 * 24 * 60 * 60) + (20 * 60 * 60) + (53 * 60);

  char reset[32] = {0};
  codexbar_display::themespec::BoundValue("reset", frame, reset, sizeof(reset));

  TEST_ASSERT_EQUAL_STRING("6d 20h", reset);
}

void testLabelBindingUsesProviderLabelWithoutUpdateNotice() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "primitives": [
      {"type":"text","x":5,"y":6,"binding":"label"},
      {"type":"text","x":7,"y":8,"text":"{label} Usage"}
    ]
  })JSON";

  FrameData frame = testFrame();
  frame.updateAvailable = true;
  frame.updateNotice = "Open VibeTV Mac App";

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderSpec(spec, frame, sink));
  TEST_ASSERT_EQUAL_UINT32(3, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_STRING("Codex", sink.commands[1].text.c_str());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[2].type));
  TEST_ASSERT_EQUAL_STRING("Codex Usage", sink.commands[2].text.c_str());
}

void testChangedLabelPassUsesSynchronizedUpdateNoticeText() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "bgColor": "#000000",
    "primitives": [
      {"type":"text","x":21,"y":12,"font":4,"fontSize":1,"maxWidth":198,"binding":"label","align":"center"}
    ]
  })JSON";

  FrameData frame = testFrame();
  frame.updateAvailable = true;
  frame.showUpdateNotice = true;
  frame.updateNotice = "Open VibeTV Mac App";

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderChangedSpec(spec, frame, kThemeSpecFieldLabel, sink));
  TEST_ASSERT_EQUAL_UINT32(4, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[2].type));
  TEST_ASSERT_EQUAL_STRING("Open VibeTV Mac App", sink.commands[2].text.c_str());
}

void testChangedLabelPassCanRestoreProviderText() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "bgColor": "#000000",
    "primitives": [
      {"type":"text","x":21,"y":12,"font":4,"fontSize":1,"maxWidth":198,"binding":"label","align":"center"}
    ]
  })JSON";

  FrameData frame = testFrame();
  frame.updateAvailable = true;
  frame.showUpdateNotice = true;
  frame.updateNotice = "Codex";

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderChangedSpec(spec, frame, kThemeSpecFieldLabel, sink));
  TEST_ASSERT_EQUAL_UINT32(4, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[2].type));
  TEST_ASSERT_EQUAL_STRING("Codex", sink.commands[2].text.c_str());
}

bool renderRegionSpec(
    const char* spec,
    const FrameData& frame,
    const Bounds& region,
    RecordingSink& sink,
    const char** error = nullptr,
    bool* skippedAnimated = nullptr) {
  JsonDocument doc;
  CompiledThemeSpec scene;
  if (!CompileThemeSpec(spec, doc, scene)) {
    return false;
  }
  const bool ok = RenderCompiledThemeSpecRegionPrimitives(scene, frame, region, sink, error, skippedAnimated);
  ReleaseCompiledThemeSpec(scene);
  return ok;
}

// A theme without a label binding: static text top and bottom plus a GIF in
// the middle, mirroring a custom ThemeSpec that needs the overlay-bar notice.
const char* kOverlayRegionSpec = R"JSON({
  "v": 1,
  "id": "no-label",
  "rev": 1,
  "bg": "#000000",
  "p": [
    {"t":"tx","x":0,"y":4,"w":240,"v":"{session}%","s":2,"al":"center","c":"#CCFF00"},
    {"t":"g","x":80,"y":100,"w":76,"h":76,"a":"/themes/mini/mini.gif"},
    {"t":"tx","x":0,"y":210,"w":240,"v":"Reset in {reset}","s":2,"al":"center","c":"#999999"}
  ]
})JSON";

void testRegionRepaintRedrawsOnlyOverlappingPrimitives() {
  Bounds region;
  region.x = 0;
  region.y = 0;
  region.width = 240;
  region.height = 24;

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderRegionSpec(kOverlayRegionSpec, testFrame(), region, sink));
  TEST_ASSERT_EQUAL_UINT32(4, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::BeginClip), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_INT(0, sink.commands[0].y);
  TEST_ASSERT_EQUAL_INT(24, sink.commands[0].height);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_INT(240, sink.commands[1].width);
  TEST_ASSERT_EQUAL_INT(24, sink.commands[1].height);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[2].type));
  TEST_ASSERT_EQUAL_STRING("97%", sink.commands[2].text.c_str());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::EndClip), static_cast<int>(sink.commands[3].type));
}

void testRegionRepaintSkipsAnimatedPrimitivesButReportsThem() {
  Bounds region;
  region.x = 0;
  region.y = 90;
  region.width = 240;
  region.height = 24;

  RecordingSink sink;
  bool skippedAnimated = false;
  TEST_ASSERT_TRUE(renderRegionSpec(kOverlayRegionSpec, testFrame(), region, sink, nullptr, &skippedAnimated));
  TEST_ASSERT_TRUE(skippedAnimated);
  for (const RecordedCommand& cmd : sink.commands) {
    TEST_ASSERT_NOT_EQUAL(static_cast<int>(CommandType::Gif), static_cast<int>(cmd.type));
  }
}

void testRegionRepaintWithoutOverlapFillsBackgroundOnly() {
  Bounds region;
  region.x = 0;
  region.y = 40;
  region.width = 240;
  region.height = 24;

  RecordingSink sink;
  const char* error = nullptr;
  TEST_ASSERT_FALSE(renderRegionSpec(kOverlayRegionSpec, testFrame(), region, sink, &error));
  TEST_ASSERT_EQUAL_STRING("no_overlap_rendered", error);
  TEST_ASSERT_EQUAL_UINT32(3, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_INT(40, sink.commands[1].y);
}

void testAnimatedOverlapQueryFindsGifOnlyInsideItsBounds() {
  JsonDocument doc;
  CompiledThemeSpec scene;
  TEST_ASSERT_TRUE(CompileThemeSpec(kOverlayRegionSpec, doc, scene));

  Bounds top;
  top.x = 0;
  top.y = 0;
  top.width = 240;
  top.height = 24;
  TEST_ASSERT_FALSE(AnyAnimatedCompiledPrimitiveOverlaps(scene, testFrame(), top));

  Bounds middle;
  middle.x = 0;
  middle.y = 100;
  middle.width = 240;
  middle.height = 24;
  TEST_ASSERT_TRUE(AnyAnimatedCompiledPrimitiveOverlaps(scene, testFrame(), middle));

  ReleaseCompiledThemeSpec(scene);
}

using codexbar_display::updatenotice::Activate;
using codexbar_display::updatenotice::CurrentPhase;
using codexbar_display::updatenotice::Deactivate;
using codexbar_display::updatenotice::Phase;
using codexbar_display::updatenotice::Surface;
using codexbar_display::updatenotice::Tick;
using UpdateNoticeConfig = codexbar_display::updatenotice::Config;
using UpdateNoticeState = codexbar_display::updatenotice::State;
using UpdateNoticeTickResult = codexbar_display::updatenotice::TickResult;

UpdateNoticeConfig testNoticeConfig() {
  UpdateNoticeConfig config;
  config.phaseToggleMs = 1500;
  config.overlayVisibleMs = 10000;
  config.overlayHiddenMs = 60000;
  return config;
}

void testUpdateNoticeLabelSurfaceStaysVisibleAndRotatesPhases() {
  UpdateNoticeState state;
  UpdateNoticeTickResult result = Activate(state, Surface::Label, 1000);
  TEST_ASSERT_TRUE(result.draw);
  TEST_ASSERT_FALSE(result.restore);
  TEST_ASSERT_TRUE(state.visible);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Phase::Provider), static_cast<int>(CurrentPhase(state)));

  result = Tick(state, testNoticeConfig(), 2000);
  TEST_ASSERT_FALSE(result.draw);

  result = Tick(state, testNoticeConfig(), 2500);
  TEST_ASSERT_TRUE(result.draw);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Phase::Available), static_cast<int>(CurrentPhase(state)));

  result = Tick(state, testNoticeConfig(), 4000);
  TEST_ASSERT_TRUE(result.draw);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Phase::MacApp), static_cast<int>(CurrentPhase(state)));

  result = Tick(state, testNoticeConfig(), 5500);
  TEST_ASSERT_TRUE(result.draw);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Phase::Provider), static_cast<int>(CurrentPhase(state)));

  // The label surface never leaves the screen while the update is available.
  for (unsigned long at = 6000; at < 200000; at += 700) {
    result = Tick(state, testNoticeConfig(), at);
    TEST_ASSERT_FALSE(result.restore);
    TEST_ASSERT_TRUE(state.visible);
  }
}

void testUpdateNoticeOverlaySurfaceDutyCyclesVisibility() {
  UpdateNoticeState state;
  UpdateNoticeTickResult result = Activate(state, Surface::Overlay, 0);
  TEST_ASSERT_TRUE(result.draw);
  TEST_ASSERT_TRUE(state.visible);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Phase::Available), static_cast<int>(CurrentPhase(state)));

  // Two-phase rotation while the overlay window is visible.
  result = Tick(state, testNoticeConfig(), 1500);
  TEST_ASSERT_TRUE(result.draw);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Phase::MacApp), static_cast<int>(CurrentPhase(state)));
  result = Tick(state, testNoticeConfig(), 3000);
  TEST_ASSERT_TRUE(result.draw);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Phase::Available), static_cast<int>(CurrentPhase(state)));

  // The visible window ends after overlayVisibleMs and asks for a restore.
  result = Tick(state, testNoticeConfig(), 10000);
  TEST_ASSERT_TRUE(result.restore);
  TEST_ASSERT_FALSE(result.draw);
  TEST_ASSERT_FALSE(state.visible);

  // Hidden window: no draws until overlayHiddenMs elapses.
  result = Tick(state, testNoticeConfig(), 40000);
  TEST_ASSERT_FALSE(result.draw);
  TEST_ASSERT_FALSE(result.restore);
  TEST_ASSERT_FALSE(state.visible);

  result = Tick(state, testNoticeConfig(), 70000);
  TEST_ASSERT_TRUE(result.draw);
  TEST_ASSERT_TRUE(state.visible);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Phase::Available), static_cast<int>(CurrentPhase(state)));
}

void testUpdateNoticeDeactivateRestoresOnlyWhenVisible() {
  UpdateNoticeState state;
  (void)Activate(state, Surface::Overlay, 0);
  TEST_ASSERT_TRUE(state.visible);

  UpdateNoticeTickResult result = Deactivate(state);
  TEST_ASSERT_TRUE(result.restore);
  TEST_ASSERT_FALSE(state.active);
  TEST_ASSERT_FALSE(state.visible);

  // Hidden overlay window: firmware became current while the bar was hidden.
  (void)Activate(state, Surface::Overlay, 0);
  (void)Tick(state, testNoticeConfig(), 10000);
  TEST_ASSERT_FALSE(state.visible);
  result = Deactivate(state);
  TEST_ASSERT_FALSE(result.restore);
  TEST_ASSERT_FALSE(state.active);
}

void testUpdateNoticeSurfaceChangeRestoresOldSurface() {
  UpdateNoticeState state;
  (void)Activate(state, Surface::Label, 0);
  TEST_ASSERT_TRUE(state.visible);

  // Theme switch: label binding disappeared, overlay takes over.
  UpdateNoticeTickResult result = Activate(state, Surface::Overlay, 5000);
  TEST_ASSERT_TRUE(result.restore);
  TEST_ASSERT_TRUE(result.draw);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Surface::Overlay), static_cast<int>(state.surface));

  // Re-activating with the same surface is a no-op.
  result = Activate(state, Surface::Overlay, 6000);
  TEST_ASSERT_FALSE(result.draw);
  TEST_ASSERT_FALSE(result.restore);

  // No surface at all (theme not renderable): notice leaves the screen.
  result = Activate(state, Surface::None, 7000);
  TEST_ASSERT_TRUE(result.restore);
  TEST_ASSERT_FALSE(state.active);
}

void testRendersCompactCommandsAndBindings() {
  const char* spec = R"JSON({
    "v": 1,
    "id": "codex-test",
    "rev": 1,
    "bg": "#123456",
    "p": [
      {"t":"tx","x":5,"y":6,"f":2,"s":3,"mw":140,"ft":"shrink","al":"right","c":"#FF00FF","bg":"#000000","v":"{l} {s}/{w} {r} {u} {dt}"},
      {"t":"p","x":9,"y":10,"w":111,"h":12,"br":6,"b":"w","ps":"segments","sg":16,"gg":2,"c":"#00FF00","bg":"#101010","bc":"#FFFFFF"},
      {"t":"g","x":15,"y":16,"w":80,"h":64,"a":"/themes/mini/mini.gif"},
      {"t":"sp","x":17,"y":18,"w":24,"h":14,"a":"/themes/u/cloud.cbi"},
      {"t":"px","x":2,"y":3,"w":4,"h":2,"c":"#FFFFFF","d":"A5"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(6, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_HEX16(0x11AA, sink.commands[0].color);

  const RecordedCommand& text = sink.commands[1];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(text.type));
  TEST_ASSERT_EQUAL_STRING("Codex 97/71 1h 29m remaining 7/5/2026", text.text.c_str());
  TEST_ASSERT_EQUAL_INT(2, text.font);
  TEST_ASSERT_EQUAL_INT(3, text.size);
  TEST_ASSERT_EQUAL_INT(140, text.maxWidth);
  TEST_ASSERT_TRUE(text.fitShrink);
  TEST_ASSERT_EQUAL_INT(2, text.align);
  TEST_ASSERT_EQUAL_HEX16(0xF81F, text.fg);

  const RecordedCommand& progress = sink.commands[2];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Progress), static_cast<int>(progress.type));
  TEST_ASSERT_EQUAL_INT(71, progress.percent);
  TEST_ASSERT_EQUAL_INT(1, progress.style);
  TEST_ASSERT_EQUAL_INT(16, progress.segments);
  TEST_ASSERT_EQUAL_INT(2, progress.segmentGap);
  TEST_ASSERT_EQUAL_INT(6, progress.borderRadius);
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

void testCompactTextWidthMapsToMaxWidthForAlignment() {
  const char* spec = R"JSON({
    "v": 1,
    "id": "codex-test",
    "rev": 1,
    "p": [
      {"t":"tx","x":21,"y":12,"w":198,"b":"l","s":1,"f":4,"al":"center","c":"#FF4FA3"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(2, sink.commands.size());

  const RecordedCommand& text = sink.commands[1];
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(text.type));
  TEST_ASSERT_EQUAL_STRING("Codex", text.text.c_str());
  TEST_ASSERT_EQUAL_INT(21, text.x);
  TEST_ASSERT_EQUAL_INT(12, text.y);
  TEST_ASSERT_EQUAL_INT(198, text.maxWidth);
  TEST_ASSERT_EQUAL_INT(1, text.align);
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
  TEST_ASSERT_TRUE(renderSpec(spec, testFrame(), sink));
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
  TEST_ASSERT_TRUE(renderSpec(spec, testFrame(), sink));
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
  TEST_ASSERT_TRUE(renderSpec(spec, testFrame(), sink));
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
  TEST_ASSERT_TRUE(renderSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_HEX16(0x0000, sink.commands[1].color);
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, sink.commands[2].fg);
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, sink.commands[2].bg);
  TEST_ASSERT_TRUE(sink.commands[2].hasBg);
}

void testAnimatedPrimitivePassRendersOnlyGifsAndAnimatedSpritesWithoutClear() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "primitives": [
      {"type":"rect","x":1,"y":2,"width":3,"height":4,"color":"#FFFFFF"},
      {"type":"gif","x":20,"y":21,"width":22,"height":23,"assetPath":"/themes/demo/loop.gif"},
      {"type":"sprite","x":30,"y":31,"width":32,"height":33,"assetPath":"/themes/demo/hero.cba"},
      {"type":"sprite","x":1,"y":1,"width":10,"height":10,"assetPath":"/themes/demo/static.cbi"},
      {"type":"text","x":5,"y":6,"fontSize":1,"text":"ok"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderAnimatedSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(2, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Gif), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_STRING("/themes/demo/loop.gif", sink.commands[0].assetPath.c_str());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Sprite), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_INT(32, sink.commands[1].width);
  TEST_ASSERT_EQUAL_INT(33, sink.commands[1].height);
  TEST_ASSERT_EQUAL_STRING("/themes/demo/hero.cba", sink.commands[1].assetPath.c_str());
}

void testStaticPrimitivePassSkipsAnimatedAssets() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "bgColor": "#000000",
    "primitives": [
      {"type":"rect","x":1,"y":2,"width":3,"height":4,"color":"#FFFFFF"},
      {"type":"gif","x":20,"y":21,"width":22,"height":23,"assetPath":"/themes/demo/loop.gif"},
      {"type":"sprite","x":30,"y":31,"width":32,"height":33,"assetPath":"/themes/demo/hero.cba"},
      {"type":"sprite","x":40,"y":41,"width":42,"height":43,"assetPath":"/themes/demo/static.cbi"},
      {"type":"text","x":5,"y":6,"fontSize":1,"text":"ok"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderStaticSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(4, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Sprite), static_cast<int>(sink.commands[2].type));
  TEST_ASSERT_EQUAL_STRING("/themes/demo/static.cbi", sink.commands[2].assetPath.c_str());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[3].type));
}

void testStaticPrimitivePassKeepsFullScreenSpriteBehindCenteredLabel() {
  const char* spec = R"JSON({"v":1,"id":"synthwave","rev":1,"p":[{"t":"sp","x":0,"y":0,"w":240,"h":128,"a":"/themes/u/syn-top.cbi"},{"t":"tx","x":21,"y":12,"w":198,"b":"l","s":1,"f":4,"al":"center","c":"#FF4FA3"}],"fb":"mini","bg":"#050014"})JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderStaticSpec(spec, testFrame(), sink));
  TEST_ASSERT_EQUAL_UINT32(3, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Sprite), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_STRING("/themes/u/syn-top.cbi", sink.commands[1].assetPath.c_str());
  TEST_ASSERT_EQUAL_INT(240, sink.commands[1].width);
  TEST_ASSERT_EQUAL_INT(128, sink.commands[1].height);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[2].type));
  TEST_ASSERT_EQUAL_INT(198, sink.commands[2].maxWidth);
  TEST_ASSERT_EQUAL_INT(1, sink.commands[2].align);
}

void testCompiledThemeSpecSeparatesGifAssetsFromAnimatedSprites() {
  const char* gifSpec = R"JSON({
    "v": 1,
    "id": "mini-like",
    "rev": 1,
    "p": [
      {"t":"tx","x":30,"y":10,"w":180,"v":"{label}","al":"center","s":2},
      {"t":"g","x":80,"y":84,"w":80,"h":80,"a":"/themes/u/mini.gif"}
    ]
  })JSON";

  JsonDocument doc;
  CompiledThemeSpec scene;
  TEST_ASSERT_TRUE(CompileThemeSpec(gifSpec, doc, scene));
  TEST_ASSERT_TRUE(scene.hasAnimatedAssets);
  TEST_ASSERT_TRUE(CompiledThemeSpecHasGifAssets(scene));

  RecordingSink gifStaticSink;
  TEST_ASSERT_TRUE(RenderCompiledThemeSpecStaticPrimitives(scene, testFrame(), gifStaticSink));
  TEST_ASSERT_EQUAL_UINT32(2, gifStaticSink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(gifStaticSink.commands[0].type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(gifStaticSink.commands[1].type));

  RecordingSink gifAnimatedSink;
  TEST_ASSERT_TRUE(RenderCompiledThemeSpecAnimatedPrimitives(scene, testFrame(), gifAnimatedSink));
  TEST_ASSERT_EQUAL_UINT32(1, gifAnimatedSink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Gif), static_cast<int>(gifAnimatedSink.commands[0].type));
  TEST_ASSERT_EQUAL_STRING("/themes/u/mini.gif", gifAnimatedSink.commands[0].assetPath.c_str());
  ReleaseCompiledThemeSpec(scene);

  const char* spriteSpec = R"JSON({
    "v": 1,
    "id": "state-sprite-like",
    "rev": 1,
    "p": [
      {"t":"sp","x":0,"y":0,"w":240,"h":240,"a":"/themes/u/bg.cbi"},
      {"t":"sp","x":83,"y":54,"w":74,"h":74,"a":"/themes/u/idle.cba","sa":{"idle":"/themes/u/idle.cba","coding":"/themes/u/coding.cba"}}
    ]
  })JSON";

  TEST_ASSERT_TRUE(CompileThemeSpec(spriteSpec, doc, scene));
  TEST_ASSERT_TRUE(scene.hasAnimatedAssets);
  TEST_ASSERT_FALSE(CompiledThemeSpecHasGifAssets(scene));

  FrameData codingFrame = testFrame();
  codingFrame.activity = "coding";
  RecordingSink spriteAnimatedSink;
  TEST_ASSERT_TRUE(RenderCompiledThemeSpecAnimatedPrimitives(scene, codingFrame, spriteAnimatedSink));
  TEST_ASSERT_EQUAL_UINT32(1, spriteAnimatedSink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Sprite), static_cast<int>(spriteAnimatedSink.commands[0].type));
  TEST_ASSERT_EQUAL_STRING("/themes/u/coding.cba", spriteAnimatedSink.commands[0].assetPath.c_str());
  ReleaseCompiledThemeSpec(scene);
}

void testChangedPrimitivePassReplaysDirtyRegion() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "bgColor": "#000000",
    "primitives": [
      {"type":"rect","x":1,"y":2,"width":3,"height":4,"color":"#FFFFFF"},
      {"type":"gif","x":10,"y":11,"width":12,"height":13,"stateAssets":{"idle":"/themes/demo/idle.gif","coding":"/themes/demo/coding.gif"}},
      {"type":"sprite","x":20,"y":21,"width":22,"height":23,"sa":{"idle":"/themes/demo/idle.cba","coding":"/themes/demo/coding.cba"}},
      {"type":"text","x":30,"y":31,"fontSize":1,"maxWidth":80,"text":"{activity}"},
      {"type":"text","x":40,"y":41,"fontSize":1,"maxWidth":80,"binding":"session"},
      {"type":"progress","x":50,"y":51,"width":52,"height":10}
    ]
  })JSON";

  FrameData codingFrame = testFrame();
  codingFrame.activity = "coding";
  RecordingSink activitySink;
  TEST_ASSERT_TRUE(renderChangedSpec(spec, codingFrame, kThemeSpecFieldActivity, activitySink));
  TEST_ASSERT_EQUAL_UINT32(5, activitySink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::BeginClip), static_cast<int>(activitySink.commands[0].type));
  TEST_ASSERT_EQUAL_INT(10, activitySink.commands[0].x);
  TEST_ASSERT_EQUAL_INT(11, activitySink.commands[0].y);
  TEST_ASSERT_EQUAL_INT(100, activitySink.commands[0].width);
  TEST_ASSERT_EQUAL_INT(33, activitySink.commands[0].height);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(activitySink.commands[1].type));
  TEST_ASSERT_EQUAL_HEX16(0x0000, activitySink.commands[1].color);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(activitySink.commands[2].type));
  TEST_ASSERT_EQUAL_STRING("coding", activitySink.commands[2].text.c_str());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(activitySink.commands[3].type));
  TEST_ASSERT_EQUAL_STRING("97", activitySink.commands[3].text.c_str());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::EndClip), static_cast<int>(activitySink.commands[4].type));

  RecordingSink sessionSink;
  TEST_ASSERT_TRUE(renderChangedSpec(spec, codingFrame, kThemeSpecFieldSession, sessionSink));
  int beginClipCount = 0;
  int endClipCount = 0;
  bool renderedSessionText = false;
  bool renderedSessionProgress = false;
  for (const RecordedCommand& command : sessionSink.commands) {
    beginClipCount += command.type == CommandType::BeginClip ? 1 : 0;
    endClipCount += command.type == CommandType::EndClip ? 1 : 0;
    renderedSessionText = renderedSessionText ||
                          (command.type == CommandType::Text && command.text == "97");
    renderedSessionProgress = renderedSessionProgress ||
                              (command.type == CommandType::Progress && command.percent == 97);
  }
  TEST_ASSERT_EQUAL_INT(2, beginClipCount);
  TEST_ASSERT_EQUAL_INT(2, endClipCount);
  TEST_ASSERT_TRUE(renderedSessionText);
  TEST_ASSERT_TRUE(renderedSessionProgress);
}

void testChangedPrimitivePassReportsSkippedAnimatedOverlap() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "bgColor": "#000000",
    "primitives": [
      {"type":"gif","x":10,"y":10,"width":40,"height":40,"assetPath":"/themes/demo/loop.gif"},
      {"type":"text","x":0,"y":20,"fontSize":2,"maxWidth":80,"binding":"session"}
    ]
  })JSON";

  RecordingSink sink;
  bool skippedAnimated = false;
  TEST_ASSERT_TRUE(renderChangedSpecWithSkippedAnimated(spec, testFrame(), kThemeSpecFieldSession, sink, skippedAnimated));
  TEST_ASSERT_TRUE(skippedAnimated);
  TEST_ASSERT_EQUAL_UINT32(4, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::BeginClip), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[2].type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::EndClip), static_cast<int>(sink.commands[3].type));
}

void testChangedPrimitivePassDoesNotBridgeUnchangedGif() {
  const char* spec = R"JSON({
    "v": 1,
    "id": "usage-around-gif",
    "rev": 1,
    "bg": "#000000",
    "p": [
      {"t":"tx","x":10,"y":20,"w":100,"sl":1,"v":"{usageSlot1Label}","s":1},
      {"t":"g","x":80,"y":80,"w":80,"h":80,"a":"/themes/demo/loop.gif"},
      {"t":"tx","x":20,"y":210,"w":200,"sl":1,"v":"{usageSlot1Reset}","s":1}
    ]
  })JSON";

  FrameData frame = testFrame();
  frame.usageWindows[0].available = true;
  frame.usageWindows[0].label = "Weekly";
  frame.usageWindows[0].resetSecs = 3600;

  RecordingSink sink;
  bool skippedAnimated = false;
  TEST_ASSERT_TRUE(renderChangedSpecWithSkippedAnimated(
      spec,
      frame,
      kThemeSpecFieldUsageWindows,
      sink,
      skippedAnimated));
  TEST_ASSERT_FALSE(skippedAnimated);

  int clipCount = 0;
  for (const RecordedCommand& command : sink.commands) {
    if (command.type == CommandType::BeginClip) {
      ++clipCount;
      const bool overlapsGif = command.x < 160 &&
                               80 < command.x + command.width &&
                               command.y < 160 &&
                               80 < command.y + command.height;
      TEST_ASSERT_FALSE(overlapsGif);
    }
    TEST_ASSERT_NOT_EQUAL(static_cast<int>(CommandType::Gif), static_cast<int>(command.type));
  }
  TEST_ASSERT_EQUAL_INT(2, clipCount);
}

void testChangedPrimitivePassUsesThemeBackgroundAndOverlaps() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "bgColor": "#FFFFFF",
    "primitives": [
      {"type":"sprite","x":0,"y":0,"width":96,"height":48,"assetPath":"/themes/demo/bright-bg.cbi"},
      {"type":"text","x":10,"y":8,"fontSize":1,"maxWidth":36,"binding":"session","color":"#000000"},
      {"type":"progress","x":8,"y":18,"width":52,"height":10,"binding":"session","color":"#00FF00","bgColor":"#FFFFFF"}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderChangedSpec(spec, testFrame(), kThemeSpecFieldSession, sink));
  TEST_ASSERT_EQUAL_UINT32(6, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::BeginClip), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_INT(8, sink.commands[0].x);
  TEST_ASSERT_EQUAL_INT(8, sink.commands[0].y);
  TEST_ASSERT_EQUAL_INT(52, sink.commands[0].width);
  TEST_ASSERT_EQUAL_INT(20, sink.commands[0].height);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, sink.commands[1].color);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Sprite), static_cast<int>(sink.commands[2].type));
  TEST_ASSERT_EQUAL_STRING("/themes/demo/bright-bg.cbi", sink.commands[2].assetPath.c_str());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[3].type));
  TEST_ASSERT_EQUAL_STRING("97", sink.commands[3].text.c_str());
  TEST_ASSERT_FALSE(sink.commands[3].hasBg);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Progress), static_cast<int>(sink.commands[4].type));
  TEST_ASSERT_EQUAL_INT(97, sink.commands[4].percent);
  TEST_ASSERT_EQUAL_HEX16(0xFFFF, sink.commands[4].bg);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::EndClip), static_cast<int>(sink.commands[5].type));
}

void testChangedLabelPassUsesRenderedFontHeightForProviderLabel() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "bgColor": "#000000",
    "primitives": [
      {"type":"text","x":21,"y":12,"font":4,"fontSize":1,"maxWidth":198,"binding":"label","align":"center"}
    ]
  })JSON";

  FrameData frame = testFrame();

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderChangedSpec(spec, frame, kThemeSpecFieldLabel, sink));
  TEST_ASSERT_EQUAL_UINT32(4, sink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::BeginClip), static_cast<int>(sink.commands[0].type));
  TEST_ASSERT_EQUAL_INT(21, sink.commands[0].x);
  TEST_ASSERT_EQUAL_INT(12, sink.commands[0].y);
  TEST_ASSERT_EQUAL_INT(198, sink.commands[0].width);
  TEST_ASSERT_EQUAL_INT(30, sink.commands[0].height);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillRect), static_cast<int>(sink.commands[1].type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Text), static_cast<int>(sink.commands[2].type));
  TEST_ASSERT_EQUAL_STRING("Codex", sink.commands[2].text.c_str());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::EndClip), static_cast<int>(sink.commands[3].type));
}

void testChangedPrimitivePassHandlesCompactClippySpec() {
  const char* spec = R"JSON({"v":1,"id":"clippy","rev":1,"p":[{"t":"sp","x":0,"y":0,"w":240,"h":240,"a":"/themes/u/cp-bg.cbi"},{"t":"tx","x":26,"y":28,"v":"{label} Usage","s":2,"f":2,"c":"#FFFFFF"},{"t":"sp","x":83,"y":54,"w":74,"h":74,"bg":"#C6C3BD","a":"/themes/u/cp-i.cba","sa":{"idle":"/themes/u/cp-i.cba","coding":"/themes/u/cp-c.cba"}},{"t":"p","x":27,"y":166,"w":146,"h":14,"b":"s","ps":"segments","sg":28,"gg":1,"c":"#0FA514","bg":"#DAD7D0","bc":"#FFFFFF"},{"t":"tx","x":181,"y":158,"v":"{session}%","s":2,"f":2,"c":"#111111"},{"t":"tx","x":172,"y":178,"v":"remaining","s":1,"f":2,"c":"#111111"},{"t":"p","x":27,"y":212,"w":146,"h":14,"b":"w","ps":"segments","sg":28,"gg":1,"c":"#0FA514","bg":"#DAD7D0","bc":"#FFFFFF"},{"t":"tx","x":181,"y":204,"v":"{weekly}%","s":2,"f":2,"c":"#111111"},{"t":"tx","x":172,"y":224,"v":"remaining","s":1,"f":2,"c":"#111111"}],"fb":"mini","bg":"#000000"})JSON";

  FrameData frame = testFrame();
  frame.activity = "coding";
  frame.session = 61;
  frame.weekly = 76;

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderChangedSpec(
      spec,
      frame,
      kThemeSpecFieldActivity | kThemeSpecFieldSession | kThemeSpecFieldWeekly,
      sink));
  TEST_ASSERT_TRUE(sink.commands.size() > 4);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::BeginClip), static_cast<int>(sink.commands.front().type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::EndClip), static_cast<int>(sink.commands.back().type));
}

void testClippyIdleToCodingWeeklyPartialKeepsBackgroundDecodeClipped() {
  const char* spec = R"JSON({"v":1,"id":"clippy","rev":1,"p":[{"t":"sp","x":0,"y":0,"w":240,"h":240,"a":"/themes/u/cp-bg.cbi"},{"t":"sp","x":83,"y":54,"w":74,"h":74,"bg":"#C6C3BD","a":"/themes/u/cp-i.cba","sa":{"idle":"/themes/u/cp-i.cba","coding":"/themes/u/cp-c.cba"}},{"t":"p","x":27,"y":212,"w":146,"h":14,"b":"w"},{"t":"tx","x":181,"y":204,"v":"{weekly}%","s":2}],"fb":"mini","bg":"#000000"})JSON";

  FrameData codingFrame = testFrame();
  codingFrame.activity = "coding";
  codingFrame.weekly = 75;

  RecordingSink sink;
  bool skippedAnimated = false;
  TEST_ASSERT_TRUE(renderChangedSpecWithSkippedAnimated(
      spec,
      codingFrame,
      kThemeSpecFieldActivity | kThemeSpecFieldWeekly,
      sink,
      skippedAnimated));
  TEST_ASSERT_TRUE(skippedAnimated);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::BeginClip), static_cast<int>(sink.commands.front().type));
  TEST_ASSERT_EQUAL_INT(27, sink.commands.front().x);
  TEST_ASSERT_EQUAL_INT(54, sink.commands.front().y);
  TEST_ASSERT_EQUAL_INT(213, sink.commands.front().width);
  TEST_ASSERT_EQUAL_INT(172, sink.commands.front().height);

  int backgroundSpriteCount = 0;
  for (const RecordedCommand& command : sink.commands) {
    if (command.type == CommandType::Sprite && command.assetPath == "/themes/u/cp-bg.cbi") {
      ++backgroundSpriteCount;
    }
  }
  TEST_ASSERT_EQUAL_INT(1, backgroundSpriteCount);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::EndClip), static_cast<int>(sink.commands.back().type));

  // The ESP8266 sink uses this dirty clip to decode only intersecting CBI rows.
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ScaledSpriteRowIntersectsClip(0, 105, 0, 240, 54, 172));
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::ScaledSpriteRowIntersectsClip(24, 105, 0, 240, 54, 172));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ScaledSpriteRowIntersectsClip(104, 105, 0, 240, 54, 172));
}

void testCompiledThemeSpecFullPartialAndAnimatedPasses() {
  const char* spec = R"JSON({"v":1,"id":"clippy","rev":1,"p":[{"t":"sp","x":0,"y":0,"w":240,"h":240,"a":"/themes/u/cp-bg.cbi"},{"t":"tx","x":26,"y":28,"v":"{label} Usage","s":2,"f":2,"c":"#FFFFFF"},{"t":"sp","x":83,"y":54,"w":74,"h":74,"bg":"#C6C3BD","a":"/themes/u/cp-i.cba","sa":{"idle":"/themes/u/cp-i.cba","coding":"/themes/u/cp-c.cba"}},{"t":"p","x":27,"y":166,"w":146,"h":14,"b":"s","ps":"segments","sg":28,"gg":1,"c":"#0FA514","bg":"#DAD7D0","bc":"#FFFFFF"},{"t":"tx","x":181,"y":158,"v":"{session}%","s":2,"f":2,"c":"#111111"},{"t":"tx","x":172,"y":178,"v":"remaining","s":1,"f":2,"c":"#111111"},{"t":"p","x":27,"y":212,"w":146,"h":14,"b":"w","ps":"segments","sg":28,"gg":1,"c":"#0FA514","bg":"#DAD7D0","bc":"#FFFFFF"},{"t":"tx","x":181,"y":204,"v":"{weekly}%","s":2,"f":2,"c":"#111111"},{"t":"tx","x":172,"y":224,"v":"remaining","s":1,"f":2,"c":"#111111"}],"fb":"mini","bg":"#000000"})JSON";

  JsonDocument doc;
  CompiledThemeSpec scene;
  TEST_ASSERT_TRUE(CompileThemeSpec(spec, doc, scene));
  TEST_ASSERT_EQUAL_UINT32(9, scene.primitiveCount);
  TEST_ASSERT_TRUE(scene.hasAnimatedAssets);
  TEST_ASSERT_FALSE(scene.requiresJsonDocument);

  FrameData frame = testFrame();
  frame.activity = "coding";
  frame.session = 61;
  frame.weekly = 76;

  RecordingSink fullSink;
  TEST_ASSERT_TRUE(RenderCompiledThemeSpec(scene, frame, fullSink));
  TEST_ASSERT_EQUAL_UINT32(10, fullSink.commands.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::FillScreen), static_cast<int>(fullSink.commands[0].type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::Sprite), static_cast<int>(fullSink.commands[1].type));
  TEST_ASSERT_EQUAL_STRING("/themes/u/cp-bg.cbi", fullSink.commands[1].assetPath.c_str());
  TEST_ASSERT_EQUAL_STRING("/themes/u/cp-c.cba", fullSink.commands[3].assetPath.c_str());

  RecordingSink animatedSink;
  TEST_ASSERT_TRUE(RenderCompiledThemeSpecAnimatedPrimitives(scene, frame, animatedSink));
  TEST_ASSERT_EQUAL_UINT32(1, animatedSink.commands.size());
  TEST_ASSERT_EQUAL_STRING("/themes/u/cp-c.cba", animatedSink.commands[0].assetPath.c_str());

  RecordingSink partialSink;
  TEST_ASSERT_TRUE(RenderCompiledThemeSpecChangedPrimitives(
      scene,
      frame,
      kThemeSpecFieldActivity | kThemeSpecFieldSession | kThemeSpecFieldWeekly,
      partialSink));
  TEST_ASSERT_TRUE(partialSink.commands.size() > 4);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::BeginClip), static_cast<int>(partialSink.commands.front().type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::EndClip), static_cast<int>(partialSink.commands.back().type));
  ReleaseCompiledThemeSpec(scene);
}

void testChangedPrimitivePassReportsNoAffectedPrimitiveForUnusedReset() {
  const char* spec = R"JSON({"v":1,"id":"clippy","rev":1,"p":[{"t":"sp","x":0,"y":0,"w":240,"h":240,"a":"/themes/u/cp-bg.cbi"},{"t":"sp","x":83,"y":54,"w":74,"h":74,"bg":"#C6C3BD","a":"/themes/u/cp-i.cba","sa":{"idle":"/themes/u/cp-i.cba","coding":"/themes/u/cp-c.cba"}},{"t":"p","x":27,"y":166,"w":146,"h":14,"b":"s"},{"t":"tx","x":181,"y":158,"v":"{session}%","s":2},{"t":"p","x":27,"y":212,"w":146,"h":14,"b":"w"},{"t":"tx","x":181,"y":204,"v":"{weekly}%","s":2}],"fb":"mini","bg":"#000000"})JSON";

  RecordingSink sink;
  const char* error = "";
  TEST_ASSERT_FALSE(renderChangedSpecWithError(spec, testFrame(), kThemeSpecFieldReset, sink, error));
  TEST_ASSERT_EQUAL_STRING("no_affected_primitive", error);
  TEST_ASSERT_EQUAL_UINT32(0, sink.commands.size());
}

void testChangedPrimitivePassHandlesTextWithoutMaxWidth() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-test",
    "themeRev": 1,
    "primitives": [
      {"type":"text","x":1,"y":2,"fontSize":1,"text":"{session}%"},
      {"type":"progress","x":5,"y":6,"width":20,"height":8}
    ]
  })JSON";

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderChangedSpec(spec, testFrame(), kThemeSpecFieldSession, sink));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::BeginClip), static_cast<int>(sink.commands.front().type));
  TEST_ASSERT_EQUAL_INT(1, sink.commands.front().x);
  TEST_ASSERT_EQUAL_INT(239, sink.commands.front().width);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::EndClip), static_cast<int>(sink.commands.back().type));
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
  TEST_ASSERT_TRUE(renderSpec(spec, codingFrame, codingSink));
  TEST_ASSERT_EQUAL_STRING("/themes/demo/coding.gif", codingSink.commands[1].assetPath.c_str());
  TEST_ASSERT_EQUAL_STRING("/themes/demo/coding.cba", codingSink.commands[2].assetPath.c_str());

  FrameData waitingFrame = testFrame();
  waitingFrame.activity = "waiting";
  RecordingSink waitingSink;
  TEST_ASSERT_TRUE(renderSpec(spec, waitingFrame, waitingSink));
  TEST_ASSERT_EQUAL_STRING("/themes/demo/idle.gif", waitingSink.commands[1].assetPath.c_str());
  TEST_ASSERT_EQUAL_STRING("/themes/demo/idle.cba", waitingSink.commands[2].assetPath.c_str());
}

void testStateAnimatedSpriteActivityChangeRedrawsAnimatedPass() {
  const char* spec = R"JSON({
    "themeSpecVersion": 1,
    "themeId": "codex-state-sprite",
    "themeRev": 1,
    "bgColor": "#000000",
    "primitives": [
      {"type":"sprite","x":0,"y":0,"width":240,"height":240,"assetPath":"/themes/demo/bg.cbi"},
      {"type":"sprite","x":83,"y":54,"width":74,"height":74,"assetPath":"/themes/demo/idle.cba","stateAssets":{"idle":"/themes/demo/idle.cba","coding":"/themes/demo/coding.cba"}}
    ]
  })JSON";

  FrameData idleFrame = testFrame();
  idleFrame.activity = "idle";
  RecordingSink idleAnimatedSink;
  TEST_ASSERT_TRUE(renderAnimatedSpec(spec, idleFrame, idleAnimatedSink));
  TEST_ASSERT_EQUAL_UINT32(1, idleAnimatedSink.commands.size());
  TEST_ASSERT_EQUAL_STRING("/themes/demo/idle.cba", idleAnimatedSink.commands[0].assetPath.c_str());

  FrameData codingFrame = testFrame();
  codingFrame.activity = "coding";
  RecordingSink changedSink;
  bool skippedAnimated = false;
  TEST_ASSERT_TRUE(renderChangedSpecWithSkippedAnimated(
      spec,
      codingFrame,
      kThemeSpecFieldActivity,
      changedSink,
      skippedAnimated));
  TEST_ASSERT_TRUE(skippedAnimated);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::BeginClip), static_cast<int>(changedSink.commands.front().type));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CommandType::EndClip), static_cast<int>(changedSink.commands.back().type));

  RecordingSink codingAnimatedSink;
  TEST_ASSERT_TRUE(renderAnimatedSpec(spec, codingFrame, codingAnimatedSink));
  TEST_ASSERT_EQUAL_UINT32(1, codingAnimatedSink.commands.size());
  TEST_ASSERT_EQUAL_STRING("/themes/demo/coding.cba", codingAnimatedSink.commands[0].assetPath.c_str());
}

void testFrameActivityDefaultsToCodingWhenUsageChanges() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_EQUAL_STRING("idle", state.current.activity.c_str());
  TEST_ASSERT_FALSE(event.usageProgressed);

  const char* idleFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, idleFrame, 2000, event));
  TEST_ASSERT_EQUAL_STRING("idle", state.current.activity.c_str());
  TEST_ASSERT_FALSE(event.usageProgressed);

  const char* codingFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, codingFrame, 3000, event));
  TEST_ASSERT_EQUAL_STRING("coding", state.current.activity.c_str());
  TEST_ASSERT_TRUE(event.usageProgressed);
}

void testUsageProgressIgnoresTokenHistoryExpiryAndRestore() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame =
      R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));

  const char* expiredFrame =
      R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":0,"weekTokens":0,"totalTokens":0})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, expiredFrame, 2000, event));
  TEST_ASSERT_FALSE(event.usageProgressed);

  const char* restoredFrame =
      R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, restoredFrame, 3000, event));
  TEST_ASSERT_FALSE(event.usageProgressed);

  const char* usageMoved =
      R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, usageMoved, 4000, event));
  TEST_ASSERT_TRUE(event.usageProgressed);
}

// Standby's activity clock hangs on this event, so a frame that only claims to
// be coding, or an error frame, must not count as activity.
void testUsageProgressEventIgnoresDeclaredActivityAndErrors() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));

  const char* declaredCoding = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300,"activity":"coding"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, declaredCoding, 2000, event));
  TEST_ASSERT_EQUAL_STRING("coding", state.current.activity.c_str());
  TEST_ASSERT_FALSE(event.usageProgressed);

  const char* errorFrame = R"JSON({"v":2,"error":"runtime/cycle-timeout","session":80,"weekly":90})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, errorFrame, 3000, event));
  TEST_ASSERT_TRUE(state.current.hasError);
  TEST_ASSERT_FALSE(event.usageProgressed);
}

void testUsageProgressEventIgnoresDisplayOnlyUsageChanges() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":7200,"sessionTokens":100,"weekTokens":200,"totalTokens":300,"usageWindows":[{"id":"five-hour","label":"5-hour","percent":25,"resetSecs":7200}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));

  const char* displayOnlyChange = R"JSON({"v":2,"provider":"codex","label":"Codex refreshed","session":10,"weekly":20,"resetSecs":7199,"sessionTokens":100,"weekTokens":200,"totalTokens":300,"usageWindows":[{"id":"five-hour","label":"5-hour refreshed","percent":25,"resetSecs":7199}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, displayOnlyChange, 2000, event));
  TEST_ASSERT_FALSE(event.usageProgressed);
  TEST_ASSERT_EQUAL_STRING("idle", state.current.activity.c_str());

  const char* unavailable = R"JSON({"v":2,"provider":"codex","label":"Usage unavailable","session":0,"weekly":0,"resetSecs":7198,"sessionTokens":100,"weekTokens":200,"totalTokens":300,"usageUnavailable":true,"sessionUnavailable":true,"weeklyUnavailable":true})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, unavailable, 3000, event));
  TEST_ASSERT_FALSE(event.usageProgressed);

  const char* restored = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":7197,"sessionTokens":100,"weekTokens":200,"totalTokens":300,"usageWindows":[{"id":"five-hour","label":"5-hour","percent":25,"resetSecs":7197}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, restored, 4000, event));
  TEST_ASSERT_FALSE(event.usageProgressed);

  const char* usageMoved = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":7196,"sessionTokens":100,"weekTokens":200,"totalTokens":300,"usageWindows":[{"id":"five-hour","label":"5-hour","percent":26,"resetSecs":7196}]})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, usageMoved, 5000, event));
  TEST_ASSERT_TRUE(event.usageProgressed);
}

void testThemeSpecActivityChangeUsesPartialRenderEvent() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300,"themeSpec":{"themeSpecVersion":1,"themeId":"codex-state-assets","themeRev":1,"primitives":[{"type":"sprite","x":1,"y":2,"width":3,"height":4,"stateAssets":{"idle":"/themes/demo/idle.cba","coding":"/themes/demo/coding.cba"}}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_FALSE(event.themeSpecPartialRender);
  TEST_ASSERT_EQUAL_STRING("idle", state.current.activity.c_str());

  const char* codingFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"sessionTokens":100,"weekTokens":200,"totalTokens":300,"activity":"coding"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, codingFrame, 2000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecCacheHit);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
  TEST_ASSERT_EQUAL_UINT32(kThemeSpecFieldActivity, event.themeSpecChangedFields);
  TEST_ASSERT_EQUAL_STRING("coding", state.current.activity.c_str());
}

void testLegacyThemeFieldsAreIgnored() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"theme":"mini","fb":"mini","themeSpec":{"v":1,"id":"mini-transport","rev":1,"p":[{"t":"tx","x":1,"y":2,"s":1,"v":"{session}%"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_EQUAL_STRING("mini-transport", state.current.themeSpecId.c_str());

  const char* nextFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":20,"theme":"crt","fb":"classic"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, nextFrame, 2000, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_EQUAL_STRING("mini-transport", state.current.themeSpecId.c_str());
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
}

void testStoredThemeActivationLiveFrameUsesPartialRenderEvent() {
  RuntimeState state;
  state.cachedThemeId = "clippy";
  state.cachedThemeRev = 1;
  state.cachedThemeSpecRaw = R"JSON({"v":1,"id":"clippy","rev":1,"p":[{"t":"sp","x":0,"y":0,"w":240,"h":240,"a":"/themes/u/cp-bg.cbi"},{"t":"sp","x":83,"y":54,"w":74,"h":74,"a":"/themes/u/cp-i.cba","sa":{"idle":"/themes/u/cp-i.cba","coding":"/themes/u/cp-c.cba"}},{"t":"p","x":27,"y":166,"w":146,"h":14,"b":"s"},{"t":"tx","x":181,"y":158,"v":"{session}%","s":2}],"fb":"mini","bg":"#000000"})JSON";
  state.current.provider = "codex";
  state.current.label = "Codex";
  state.current.session = 10;
  state.current.weekly = 20;
  state.current.resetSecs = 3600;
  state.current.activity = "idle";
  state.current.hasThemeSpec = true;
  state.current.themeSpecId = "clippy";
  state.current.themeSpecRev = 1;
  state.current.themeSpecRaw = "";
  state.hasFrame = true;

  SerialConsumeEvent event;
  const char* liveFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":20,"resetSecs":3600,"usageMode":"remaining","activity":"coding"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, liveFrame, 2000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecCacheHit);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
}

void testStoredThemeBootActivationRestoresFrameAndFullRenderIntent() {
  RuntimeState state;
  SerialConsumeEvent event;
  const char* raw = R"JSON({"v":1,"id":"clippy","rev":7,"p":[{"t":"tx","x":1,"y":2,"s":1,"v":"{session}%"}]})JSON";

  TEST_ASSERT_TRUE(RestoreStoredThemeSpecFrame(state, "clippy", 7, raw, 4000, event));
  TEST_ASSERT_TRUE(state.hasFrame);
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_EQUAL_STRING("clippy", state.current.themeSpecId.c_str());
  TEST_ASSERT_EQUAL_INT(7, state.current.themeSpecRev);
  TEST_ASSERT_EQUAL_STRING("clippy", state.cachedThemeId.c_str());
  TEST_ASSERT_EQUAL_INT(7, state.cachedThemeRev);
  TEST_ASSERT_TRUE(ThemeSpecRawForFrame(state, state.current).indexOf("{session}%") >= 0);
  TEST_ASSERT_TRUE(event.frameAccepted);
  TEST_ASSERT_TRUE(event.themeSpecChanged);
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_FALSE(event.themeSpecPartialRender);
}

void testStoredThemeBootActivationRejectsInvalidRaw() {
  RuntimeState emptyState;
  SerialConsumeEvent event;

  TEST_ASSERT_FALSE(RestoreStoredThemeSpecFrame(emptyState, "clippy", 7, "{}", 4000, event));
  TEST_ASSERT_FALSE(emptyState.hasFrame);
  TEST_ASSERT_FALSE(emptyState.current.hasThemeSpec);
  TEST_ASSERT_FALSE(event.frameAccepted);

  TEST_ASSERT_FALSE(RestoreStoredThemeSpecFrame(
      emptyState,
      "clippy",
      7,
      R"JSON({"v":1,"id":"clippy","rev":7,"p":[]})JSON",
      4000,
      event));
  TEST_ASSERT_FALSE(RestoreStoredThemeSpecFrame(
      emptyState,
      "clippy",
      7,
      R"JSON({"v":1,"id":"clippy","rev":7,"p":[{"t":"unsupported"}]})JSON",
      4000,
      event));
  TEST_ASSERT_FALSE(emptyState.hasFrame);
  TEST_ASSERT_FALSE(emptyState.current.hasThemeSpec);

  RuntimeState state;
  state.hasFrame = true;
  state.current.session = 42;
  state.current.hasThemeSpec = true;
  state.current.themeSpecId = "keep";
  state.current.themeSpecRev = 3;
  state.cachedThemeId = "keep";
  state.cachedThemeRev = 3;

  TEST_ASSERT_FALSE(RestoreStoredThemeSpecFrame(
      state, "screensaver", 1, "GIF89a", 5000, event));
  TEST_ASSERT_EQUAL_INT(42, state.current.session);
  TEST_ASSERT_EQUAL_STRING("keep", state.current.themeSpecId.c_str());
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_FALSE(event.frameAccepted);

  TEST_ASSERT_FALSE(RestoreStoredThemeSpecFrame(
      state, "screensaver", 1, "CBA1\n240 240\n", 6000, event));
  TEST_ASSERT_EQUAL_INT(42, state.current.session);
  TEST_ASSERT_EQUAL_STRING("keep", state.current.themeSpecId.c_str());
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_FALSE(event.frameAccepted);

  const char* metadataOnly = R"JSON({"id":"x","rev":1})JSON";
  TEST_ASSERT_FALSE(RestoreStoredThemeSpecFrame(
      state, "screensaver", 1, metadataOnly, 7000, event));
  TEST_ASSERT_EQUAL_INT(42, state.current.session);
  TEST_ASSERT_EQUAL_STRING("keep", state.current.themeSpecId.c_str());
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_FALSE(event.frameAccepted);
}

void testThemeSpecErrorFrameUsesFullRender() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":3600,"themeSpec":{"v":1,"id":"mini-transport","rev":1,"p":[{"t":"tx","x":1,"y":2,"s":1,"v":"cached"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_FALSE(state.current.hasError);
  TEST_ASSERT_TRUE(state.cachedThemeSpecRaw.indexOf("cached") >= 0);

  const char* errorFrame = R"JSON({"v":2,"error":"runtime/cycle-timeout"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, errorFrame, 2000, event));
  TEST_ASSERT_TRUE(state.current.hasError);
  TEST_ASSERT_FALSE(state.current.hasThemeSpec);
  TEST_ASSERT_FALSE(event.themeSpecCacheHit);
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_FALSE(event.themeSpecPartialRender);
}

void testThemeSpecErrorFrameDoesNotReplaceItselfWithCachedTheme() {
  RuntimeState state;
  SerialConsumeEvent event;
  state.cachedThemeId = "mini-transport";
  state.cachedThemeRev = 1;
  state.cachedThemeSpecRaw = R"JSON({"v":1,"id":"mini-transport","rev":1,"p":[{"t":"tx","x":1,"y":2,"s":1,"v":"cached"}]})JSON";
  state.current.provider = "codex";
  state.current.label = "Codex";
  state.hasFrame = true;

  const char* errorFrame = R"JSON({"v":2,"error":"runtime/cycle-timeout"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, errorFrame, 2000, event));
  TEST_ASSERT_TRUE(state.current.hasError);
  TEST_ASSERT_FALSE(state.current.hasThemeSpec);
  TEST_ASSERT_FALSE(event.themeSpecCacheHit);
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_FALSE(event.themeSpecPartialRender);
}

void testClippyLikeThemeSpecPartialEventCoversStateProgressAndReset() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":3600,"activity":"idle","usageMode":"remaining","themeSpec":{"v":1,"id":"clippy-like","rev":1,"p":[{"t":"sp","x":0,"y":0,"w":240,"h":240,"a":"/themes/u/cp-bg.cbi"},{"t":"sp","x":83,"y":54,"w":74,"h":74,"a":"/themes/u/cp-i.cba","sa":{"idle":"/themes/u/cp-i.cba","coding":"/themes/u/cp-c.cba"}},{"t":"p","x":27,"y":166,"w":146,"h":14,"b":"s"},{"t":"tx","x":181,"y":158,"v":"{session}%","s":2},{"t":"p","x":27,"y":212,"w":146,"h":14,"b":"w"},{"t":"tx","x":181,"y":204,"v":"{weekly}%","s":2},{"t":"tx","x":27,"y":230,"v":"{reset}","s":1}],"fb":"mini","bg":"#000000"}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_FALSE(event.themeSpecPartialRender);

  const char* liveFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":21,"resetSecs":3540,"activity":"coding","usageMode":"remaining"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, liveFrame, 2000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecCacheHit);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
  TEST_ASSERT_EQUAL_UINT32(
      kThemeSpecFieldActivity | kThemeSpecFieldSession | kThemeSpecFieldWeekly | kThemeSpecFieldReset,
      event.themeSpecChangedFields);

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderChangedSpec(
      state.cachedThemeSpecRaw.c_str(),
      testFrame(),
      event.themeSpecChangedFields,
      sink));
}

void testThemeSpecIgnoresUpdateMetadataForVisualDirty() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":300,"update":{"available":false,"status":"current","latestVersion":"1.0.17"},"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"progress","x":0,"y":0,"width":80,"height":8,"binding":"session"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);

  const char* updateOnlyFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":300,"update":{"available":false,"status":"current","latestVersion":"1.0.18"}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, updateOnlyFrame, 2000, event));
  TEST_ASSERT_FALSE(event.visualChanged);
  TEST_ASSERT_FALSE(event.themeSpecPartialRender);

  const char* liveAndUpdateFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":20,"resetSecs":300,"update":{"available":false,"status":"current","latestVersion":"1.0.19"}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, liveAndUpdateFrame, 3000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
  TEST_ASSERT_TRUE(event.themeSpecChangedFields & kThemeSpecFieldSession);
}

void testThemeSpecCacheCarriesLayoutAcrossLiveFrames() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* studioFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":94,"weekly":87,"resetSecs":5394,"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":1,"y":2,"fontSize":1,"text":"{session}%"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, studioFrame, 1000, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_EQUAL_STRING("mini-transport", state.current.themeSpecId.c_str());
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("{session}%") >= 0);

  const char* liveFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":96,"weekly":99,"resetSecs":4200,"usageMode":"remaining","theme":"mini"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, liveFrame, 2000, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_TRUE(event.themeSpecCacheHit);
  TEST_ASSERT_EQUAL_INT(96, state.current.session);
  TEST_ASSERT_EQUAL_INT(99, state.current.weekly);
  TEST_ASSERT_EQUAL_STRING("mini-transport", state.current.themeSpecId.c_str());
  TEST_ASSERT_EQUAL_INT(0, state.current.themeSpecRaw.length());
  TEST_ASSERT_TRUE(ThemeSpecRawForFrame(state, state.current).indexOf("{session}%") >= 0);
}

void testCompactThemeSpecFrameIsCached() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* frame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":94,"weekly":87,"resetSecs":5394,"themeSpec":{"v":1,"id":"mini-transport","rev":1,"fb":"mini","p":[{"t":"tx","x":1,"y":2,"s":1,"v":"{s}%"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, frame, 1000, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_EQUAL_STRING("mini-transport", state.current.themeSpecId.c_str());
  TEST_ASSERT_EQUAL_INT(1, state.current.themeSpecRev);
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("\"t\":\"tx\"") >= 0);
}

void testThemeSpecUpdateAvailabilityDirtiesOnlyLabelField() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":300,"update":{"available":false,"status":"current","latestVersion":"1.0.17"},"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":0,"y":0,"binding":"label"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);

  const char* updateFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":300,"update":{"available":true,"status":"update_available","latestVersion":"1.0.20"}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, updateFrame, 2000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
  TEST_ASSERT_EQUAL_UINT32(kThemeSpecFieldLabel, event.themeSpecChangedFields);
}

void testThemeSpecMissingUpdateAfterAvailableDirtiesLabelField() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":300,"update":{"available":true,"status":"update_available","latestVersion":"1.0.20"},"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":0,"y":0,"binding":"label"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_TRUE(state.current.updateAvailable);

  const char* liveFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":300})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, liveFrame, 2000, event));
  TEST_ASSERT_TRUE(event.visualChanged);
  TEST_ASSERT_TRUE(event.themeSpecPartialRender);
  TEST_ASSERT_EQUAL_UINT32(kThemeSpecFieldLabel, event.themeSpecChangedFields);
  TEST_ASSERT_FALSE(state.current.hasUpdateAvailable);
  TEST_ASSERT_FALSE(state.current.updateAvailable);
}

void testThemeSpecCacheUpdatesRawWhenSameRevisionIsResent() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":30,"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":1,"y":2,"fontSize":1,"text":"first"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("first") >= 0);

  const char* editedFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":21,"resetSecs":31,"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":1,"y":2,"fontSize":1,"text":"edited"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, editedFrame, 2000, event));
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("edited") >= 0);

  const char* liveFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":12,"weekly":22,"resetSecs":32})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, liveFrame, 3000, event));
  TEST_ASSERT_EQUAL_INT(0, state.current.themeSpecRaw.length());
  TEST_ASSERT_TRUE(ThemeSpecRawForFrame(state, state.current).indexOf("edited") >= 0);
  TEST_ASSERT_FALSE(ThemeSpecRawForFrame(state, state.current).indexOf("first") >= 0);
}

void testThemeSpecMetadataOnlyFrameKeepsPreviousRenderableRaw() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":30,"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":1,"y":2,"fontSize":1,"text":"cached"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("cached") >= 0);

  state.cachedThemeId = "";
  state.cachedThemeRev = 0;
  state.cachedThemeSpecRaw = "";

  const char* metadataOnlyFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":20,"resetSecs":30,"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, metadataOnlyFrame, 2000, event));
  TEST_ASSERT_TRUE(event.themeSpecCacheHit);
  TEST_ASSERT_EQUAL_INT(0, state.current.themeSpecRaw.length());
  TEST_ASSERT_TRUE(ThemeSpecRawForFrame(state, state.current).indexOf("cached") >= 0);
}

void testUnknownMetadataOnlyThemeSpecDoesNotBlankPreviousRenderableRaw() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* firstFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":30,"themeSpec":{"themeSpecVersion":1,"themeId":"clippy","themeRev":1,"primitives":[{"type":"text","x":1,"y":2,"fontSize":1,"text":"cached"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, firstFrame, 1000, event));
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("cached") >= 0);

  const char* metadataOnlyFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":20,"resetSecs":30,"themeSpec":{"themeSpecVersion":1,"themeId":"clippy","themeRev":2}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, metadataOnlyFrame, 2000, event));
  TEST_ASSERT_TRUE(event.themeSpecCacheHit);
  TEST_ASSERT_EQUAL_STRING("clippy", state.current.themeSpecId.c_str());
  TEST_ASSERT_EQUAL_INT(1, state.current.themeSpecRev);
  TEST_ASSERT_EQUAL_INT(0, state.current.themeSpecRaw.length());
  TEST_ASSERT_TRUE(ThemeSpecRawForFrame(state, state.current).indexOf("cached") >= 0);
}

void testUnconfirmedThemeSpecNullKeepsCachedLayout() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* studioFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":30,"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":1,"y":2,"fontSize":1,"text":"cached"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, studioFrame, 1000, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("cached") >= 0);

  const char* accidentalClearFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":21,"resetSecs":31,"theme":"mini","themeSpec":null})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, accidentalClearFrame, 2000, event));
  TEST_ASSERT_FALSE(event.themeSpecChanged);
  TEST_ASSERT_TRUE(event.themeSpecCacheHit);
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_EQUAL_STRING("mini-transport", state.current.themeSpecId.c_str());
  TEST_ASSERT_EQUAL_INT(0, state.current.themeSpecRaw.length());
  TEST_ASSERT_TRUE(ThemeSpecRawForFrame(state, state.current).indexOf("cached") >= 0);
}

void testConfirmedThemeSpecNullClearsCachedLayout() {
  RuntimeState state;
  SerialConsumeEvent event;

  const char* studioFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"weekly":20,"resetSecs":30,"themeSpec":{"themeSpecVersion":1,"themeId":"mini-transport","themeRev":1,"primitives":[{"type":"text","x":1,"y":2,"fontSize":1,"text":"cached"}]}})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, studioFrame, 1000, event));
  TEST_ASSERT_TRUE(state.current.hasThemeSpec);
  TEST_ASSERT_TRUE(state.current.themeSpecRaw.indexOf("cached") >= 0);

  const char* clearFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":11,"weekly":21,"resetSecs":31,"theme":"mini","themeSpec":null,"confirmClearThemeSpec":true})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, clearFrame, 2000, event));
  TEST_ASSERT_TRUE(event.themeSpecChanged);
  TEST_ASSERT_FALSE(event.themeSpecCacheHit);
  TEST_ASSERT_FALSE(state.current.hasThemeSpec);
  TEST_ASSERT_EQUAL_STRING("", state.current.themeSpecId.c_str());
  TEST_ASSERT_EQUAL_STRING("", state.current.themeSpecRaw.c_str());

  const char* liveFrame = R"JSON({"v":2,"provider":"codex","label":"Codex","session":12,"weekly":22,"resetSecs":32,"theme":"mini"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, liveFrame, 3000, event));
  TEST_ASSERT_FALSE(event.themeSpecCacheHit);
  TEST_ASSERT_FALSE(state.current.hasThemeSpec);
}

void testThemeSpecRuntimePolicyRejectsObservedFragmentedHeap() {
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::CanRender(3792, 1720));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::CanAnimate(3792, 1720));

  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::CanRender(
      ThemeSpecRuntimePolicy::kMinRenderFreeHeapBytes,
      ThemeSpecRuntimePolicy::kMinRenderMaxFreeBlockBytes));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::CanRender(
      ThemeSpecRuntimePolicy::kMinRenderFreeHeapBytes - 1,
      ThemeSpecRuntimePolicy::kMinRenderMaxFreeBlockBytes));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::CanRender(
      ThemeSpecRuntimePolicy::kMinRenderFreeHeapBytes,
      ThemeSpecRuntimePolicy::kMinRenderMaxFreeBlockBytes - 1));

  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::CanAnimate(
      ThemeSpecRuntimePolicy::kMinAnimationFreeHeapBytes,
      ThemeSpecRuntimePolicy::kMinAnimationMaxFreeBlockBytes));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::CanAnimate(
      ThemeSpecRuntimePolicy::kMinAnimationFreeHeapBytes - 1,
      ThemeSpecRuntimePolicy::kMinAnimationMaxFreeBlockBytes));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::CanAnimate(
      ThemeSpecRuntimePolicy::kMinAnimationFreeHeapBytes,
      ThemeSpecRuntimePolicy::kMinAnimationMaxFreeBlockBytes - 1));
}

void testCbaHeaderParserAcceptsWhitespaceAndExactIntegers() {
  int values[4] = {0, 0, 0, 0};
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::ParseCbaHeader(" \t52  52\t12 6 \r\n", values, 4));
  TEST_ASSERT_EQUAL_INT(52, values[0]);
  TEST_ASSERT_EQUAL_INT(52, values[1]);
  TEST_ASSERT_EQUAL_INT(12, values[2]);
  TEST_ASSERT_EQUAL_INT(6, values[3]);
}

void testCbaHeaderParserRejectsMalformedOrTrailingInput() {
  int values[4] = {0, 0, 0, 0};
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ParseCbaHeader("52 52 12", values, 4));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ParseCbaHeader("52 52 12 6 extra", values, 4));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ParseCbaHeader("52 -52 12 6", values, 4));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ParseCbaHeader("52 999999999999 12 6", values, 4));
}

void testAnimatedAssetDuePolicySkipsFilesystemWorkBetweenFrames() {
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::AnimatedAssetDue(true, true, 10, 10, 200, 100));
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::AnimatedAssetDue(false, false, 0, 0, 0, 100));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::AnimatedAssetDue(false, true, 10, 10, 200, 199));
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::AnimatedAssetDue(false, true, 10, 10, 200, 200));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::AnimatedAssetDue(false, true, 1, 10, 0, 200));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::AnimatedAssetDue(false, true, 10, 0, 0, 200));

  const unsigned long deadline = 0xFFFFFFF0UL;
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::AnimatedAssetDue(false, true, 10, 10, deadline, 0x00000010UL));
}

void testAssetDecodeYieldPolicyBoundsLongRleWork() {
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ShouldYieldDuringAssetScan(0));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ShouldYieldDuringAssetScan(3));
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::ShouldYieldDuringAssetScan(4));
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::ShouldYieldDuringAssetScan(8));

  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ShouldYieldDuringRleDecode(0));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ShouldYieldDuringRleDecode(15));
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::ShouldYieldDuringRleDecode(16));
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::ShouldYieldDuringRleDecode(32));
}

void testAnimatedSpriteFrameOffsetsAreIndexedOneFrameAtATime() {
  TEST_ASSERT_EQUAL_INT(0, ThemeSpecRuntimePolicy::InitialAnimatedIndexedFrameCount(0));
  TEST_ASSERT_EQUAL_INT(1, ThemeSpecRuntimePolicy::InitialAnimatedIndexedFrameCount(8));

  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::AnimatedFrameOffsetAvailable(0, 8, 1));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::AnimatedFrameOffsetAvailable(1, 8, 1));
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(0, 8, 1));

  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::AnimatedFrameOffsetAvailable(1, 8, 2));
  TEST_ASSERT_TRUE(ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(1, 8, 2));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(0, 8, 2));
  TEST_ASSERT_FALSE(ThemeSpecRuntimePolicy::ShouldIndexNextAnimatedFrame(7, 8, 8));
}

// --- Reset countdown trust (#279) -------------------------------------------
//
// The device has no wall clock. Every expectation below is expressed in
// millis() deltas, exactly as the firmware sees them.

constexpr unsigned long kHourMs = 3600UL * 1000UL;

// resetSecs 6h, budget the full 5h horizon: a fresh live basis.
const char* kLiveResetFrame =
    R"JSON({"v":2,"provider":"claude","label":"Claude","session":73,"weekly":45,"resetSecs":21600,"resetAgeSecs":0,"resetTrustSecs":18000,"resetSource":"claude:primary","resetTrust":"live"})JSON";

void feedLiveResetFrame(RuntimeState& state, unsigned long atMillis) {
  SerialConsumeEvent event;
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, kLiveResetFrame, atMillis, event));
}

void testResetTrustLiveFrameCountsDownLocallyForFiveHours() {
  RuntimeState state;
  feedLiveResetFrame(state, 1000);

  TEST_ASSERT_EQUAL_INT(static_cast<int>(ResetTrust::kLive),
                        static_cast<int>(CurrentResetTrust(state.reset, 1000)));
  TEST_ASSERT_EQUAL_INT64(21600, CurrentRemainingSecs(state, 1000));

  // Updates stop here. The countdown stays exact for the whole trust budget.
  TEST_ASSERT_EQUAL_INT64(21600 - 3600, CurrentRemainingSecs(state, 1000 + kHourMs));
  // One second short of the horizon: still exact, still shown.
  TEST_ASSERT_EQUAL_INT64(21600 - 17999, CurrentRemainingSecs(state, 1000 + 5 * kHourMs - 1000));

  // Without fresh data the host claim of "live" no longer holds.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ResetTrust::kOffline),
                        static_cast<int>(CurrentResetTrust(state.reset, 1000 + kHourMs)));
}

void testResetTrustExpiredBudgetBlanksAStillRunningDeadline() {
  RuntimeState state;
  feedLiveResetFrame(state, 1000);

  // One second past the horizon the basis is stale even though the deadline
  // itself is still 1h out. The firmware refuses the number it cannot back.
  const unsigned long past = 1000 + 5 * kHourMs + 1000;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ResetTrust::kStale),
                        static_cast<int>(CurrentResetTrust(state.reset, past)));
  TEST_ASSERT_EQUAL_INT64(0, CurrentRemainingSecs(state, past));
}

void testUsageWindowResetCountdownsStopWhenTrustExpires() {
  RuntimeState state;
  feedLiveResetFrame(state, 1000);
  state.current.usageWindows[0].available = true;
  state.current.usageWindows[0].resetSecs = 21600;
  state.current.usageWindows[1].available = true;
  state.current.usageWindows[1].resetSecs = 43200;

  const unsigned long beforeExpiry = 1000 + 5 * kHourMs - 1000;
  TEST_ASSERT_EQUAL_INT64(
      3601,
      codexbar_display::core::CurrentUsageWindowRemainingSecs(state, 0, beforeExpiry));
  TEST_ASSERT_EQUAL_INT64(
      25201,
      codexbar_display::core::CurrentUsageWindowRemainingSecs(state, 1, beforeExpiry));

  const unsigned long afterExpiry = 1000 + 5 * kHourMs + 1000;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ResetTrust::kStale),
                        static_cast<int>(CurrentResetTrust(state.reset, afterExpiry)));
  TEST_ASSERT_EQUAL_INT64(
      0,
      codexbar_display::core::CurrentUsageWindowRemainingSecs(state, 0, afterExpiry));
  TEST_ASSERT_EQUAL_INT64(
      0,
      codexbar_display::core::CurrentUsageWindowRemainingSecs(state, 1, afterExpiry));
}

void testResetTrustDeadlineReachedOfflineDoesNotStartNewCycle() {
  RuntimeState state;
  SerialConsumeEvent event;
  const char* nearlyDone =
      R"JSON({"v":2,"provider":"claude","resetSecs":60,"resetTrustSecs":18000,"resetSource":"claude:primary","resetTrust":"offline"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, nearlyDone, 1000, event));
  TEST_ASSERT_EQUAL_INT64(60, CurrentRemainingSecs(state, 1000));

  // Passing the deadline clamps at zero and stays there instead of wrapping
  // into an invented next window.
  TEST_ASSERT_EQUAL_INT64(0, CurrentRemainingSecs(state, 1000 + 61UL * 1000UL));
  TEST_ASSERT_EQUAL_INT64(0, CurrentRemainingSecs(state, 1000 + 2 * kHourMs));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ResetTrust::kStale),
                        static_cast<int>(CurrentResetTrust(state.reset, 1000 + 2 * kHourMs)));
}

void testResetTrustSourceChangeNeverInheritsPreviousDeadline() {
  RuntimeState state;
  feedLiveResetFrame(state, 1000);

  SerialConsumeEvent event;
  const char* otherWindow =
      R"JSON({"v":2,"provider":"claude","resetSecs":900,"resetTrustSecs":18000,"resetSource":"claude:weekly","resetTrust":"live"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, otherWindow, 2000, event));
  TEST_ASSERT_EQUAL_INT64(900, CurrentRemainingSecs(state, 2000));
  TEST_ASSERT_EQUAL_STRING("claude:weekly", state.reset.source.c_str());

  // A stale frame for a different source leaves nothing behind either.
  const char* staleOther =
      R"JSON({"v":2,"provider":"codex","resetSecs":0,"resetTrustSecs":0,"resetSource":"codex:primary","resetTrust":"stale"})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, staleOther, 3000, event));
  TEST_ASSERT_EQUAL_INT64(0, CurrentRemainingSecs(state, 3000));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ResetTrust::kStale),
                        static_cast<int>(CurrentResetTrust(state.reset, 3000)));
}

void testResetTrustOfflineResendCannotExtendDeadlineOrBudget() {
  RuntimeState state;
  feedLiveResetFrame(state, 1000);

  // Two hours later the host resends the same last known good numbers without
  // re-anchoring them. The device may only downgrade, so its own clock wins.
  SerialConsumeEvent event;
  const char* resend =
      R"JSON({"v":2,"provider":"claude","resetSecs":21600,"resetTrustSecs":18000,"resetSource":"claude:primary","resetTrust":"offline"})JSON";
  const unsigned long later = 1000 + 2 * kHourMs;
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, resend, later, event));
  TEST_ASSERT_EQUAL_INT64(21600 - 2 * 3600, CurrentRemainingSecs(state, later));
  TEST_ASSERT_EQUAL_INT64(18000 - 2 * 3600, ResetTrustBudgetSecs(state.reset, later));
}

void testResetTrustRecoversFromStaleWithFreshDataWithoutRestart() {
  RuntimeState state;
  feedLiveResetFrame(state, 1000);
  const unsigned long stale = 1000 + 6 * kHourMs;
  TEST_ASSERT_EQUAL_INT64(0, CurrentRemainingSecs(state, stale));

  feedLiveResetFrame(state, stale);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ResetTrust::kLive),
                        static_cast<int>(CurrentResetTrust(state.reset, stale)));
  TEST_ASSERT_EQUAL_INT64(21600, CurrentRemainingSecs(state, stale));
}

void testResetTrustRestartHandoverKeepsStillValidDeadline() {
  RuntimeState before;
  feedLiveResetFrame(before, 1000);

  const unsigned long rebootAt = 1000 + kHourMs;
  const String record = EncodeResetTrustRecord(before.reset, rebootAt);
  TEST_ASSERT_EQUAL_STRING("1 18000 14400 claude:primary", record.c_str());

  // Fresh boot: millis() restarted, and the restart gap is charged to both
  // counters because the device cannot measure it.
  RuntimeState after;
  after.hasFrame = true;
  TEST_ASSERT_TRUE(DecodeResetTrustRecord(record, 30, 5000, after.reset));
  TEST_ASSERT_EQUAL_INT64(18000 - 30, CurrentRemainingSecs(after, 5000));
  TEST_ASSERT_EQUAL_INT64(14400 - 30, ResetTrustBudgetSecs(after.reset, 5000));
  TEST_ASSERT_EQUAL_STRING("claude:primary", after.reset.source.c_str());

  // A restored basis is never live: no frame has arrived yet.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ResetTrust::kOffline),
                        static_cast<int>(CurrentResetTrust(after.reset, 5000)));
}

void testResetTrustHandoverRefusesUntrustworthyRecords() {
  RuntimeState state;
  ResetTrustState restored;

  // Nothing to hand over before any contract-aware frame.
  TEST_ASSERT_EQUAL_STRING("", EncodeResetTrustRecord(state.reset, 1000).c_str());

  // A legacy countdown has no budget and must not survive as an unbounded one.
  SerialConsumeEvent event;
  const char* legacy = R"JSON({"v":2,"provider":"codex","resetSecs":3600})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, legacy, 1000, event));
  TEST_ASSERT_EQUAL_STRING("", EncodeResetTrustRecord(state.reset, 1000).c_str());

  TEST_ASSERT_FALSE(DecodeResetTrustRecord("", 30, 1000, restored));
  TEST_ASSERT_FALSE(DecodeResetTrustRecord("1 18000 14400", 30, 1000, restored));
  TEST_ASSERT_FALSE(DecodeResetTrustRecord("2 18000 14400 claude:primary", 30, 1000, restored));
  TEST_ASSERT_FALSE(DecodeResetTrustRecord("1 18000 14400 claude primary", 30, 1000, restored));
  // Budget beyond the horizon cannot come from an honest handover.
  TEST_ASSERT_FALSE(DecodeResetTrustRecord("1 18000 99999 claude:primary", 30, 1000, restored));
  // Deadline already consumed by the restart gap.
  TEST_ASSERT_FALSE(DecodeResetTrustRecord("1 20 14400 claude:primary", 30, 1000, restored));
}

void testResetTrustLegacyFrameKeepsUnboundedLocalCountdown() {
  RuntimeState state;
  SerialConsumeEvent event;
  const char* legacy = R"JSON({"v":2,"provider":"codex","label":"Codex","session":10,"resetSecs":21600})JSON";
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, legacy, 1000, event));

  // No trust claim, so no budget: exactly the pre-contract behaviour.
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ResetTrust::kUnknown),
                        static_cast<int>(CurrentResetTrust(state.reset, 1000)));
  TEST_ASSERT_EQUAL_INT64(21600 - 6 * 3600, CurrentRemainingSecs(state, 1000 + 6 * kHourMs));
  TEST_ASSERT_EQUAL_INT64(0, CurrentRemainingSecs(state, 1000 + 7 * kHourMs));
}

void testResetTrustIsUntouchedByFramesWithoutResetFields() {
  RuntimeState state;
  feedLiveResetFrame(state, 1000);

  SerialConsumeEvent event;
  const char* themeOnly =
      R"JSON({"v":2,"provider":"claude","label":"Claude","themeSpec":{"v":1,"id":"mini","rev":1,"p":[{"t":"tx","x":0,"y":0,"v":"{reset}"}]}})JSON";
  const unsigned long later = 1000 + kHourMs;
  TEST_ASSERT_TRUE(ConsumeFrameLine(state, themeOnly, later, event));
  TEST_ASSERT_EQUAL_INT64(21600 - 3600, CurrentRemainingSecs(state, later));
  TEST_ASSERT_EQUAL_STRING("claude:primary", state.reset.source.c_str());
}

void testStaleResetRendersUnavailableWhateverTheThemeBinds() {
  RuntimeState state;
  feedLiveResetFrame(state, 1000);
  const unsigned long stale = 1000 + 6 * kHourMs;

  const char* spec =
      R"JSON({"v":1,"id":"reset-theme","rev":1,"p":[{"t":"tx","x":0,"y":0,"v":"Reset in {reset}"},{"t":"tx","x":0,"y":20,"b":"r"}]})JSON";

  FrameData frame;
  frame.label = "Claude";
  // Renderers never read the raw frame value; they read the enforced one.
  frame.resetSecs = CurrentRemainingSecs(state, stale);

  RecordingSink sink;
  TEST_ASSERT_TRUE(renderSpec(spec, frame, sink));
  TEST_ASSERT_EQUAL_UINT32(3, sink.commands.size());
  TEST_ASSERT_EQUAL_STRING("Reset unavailable", sink.commands[1].text.c_str());
  TEST_ASSERT_EQUAL_STRING("Reset unavailable", sink.commands[2].text.c_str());
}

}  // namespace

// Defined in test_device_clock.cpp.
void RunDeviceClockTests();

int main() {
  UNITY_BEGIN();
  RunDeviceClockTests();
  RUN_TEST(testInvalidSpecsReturnFalse);
  RUN_TEST(testGifLimitsRejectOversizedOrMultipleGifs);
  RUN_TEST(testCompiledThemeSpecFindsEveryReferencedAsset);
  RUN_TEST(testRendersCommandsAndBindings);
  RUN_TEST(testAbsentTokenTotalsRenderUnavailable);
  RUN_TEST(testConsumeFrameLineTracksTokenTotalPresence);
  RUN_TEST(testTokenAvailabilityFlipRepaintsTokenBindings);
  RUN_TEST(testUsageUnavailableKeepsThemeAndProgress);
  RUN_TEST(testUsageWindowOwnershipHidesCompleteMissingLane);
  RUN_TEST(testTokenTotalsRenderCompactAndTruncated);
  RUN_TEST(testProviderSlotBindingsRenderLabelAndFormattedReset);
  RUN_TEST(testProviderSlotsParseTickAndTriggerLiveRedraw);
  RUN_TEST(testIndexedProgressHidesMissingWindow);
  RUN_TEST(testUsageWindowResetCountdownsTickIndependently);
  RUN_TEST(testAdvertisedUsageWindowCapacityFitsFrameBufferAndParses);
  RUN_TEST(testRawUsageWindowParserCapacityStillAcceptsNormalLabels);
  RUN_TEST(testHighestAdvertisedUsageWindowBindingCompiles);
  RUN_TEST(testCompactUsageWindowBindingTriggersLiveRedraw);
  RUN_TEST(testConsumeFrameLineComparesCurrentBeforeAssignment);
  RUN_TEST(testQuotaReplenishmentDoesNotCountAsUsageProgress);
  RUN_TEST(testUsageProgressRequiresStableProviderAndWindowIdentity);
  RUN_TEST(testUsageWindowOwnershipAndCompactTemplateTriggerLiveRedraw);
  RUN_TEST(testWhitespaceUsageWindowOwnersTriggerLiveRedraw);
  RUN_TEST(testPartialUsageProtocolRendersOnlyUnknownLane);
  RUN_TEST(testResetCountdownFormatsDaysAndHours);
  RUN_TEST(testLabelBindingUsesProviderLabelWithoutUpdateNotice);
  RUN_TEST(testChangedLabelPassUsesSynchronizedUpdateNoticeText);
  RUN_TEST(testChangedLabelPassCanRestoreProviderText);
  RUN_TEST(testRegionRepaintRedrawsOnlyOverlappingPrimitives);
  RUN_TEST(testRegionRepaintSkipsAnimatedPrimitivesButReportsThem);
  RUN_TEST(testRegionRepaintWithoutOverlapFillsBackgroundOnly);
  RUN_TEST(testAnimatedOverlapQueryFindsGifOnlyInsideItsBounds);
  RUN_TEST(testUpdateNoticeLabelSurfaceStaysVisibleAndRotatesPhases);
  RUN_TEST(testUpdateNoticeOverlaySurfaceDutyCyclesVisibility);
  RUN_TEST(testUpdateNoticeDeactivateRestoresOnlyWhenVisible);
  RUN_TEST(testUpdateNoticeSurfaceChangeRestoresOldSurface);
  RUN_TEST(testRendersCompactCommandsAndBindings);
  RUN_TEST(testCompactTextWidthMapsToMaxWidthForAlignment);
  RUN_TEST(testRendersMulticolorRlePixelsAsFillRects);
  RUN_TEST(testInvalidMulticolorRlePixelsAreSkippedWithoutPartialDraw);
  RUN_TEST(testInvalidPrimitivesAreSkipped);
  RUN_TEST(testColorFallbacks);
  RUN_TEST(testAnimatedPrimitivePassRendersOnlyGifsAndAnimatedSpritesWithoutClear);
  RUN_TEST(testStaticPrimitivePassSkipsAnimatedAssets);
  RUN_TEST(testStaticPrimitivePassKeepsFullScreenSpriteBehindCenteredLabel);
  RUN_TEST(testCompiledThemeSpecSeparatesGifAssetsFromAnimatedSprites);
  RUN_TEST(testChangedPrimitivePassReplaysDirtyRegion);
  RUN_TEST(testChangedPrimitivePassReportsSkippedAnimatedOverlap);
  RUN_TEST(testChangedPrimitivePassDoesNotBridgeUnchangedGif);
  RUN_TEST(testChangedPrimitivePassUsesThemeBackgroundAndOverlaps);
  RUN_TEST(testChangedLabelPassUsesRenderedFontHeightForProviderLabel);
  RUN_TEST(testChangedPrimitivePassHandlesCompactClippySpec);
  RUN_TEST(testClippyIdleToCodingWeeklyPartialKeepsBackgroundDecodeClipped);
  RUN_TEST(testCompiledThemeSpecFullPartialAndAnimatedPasses);
  RUN_TEST(testChangedPrimitivePassReportsNoAffectedPrimitiveForUnusedReset);
  RUN_TEST(testChangedPrimitivePassHandlesTextWithoutMaxWidth);
  RUN_TEST(testStateAssetsUseActivityWithIdleFallback);
  RUN_TEST(testStateAnimatedSpriteActivityChangeRedrawsAnimatedPass);
  RUN_TEST(testFrameActivityDefaultsToCodingWhenUsageChanges);
  RUN_TEST(testUsageProgressIgnoresTokenHistoryExpiryAndRestore);
  RUN_TEST(testUsageProgressEventIgnoresDeclaredActivityAndErrors);
  RUN_TEST(testUsageProgressEventIgnoresDisplayOnlyUsageChanges);
  RUN_TEST(testThemeSpecActivityChangeUsesPartialRenderEvent);
  RUN_TEST(testLegacyThemeFieldsAreIgnored);
  RUN_TEST(testStoredThemeActivationLiveFrameUsesPartialRenderEvent);
  RUN_TEST(testStoredThemeBootActivationRestoresFrameAndFullRenderIntent);
  RUN_TEST(testStoredThemeBootActivationRejectsInvalidRaw);
  RUN_TEST(testThemeSpecErrorFrameUsesFullRender);
  RUN_TEST(testThemeSpecErrorFrameDoesNotReplaceItselfWithCachedTheme);
  RUN_TEST(testClippyLikeThemeSpecPartialEventCoversStateProgressAndReset);
  RUN_TEST(testThemeSpecIgnoresUpdateMetadataForVisualDirty);
  RUN_TEST(testThemeSpecUpdateAvailabilityDirtiesOnlyLabelField);
  RUN_TEST(testThemeSpecMissingUpdateAfterAvailableDirtiesLabelField);
  RUN_TEST(testThemeSpecCacheCarriesLayoutAcrossLiveFrames);
  RUN_TEST(testCompactThemeSpecFrameIsCached);
  RUN_TEST(testThemeSpecCacheUpdatesRawWhenSameRevisionIsResent);
  RUN_TEST(testThemeSpecMetadataOnlyFrameKeepsPreviousRenderableRaw);
  RUN_TEST(testUnknownMetadataOnlyThemeSpecDoesNotBlankPreviousRenderableRaw);
  RUN_TEST(testUnconfirmedThemeSpecNullKeepsCachedLayout);
  RUN_TEST(testConfirmedThemeSpecNullClearsCachedLayout);
  RUN_TEST(testThemeSpecRuntimePolicyRejectsObservedFragmentedHeap);
  RUN_TEST(testCbaHeaderParserAcceptsWhitespaceAndExactIntegers);
  RUN_TEST(testCbaHeaderParserRejectsMalformedOrTrailingInput);
  RUN_TEST(testAnimatedAssetDuePolicySkipsFilesystemWorkBetweenFrames);
  RUN_TEST(testAssetDecodeYieldPolicyBoundsLongRleWork);
  RUN_TEST(testAnimatedSpriteFrameOffsetsAreIndexedOneFrameAtATime);
  RUN_TEST(testResetTrustLiveFrameCountsDownLocallyForFiveHours);
  RUN_TEST(testResetTrustExpiredBudgetBlanksAStillRunningDeadline);
  RUN_TEST(testUsageWindowResetCountdownsStopWhenTrustExpires);
  RUN_TEST(testResetTrustDeadlineReachedOfflineDoesNotStartNewCycle);
  RUN_TEST(testResetTrustSourceChangeNeverInheritsPreviousDeadline);
  RUN_TEST(testResetTrustOfflineResendCannotExtendDeadlineOrBudget);
  RUN_TEST(testResetTrustRecoversFromStaleWithFreshDataWithoutRestart);
  RUN_TEST(testResetTrustRestartHandoverKeepsStillValidDeadline);
  RUN_TEST(testResetTrustHandoverRefusesUntrustworthyRecords);
  RUN_TEST(testResetTrustLegacyFrameKeepsUnboundedLocalCountdown);
  RUN_TEST(testResetTrustIsUntouchedByFramesWithoutResetFields);
  RUN_TEST(testStaleResetRendersUnavailableWhateverTheThemeBinds);
  return UNITY_END();
}
