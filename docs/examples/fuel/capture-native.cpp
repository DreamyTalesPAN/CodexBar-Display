// Evidence-only host framebuffer adapter for the existing Fuel pack.
// Uses the real shared compiler/renderer and needle sampler; see README limits.
#include "theme_spec_renderer_core.h"
#include <algorithm>
#include <array>
#include <cctype>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#define PROGMEM
#include "Fonts/Font16.c"
using namespace codexbar_display::themespec;
std::string read(const std::string &p) {
  std::ifstream f(p);
  if (!f)
    throw std::runtime_error(p);
  return {std::istreambuf_iterator<char>(f), {}};
}
struct Asset {
  int w, h;
  std::vector<uint16_t> colors;
  std::vector<std::string> rows;
  std::vector<uint8_t> index;
};
Asset load(const std::string &p) {
  std::istringstream f(read(p));
  std::string s;
  Asset a;
  std::getline(f, s);
  if (s != "CBI1")
    throw std::runtime_error("CBI1");
  std::getline(f, s);
  std::istringstream(s) >> a.w >> a.h;
  std::getline(f, s);
  int n = std::stoi(s);
  for (int i = 0; i < n; i++) {
    std::getline(f, s);
    a.colors.push_back(ParseColor(s.c_str(), 0));
  }
  for (int y = 0; y < a.h; y++) {
    std::getline(f, s);
    a.rows.push_back(s);
    int x = 0;
    for (size_t i = 0; i < s.size();) {
      int r = 0;
      while (i < s.size() && isdigit(s[i]))
        r = r * 10 + s[i++] - '0';
      if (!r)
        r = 1;
      char t = s.at(i++);
      for (int k = 0; k < r; k++)
        a.index.push_back(t == '.' ? 255 : t - 'a');
      x += r;
    }
    if (x != a.w)
      throw std::runtime_error("row width");
  }
  return a;
}
struct Framebuffer : Sink {
  std::array<uint16_t, 240 * 240> px{};
  std::map<std::string, Asset> assets;
  int needles = 0, sprites = 0, texts = 0, rectangles = 0;
  void put(int x, int y, uint16_t c) {
    if (x >= 0 && x < 240 && y >= 0 && y < 240)
      px[y * 240 + x] = c;
  }
  void rect(int x, int y, int w, int h, uint16_t c) {
    for (int j = 0; j < h; j++)
      for (int i = 0; i < w; i++)
        put(x + i, y + j, c);
  }
  void circleHelper(int x0, int y0, int r, int corners, int delta, uint16_t c) {
    int f = 1 - r, dx = 1, dy = -r - r, y = 0;
    delta++;
    while (y < r) {
      if (f >= 0) {
        if (corners & 1)
          rect(x0 - y, y0 + r, y + y + delta, 1, c);
        if (corners & 2)
          rect(x0 - y, y0 - r, y + y + delta, 1, c);
        r--;
        dy += 2;
        f += dy;
      }
      y++;
      dx += 2;
      f += dx;
      if (corners & 1)
        rect(x0 - r, y0 + y, r + r + delta, 1, c);
      if (corners & 2)
        rect(x0 - r, y0 - y, r + r + delta, 1, c);
    }
  }
  void FillScreen(uint16_t c) override { px.fill(c); }
  void FillRect(const RectCommand &q) override {
    rectangles++;
    int r =
        std::max(0, std::min(q.borderRadius, std::min(q.width, q.height) / 2));
    if (!r) {
      rect(q.x, q.y, q.width, q.height, q.color);
      return;
    }
    rect(q.x, q.y + r, q.width, q.height - 2 * r, q.color);
    circleHelper(q.x + r, q.y + q.height - r - 1, r, 1, q.width - r - r - 1,
                 q.color);
    circleHelper(q.x + r, q.y + r, r, 2, q.width - r - r - 1, q.color);
  }
  int textWidth(const char *t, int s) {
    int w = 0;
    for (; *t; t++) {
      unsigned char c = *t;
      w += widtbl_f16[(c >= 32 && c < 128 ? c : 32) - 32] * s;
    }
    return w;
  }
  void DrawText(const TextCommand &q) override {
    if (q.font != 2)
      throw std::runtime_error("Only Fuel font 2 implemented");
    texts++;
    int size = q.size;
    while (q.fitShrink && size > 1 && textWidth(q.text, size) > q.maxWidth)
      size--;
    int width = textWidth(q.text, size), x = q.x, y = q.y;
    if (q.align == 1)
      x += std::max(0, (q.maxWidth - width) / 2);
    else if (q.align == 2)
      x += std::max(0, q.maxWidth - width);
    if (q.valign)
      y = AlignedTextY(q.y, TextValignBoxHeight(q.height, q.font, q.size),
                       16 * size, q.valign);
    for (const char *t = q.text; *t; t++) {
      unsigned char c = *t;
      if (c < 32 || c > 127)
        c = 32;
      int w = widtbl_f16[c - 32], bytes = (w + 6) / 8;
      auto *bits = chrtbl_f16[c - 32];
      for (int j = 0; j < 16; j++)
        for (int k = 0; k < bytes * 8; k++)
          if (bits[j * bytes + k / 8] & (0x80 >> (k % 8)))
            for (int dy = 0; dy < size; dy++)
              for (int dx = 0; dx < size; dx++) {
                int xx = x + k * size + dx, yy = y + j * size + dy;
                if (q.maxWidth <= 0 || (xx >= q.x && xx < q.x + q.maxWidth &&
                                        yy >= y && yy < y + 16 * size + 4))
                  put(xx, yy, q.fg);
              }
      x += w * size;
    }
  }
  void DrawSprite(const SpriteCommand &q) override {
    sprites++;
    auto &a = assets.at(q.assetPath);
    int w = q.width > 0 ? q.width : a.w, h = q.height > 0 ? q.height : a.h;
    for (int y = 0; y < a.h; y++) {
      const auto &s = a.rows[y];
      int offset = 0;
      for (size_t i = 0; i < s.size();) {
        int n = 0;
        while (i < s.size() && isdigit(s[i]))
          n = n * 10 + s[i++] - '0';
        if (!n)
          n = 1;
        char token = s.at(i++);
        int x1 = offset * w / a.w, x2 = ((offset + n) * w + a.w - 1) / a.w,
            y1 = y * h / a.h, y2 = ((y + 1) * h + a.h - 1) / a.h;
        if (token != '.')
          rect(q.x + x1, q.y + y1, x2 - x1, y2 - y1, a.colors.at(token - 'a'));
        else if (q.hasBg)
          rect(q.x + x1, q.y + y1, x2 - x1, y2 - y1, q.bg);
        offset += n;
      }
    }
  }
  void DrawNeedle(const NeedleCommand &q) override {
    needles++;
    auto &a = assets.at(q.assetPath);
    for (int y = 0; y < q.height; y++)
      for (int x = 0; x < q.width; x++) {
        int sx, sy;
        if (NeedleSourcePixel(x, y, q.width, q.height, a.w, a.h, q.angle, sx,
                              sy)) {
          int ix = a.index[sy * a.w + sx];
          if (ix != 255)
            put(q.x + x, q.y + y, a.colors.at(ix));
        }
      }
    std::cout << "needle angle=" << q.angle << " degrees\n";
  }
  void DrawProgress(const ProgressCommand &) override {
    throw std::runtime_error("Unexpected non-needle progress");
  }
  void DrawGif(const GifCommand &) override {
    throw std::runtime_error("Unexpected GIF");
  }
  void DrawPixels(const PixelsCommand &) override {
    throw std::runtime_error("Unexpected Pixels");
  }
  void save(const std::string &p) {
    std::ofstream f(p, std::ios::binary);
    if (!f)
      throw std::runtime_error("cannot write " + p);
    f << "P6\n240 240\n255\n";
    for (auto c : px) {
      unsigned char rgb[] = {
          static_cast<unsigned char>(((c >> 11) & 31) * 255 / 31),
          static_cast<unsigned char>(((c >> 5) & 63) * 255 / 63),
          static_cast<unsigned char>((c & 31) * 255 / 31)};
      f.write((char *)rgb, 3);
    }
  }
};
int main(int argc, char **argv) {
  try {
    if (argc != 2)
      throw std::runtime_error(
          "usage: capture-native DIRECTORY (with pack/ and out/)");
    const std::string dir = argv[1];
    JsonDocument manifest;
    if (deserializeJson(manifest, read(dir + "/pack/manifest.json")))
      throw std::runtime_error("invalid manifest");
    Framebuffer sink;
    for (JsonObjectConst a : manifest["assets"].as<JsonArrayConst>())
      sink.assets[a["path"].as<std::string>()] =
          load(dir + "/pack/" + a["file"].as<std::string>());
    JsonDocument doc;
    CompiledThemeSpec scene;
    auto theme = read(dir + "/pack/theme.json");
    if (!CompileThemeSpec(theme.c_str(), doc, scene))
      throw std::runtime_error("compile failed");
    if (scene.primitiveCount != 7)
      throw std::runtime_error("expected all seven Fuel primitives");
    std::cout << "compiled primitives=" << scene.primitiveCount << "\n";
    for (int pct : {0, 50, 100}) {
      FrameData frame;
      frame.provider = "codex";
      frame.label = "Codex";
      frame.usageMode = "used";
      frame.usageSlot1Available = true;
      frame.usageSlot1Label = "Session";
      frame.usageSlot1Percent = pct;
      frame.usageWindows[0].available = true;
      frame.usageWindows[0].label = "Session";
      frame.usageWindows[0].percent = pct;
      sink.needles = sink.sprites = sink.texts = sink.rectangles = 0;
      if (!RenderCompiledThemeSpec(scene, frame, sink))
        throw std::runtime_error("render failed");
      if (sink.needles != 1 || sink.sprites != 2 || sink.texts != 2 ||
          sink.rectangles != 2)
        throw std::runtime_error("missing primitives");
      sink.save(dir + "/out/fuel-native-" + std::to_string(pct) + ".ppm");
      std::cout << pct
                << "%: 1 needle, 2 sprites, 2 text fields; all 7 primitives "
                   "rendered\n";
    }
    ReleaseCompiledThemeSpec(scene);
    return 0;
  } catch (const std::exception &e) {
    std::cerr << e.what() << "\n";
    return 1;
  }
}
