import Konva from "konva";
import "./styles.css";

const DISPLAY_SIZE = 240;
const MAX_SPEC_BYTES = 1024;
const MAX_FRAME_BYTES = 1024;
const MAX_PRIMITIVES = 32;
const COLOR_RE = /^#[A-Fa-f0-9]{6}$/;
const THEME_ID_RE = /^[a-z0-9][a-z0-9\-_]{2,63}$/;
const FIXED_THEME_REV = 1;
const FIXED_FALLBACK_THEME = "mini";
const DEFAULT_TARGET_ORIGIN = "http://vibetv.local";
const TARGET_STORAGE_KEY = "codexbar.themeStudio.targetOrigin";
const DEFAULT_GIF_SIZE = 80;
const MAX_ESP8266_LITTLEFS_PATH_CHARS = 31;

type PrimitiveType = "rect" | "text" | "progress" | "gif";
type ResizeHandle = "e" | "s" | "se";
type EditableKonvaNode = Konva.Group | Konva.Shape;
type BindingKey =
  | "label"
  | "provider"
  | "session"
  | "sessionPercent"
  | "weekly"
  | "weeklyPercent"
  | "reset"
  | "resetCountdown"
  | "usageMode"
  | "sessionTokens"
  | "weekTokens"
  | "totalTokens";

interface Primitive {
  type: PrimitiveType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  font?: number;
  fontSize?: number;
  binding?: BindingKey;
  color?: string;
  bgColor?: string;
  borderColor?: string;
  rotation?: number;
  assetPath?: string;
}

interface ThemeSpec {
  themeSpecVersion: 1;
  themeId: string;
  themeRev: number;
  fallbackTheme?: "classic" | "crt" | "mini";
  bgColor?: string;
  primitives: Primitive[];
}

interface FrameData {
  provider: string;
  label: string;
  session: number;
  weekly: number;
  reset: string;
  resetSecs: number;
  usageMode: string;
  sessionTokens: number;
  weekTokens: number;
  totalTokens: number;
}

interface AppState {
  spec: ThemeSpec;
  selectedIndex: number;
  hoveredIndex: number | null;
  editingTextIndex: number | null;
  copiedPrimitive: Primitive | null;
  gifAssets: Record<string, { file: File; previewUrl: string }>;
  jsonText: string;
  jsonDirty: boolean;
  errors: string[];
  warnings: string[];
  notice: string;
  targetOrigin: string;
}

const frame: FrameData = {
  provider: "codex",
  label: "Codex",
  session: 94,
  weekly: 87,
  reset: "89h 54m",
  resetSecs: 323640,
  usageMode: "remaining",
  sessionTokens: 12840,
  weekTokens: 68120,
  totalTokens: 190420,
};

const variableTokens = [
  { label: "Name", token: "{label}", preview: frame.label },
  { label: "Session", token: "{session}%", preview: `${frame.session}%` },
  { label: "Weekly", token: "{weekly}%", preview: `${frame.weekly}%` },
  { label: "Reset", token: "{reset}", preview: frame.reset },
  { label: "Mode", token: "{usageMode}", preview: frame.usageMode },
  { label: "Session tokens", token: "{sessionTokens}", preview: String(frame.sessionTokens) },
  { label: "Week tokens", token: "{weekTokens}", preview: String(frame.weekTokens) },
  { label: "Total tokens", token: "{totalTokens}", preview: String(frame.totalTokens) },
];

const fontOptions = [
  { value: 1, label: "TFT Font 1", family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", weight: 800 },
  { value: 2, label: "TFT Font 2", family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", weight: 800 },
];

const fallbackFont = fontOptions[0];
const firmwareFont2Widths = [
  6, 3, 4, 9, 8, 9, 9, 3,
  7, 7, 8, 6, 3, 6, 5, 7,
  8, 8, 8, 8, 8, 8, 8, 8,
  8, 8, 3, 3, 6, 6, 6, 8,
  9, 8, 8, 8, 8, 8, 8, 8,
  8, 4, 8, 8, 7, 10, 8, 8,
  8, 8, 8, 8, 8, 8, 8, 10,
  8, 8, 8, 4, 7, 4, 7, 9,
  5, 7, 7, 7, 7, 7, 6, 7,
  7, 4, 5, 6, 4, 8, 7, 8,
  7, 8, 6, 6, 5, 7, 8, 8,
  6, 7, 7, 5, 3, 5, 8, 6,
];
const textMeasureCanvas = document.createElement("canvas");
const textMeasureContext = textMeasureCanvas.getContext("2d");

const initialSpec: ThemeSpec = {
  themeSpecVersion: 1,
  themeId: "mini-classic",
  themeRev: FIXED_THEME_REV,
  fallbackTheme: FIXED_FALLBACK_THEME,
  bgColor: "#000000",
  primitives: [
    { type: "text", x: 75, y: 4, binding: "label", fontSize: 3, color: "#999999" },
    { type: "text", x: 7, y: 30, text: "Session", font: 2, fontSize: 2, color: "#999999" },
    { type: "text", x: 7, y: 66, text: "{session}%", fontSize: 5, color: "#CCFF00" },
    { type: "text", x: 31, y: 106, binding: "usageMode", font: 2, fontSize: 1, color: "#999999" },
    { type: "text", x: 129, y: 30, text: "Weekly", font: 2, fontSize: 2, color: "#999999" },
    { type: "text", x: 134, y: 66, text: "{weekly}%", fontSize: 5, color: "#CCFF00" },
    { type: "text", x: 151, y: 106, binding: "usageMode", font: 2, fontSize: 1, color: "#999999" },
    { type: "gif", x: 80, y: 115, width: 80, height: 80, assetPath: "/themes/mini/mini.gif" },
    { type: "text", x: 42, y: 209, text: "Reset {reset}", fontSize: 2, color: "#999999" },
  ],
};

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("missing #app root");
}
const app = appRoot;
let stage: Konva.Stage | null = null;
let gifRedrawAnimation: Konva.Animation | null = null;
const gifImageCache = new Map<string, HTMLImageElement>();

const state: AppState = {
  spec: cloneSpec(initialSpec),
  selectedIndex: -1,
  hoveredIndex: null,
  editingTextIndex: null,
  copiedPrimitive: null,
  gifAssets: {},
  jsonText: "",
  jsonDirty: false,
  errors: [],
  warnings: [],
  notice: "",
  targetOrigin: storedTargetOrigin(),
};
syncJsonFromSpec();
render();
window.addEventListener("keydown", handleGlobalKeydown);

function cloneSpec(spec: ThemeSpec): ThemeSpec {
  return JSON.parse(JSON.stringify(spec)) as ThemeSpec;
}

function minifiedJson(spec: ThemeSpec): string {
  return JSON.stringify(spec);
}

function prettyJson(spec: ThemeSpec): string {
  return JSON.stringify(spec, null, 2);
}

function storedTargetOrigin(): string {
  try {
    return normalizeTargetOrigin(window.localStorage.getItem(TARGET_STORAGE_KEY) ?? DEFAULT_TARGET_ORIGIN);
  } catch {
    return DEFAULT_TARGET_ORIGIN;
  }
}

function persistTargetOrigin() {
  try {
    window.localStorage.setItem(TARGET_STORAGE_KEY, state.targetOrigin);
  } catch {
    // Local storage is optional; sending still works without it.
  }
}

function normalizeTargetOrigin(value: string): string {
  const raw = value.trim() || DEFAULT_TARGET_ORIGIN;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

function syncJsonFromSpec() {
  normalizeMiniThemeSpec();
  state.jsonText = prettyJson(state.spec);
  state.jsonDirty = false;
  validateCurrentSpec();
}

function normalizeMiniThemeSpec() {
  state.spec.themeSpecVersion = 1;
  state.spec.themeRev = FIXED_THEME_REV;
  state.spec.fallbackTheme = FIXED_FALLBACK_THEME;
}

function validateCurrentSpec() {
  const errors: string[] = [];
  const warnings: string[] = [];
  const spec = state.spec;

  if (spec.themeSpecVersion !== 1) {
    errors.push("themeSpecVersion muss 1 sein.");
  }
  if (!THEME_ID_RE.test(spec.themeId)) {
    errors.push("themeId muss klein geschrieben sein und 3-64 Zeichen haben.");
  }
  if (spec.themeRev !== FIXED_THEME_REV) {
    errors.push(`themeRev muss ${FIXED_THEME_REV} sein.`);
  }
  if (spec.fallbackTheme !== FIXED_FALLBACK_THEME) {
    errors.push("fallbackTheme muss mini sein.");
  }
  if (spec.bgColor && !COLOR_RE.test(spec.bgColor)) {
    errors.push("Background muss #RRGGBB sein.");
  }
  if (!Array.isArray(spec.primitives) || spec.primitives.length === 0) {
    errors.push("Mindestens ein Primitive ist erforderlich.");
  }
  if (spec.primitives.length > MAX_PRIMITIVES) {
    errors.push(`Zu viele Primitives: ${spec.primitives.length}/${MAX_PRIMITIVES}.`);
  }

  spec.primitives.forEach((primitive, index) => {
    const prefix = `Primitive ${index + 1}`;
    if (!["rect", "text", "progress", "gif"].includes(primitive.type)) {
      errors.push(`${prefix}: type muss rect, text, progress oder gif sein.`);
    }
    if (!isNonNegativeInteger(primitive.x) || !isNonNegativeInteger(primitive.y)) {
      errors.push(`${prefix}: x/y müssen ganze Zahlen ab 0 sein.`);
    }
    for (const key of ["color", "bgColor", "borderColor"] as const) {
      const value = primitive[key];
      if (value && !COLOR_RE.test(value)) {
        errors.push(`${prefix}: ${key} muss #RRGGBB sein.`);
      }
    }
    if (primitive.type === "text") {
      if ((!primitive.text || primitive.text.trim() === "") && !primitive.binding) {
        errors.push(`${prefix}: text oder binding ist erforderlich.`);
      }
      if (primitive.fontSize !== undefined && (!Number.isInteger(primitive.fontSize) || primitive.fontSize < 1)) {
        errors.push(`${prefix}: fontSize sollte mindestens 1 sein.`);
      }
      if (primitive.font !== undefined && !fontOptions.some((font) => font.value === primitive.font)) {
        errors.push(`${prefix}: font wird vom VibeTV nicht unterstützt.`);
      }
    }
    if (primitive.type === "rect" || primitive.type === "progress") {
      if (!isPositiveInteger(primitive.width) || !isPositiveInteger(primitive.height)) {
        errors.push(`${prefix}: width/height müssen größer als 0 sein.`);
      }
    }
    if (primitive.type === "gif") {
      if (!isPositiveInteger(primitive.width) || !isPositiveInteger(primitive.height)) {
        errors.push(`${prefix}: width/height müssen größer als 0 sein.`);
      }
      if (!primitive.assetPath || !primitive.assetPath.startsWith("/themes/")) {
        errors.push(`${prefix}: assetPath muss unter /themes/... liegen.`);
      }
      if (primitive.assetPath && primitive.assetPath.length > MAX_ESP8266_LITTLEFS_PATH_CHARS) {
        errors.push(`${prefix}: assetPath ist zu lang für ESP8266 LittleFS (${primitive.assetPath.length}/${MAX_ESP8266_LITTLEFS_PATH_CHARS}).`);
      }
    }
    const width = primitive.width ?? estimatePrimitiveWidth(primitive);
    const height = primitive.height ?? estimatePrimitiveHeight(primitive);
    if (primitive.x + width > DISPLAY_SIZE || primitive.y + height > DISPLAY_SIZE) {
      warnings.push(`${prefix}: liegt teilweise außerhalb von 240x240.`);
    }
  });

  const bytes = new TextEncoder().encode(minifiedJson(spec)).length;
  if (bytes > MAX_SPEC_BYTES) {
    errors.push(`ThemeSpec ist zu groß: ${bytes}/${MAX_SPEC_BYTES} Bytes.`);
  }
  const frameBytes = new TextEncoder().encode(JSON.stringify(buildFramePayload())).length;
  if (frameBytes > MAX_FRAME_BYTES) {
    errors.push(`Frame ist zu groß für Vibe TV: ${frameBytes}/${MAX_FRAME_BYTES} Bytes.`);
  }

  state.errors = errors;
  state.warnings = warnings;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function render() {
  validateCurrentSpec();
  const selected = state.spec.primitives[state.selectedIndex];
  const bytes = new TextEncoder().encode(minifiedJson(state.spec)).length;
  const frameBytes = new TextEncoder().encode(JSON.stringify(buildFramePayload())).length;

  app.innerHTML = `
    <section class="studio-shell">
      <header class="appbar">
        <h1>Theme Studio</h1>
        <div class="status-strip">
          ${metric("Bytes", bytes, MAX_SPEC_BYTES)}
          ${metric("Frame", frameBytes, MAX_FRAME_BYTES)}
          ${metric("Primitives", state.spec.primitives.length, MAX_PRIMITIVES)}
          <span class="health ${state.errors.length ? "bad" : "ok"}">${state.errors.length ? "Invalid" : "Valid"}</span>
        </div>
      </header>

      <section class="workspace">
        <aside class="panel left-panel">
          <div class="panel-head theme-head">
            <h2>Theme</h2>
            <input class="theme-name-input" data-field="themeId" aria-label="Theme name" value="${escapeAttr(state.spec.themeId)}" />
          </div>
          <label>Vibe TV
            <input data-field="targetOrigin" aria-label="Vibe TV URL" value="${escapeAttr(state.targetOrigin)}" />
          </label>
          <label>Background
            <span class="color-row">
              <input type="color" data-field="bgColor" value="${escapeAttr(state.spec.bgColor ?? "#000000")}" />
              <input data-field="bgColor" value="${escapeAttr(state.spec.bgColor ?? "#000000")}" />
            </span>
          </label>
          <div class="divider"></div>
          ${addElementPalette()}
          <div class="divider"></div>
          ${variableGuide()}
          <div class="divider"></div>
          <h2 class="section-title">Elements</h2>
          <div class="primitive-list">
            ${state.spec.primitives.map((primitive, index) => primitiveRow(primitive, index)).join("")}
          </div>
          <input class="hidden-file-input" data-role="gif-input" type="file" accept="image/gif,.gif" />
        </aside>

        <section class="preview-column">
          <div class="device-frame">
            ${renderPreview()}
          </div>
          <div class="preview-actions">
            <button class="primary-action" data-action="send-theme" ${state.errors.length ? "disabled" : ""}>Send to Vibe TV</button>
            <button data-action="download-json">Save Theme</button>
            <button data-action="copy-json">Copy JSON</button>
          </div>
          ${messageList()}
        </section>

        <aside class="panel right-panel">
          <details class="inspector-panel" open>
            <summary>${selected ? `${selected.type} ${state.selectedIndex + 1}` : "Inspector"}</summary>
            ${selected ? `<button class="danger-button full-width" data-action="delete-selected">Delete</button>${inspectorFields(selected)}` : `<p class="empty">Select an element.</p>`}
          </details>
          <details class="advanced-panel">
            <summary>Advanced JSON</summary>
            <div class="panel-head compact">
              <h2>Theme JSON</h2>
              <button data-action="apply-json">Apply JSON</button>
            </div>
            <textarea class="json-editor" spellcheck="false" data-role="json-editor">${escapeHtml(state.jsonText)}</textarea>
          </details>
        </aside>
      </section>
    </section>
  `;

  bindEvents();
  mountKonvaPreview();
  focusInlineTextEditor();
}

function metric(label: string, value: number, max: number): string {
  const over = value > max;
  return `<span class="metric ${over ? "bad" : ""}"><b>${value}</b><small>${label} / ${max}</small></span>`;
}

function addElementPalette(): string {
  return `
    <section class="add-elements">
      <h2 class="section-title">Add Element</h2>
      <div class="add-card-grid">
        <button class="add-card" data-action="add-text">
          <span class="add-icon text-icon">T</span>
          <strong>Text</strong>
        </button>
        <button class="add-card" data-action="add-progress">
          <span class="add-icon bar-icon"><i></i></span>
          <strong>Bar</strong>
        </button>
        <button class="add-card" data-action="add-rect">
          <span class="add-icon rect-icon"></span>
          <strong>Rect</strong>
        </button>
        <button class="add-card" data-action="add-gif">
          <span class="add-icon gif-icon">GIF</span>
          <strong>GIF</strong>
        </button>
      </div>
    </section>
  `;
}

function variableGuide(): string {
  return `
    <section class="variable-guide">
      <h2 class="section-title">Variables</h2>
      <div class="token-grid">
        ${variableTokens.map((item) => `
          <button class="token-chip" data-insert-token="${escapeAttr(item.token)}" title="Insert ${escapeAttr(item.token)}">
            <strong>${escapeHtml(item.label)}</strong>
            <code>${escapeHtml(item.token)}</code>
            <span>${escapeHtml(item.preview)}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function primitiveRow(primitive: Primitive, index: number): string {
  const title = primitiveTitle(primitive);
  return `
    <button class="primitive-row ${index === state.selectedIndex ? "selected" : ""}" data-select="${index}">
      <span>${index + 1}</span>
      <strong>${primitive.type}</strong>
      <em>${escapeHtml(title)}</em>
    </button>
  `;
}

function primitiveTitle(primitive: Primitive): string {
  if (primitive.type === "text") {
    return primitive.text || primitive.binding || "Text";
  }
  if (primitive.type === "progress") {
    return primitive.binding || "session";
  }
  if (primitive.type === "gif") {
    return primitive.assetPath?.split("/").pop() || "GIF";
  }
  return primitive.color || "Rect";
}

function inspectorFields(primitive: Primitive): string {
  const common = `
    <div class="field-grid">
      <label>X<input type="number" min="0" step="1" data-primitive-field="x" value="${primitive.x}" /></label>
      <label>Y<input type="number" min="0" step="1" data-primitive-field="y" value="${primitive.y}" /></label>
    </div>
    <label>Rotation<input type="number" min="0" max="359" step="1" data-primitive-field="rotation" value="${primitive.rotation ?? 0}" /></label>
  `;

  if (primitive.type === "text") {
    return `
      ${common}
      <label>Text<input data-primitive-field="text" value="${escapeAttr(primitive.text ?? "")}" /></label>
      <div class="field-grid">
        <label>Font
          <select data-primitive-field="font">
            ${fontSelectOptions(primitive.font)}
          </select>
        </label>
        <label>Size<input type="number" min="1" step="1" data-primitive-field="fontSize" value="${primitive.fontSize ?? 1}" /></label>
      </div>
      ${colorField("Color", "color", primitive.color ?? "#FFFFFF")}
      ${colorField("Background", "bgColor", primitive.bgColor ?? "#000000")}
    `;
  }

  if (primitive.type === "progress") {
    return `
      ${common}
      <div class="field-grid">
        <label>Width<input type="number" min="1" step="1" data-primitive-field="width" value="${primitive.width ?? 100}" /></label>
        <label>Height<input type="number" min="1" step="1" data-primitive-field="height" value="${primitive.height ?? 12}" /></label>
      </div>
      <label>Binding
        <select data-primitive-field="binding">
          ${["session", "weekly"].map((value) => `<option value="${value}" ${primitive.binding === value ? "selected" : ""}>${value}</option>`).join("")}
        </select>
      </label>
      ${colorField("Fill", "color", primitive.color ?? "#FFFFFF")}
      ${colorField("Track", "bgColor", primitive.bgColor ?? "#000000")}
      ${colorField("Border", "borderColor", primitive.borderColor ?? "#7B7B7B")}
    `;
  }

  if (primitive.type === "gif") {
    return `
      ${common}
      <label>Asset<input data-primitive-field="assetPath" value="${escapeAttr(primitive.assetPath ?? "")}" /></label>
      <div class="field-grid">
        <label>Width<input type="number" min="1" step="1" data-primitive-field="width" value="${primitive.width ?? DEFAULT_GIF_SIZE}" /></label>
        <label>Height<input type="number" min="1" step="1" data-primitive-field="height" value="${primitive.height ?? DEFAULT_GIF_SIZE}" /></label>
      </div>
    `;
  }

  return `
    ${common}
    <div class="field-grid">
      <label>Width<input type="number" min="1" step="1" data-primitive-field="width" value="${primitive.width ?? 32}" /></label>
      <label>Height<input type="number" min="1" step="1" data-primitive-field="height" value="${primitive.height ?? 32}" /></label>
    </div>
    ${colorField("Color", "color", primitive.color ?? "#FFFFFF")}
  `;
}

function colorField(label: string, key: keyof Primitive, value: string): string {
  return `
    <label>${label}
      <span class="color-row">
        <input type="color" data-primitive-field="${key}" value="${escapeAttr(value)}" />
        <input data-primitive-field="${key}" value="${escapeAttr(value)}" />
      </span>
    </label>
  `;
}

function renderPreview(): string {
  return `<div class="display konva-display" data-role="konva-stage" aria-label="Theme preview"></div>`;
}

function mountKonvaPreview() {
  const container = app.querySelector<HTMLDivElement>("[data-role='konva-stage']");
  gifRedrawAnimation?.stop();
  gifRedrawAnimation = null;
  stage?.destroy();
  stage = null;

  if (!container) {
    return;
  }

  const stageSize = previewStageSize(container);
  const previewScale = stageSize / DISPLAY_SIZE;
  stage = new Konva.Stage({
    container,
    width: stageSize,
    height: stageSize,
  });

  const layer = new Konva.Layer();
  layer.scale({ x: previewScale, y: previewScale });
  stage.add(layer);
  layer.add(new Konva.Rect({
    x: 0,
    y: 0,
    width: DISPLAY_SIZE,
    height: DISPLAY_SIZE,
    fill: state.spec.bgColor ?? "#000000",
    listening: false,
  }));

  const nodes: EditableKonvaNode[] = [];
  let hasAnimatedGif = false;
  state.spec.primitives.forEach((primitive, index) => {
    const result = konvaNodeForPrimitive(primitive, index);
    if (!result) {
      return;
    }
    layer.add(result.node);
    nodes[index] = result.node;
    hasAnimatedGif = hasAnimatedGif || result.animated;
  });

  const selected = state.spec.primitives[state.selectedIndex];
  const selectedNode = nodes[state.selectedIndex];
  if (selected && selectedNode) {
    const transformer = new Konva.Transformer({
      nodes: [selectedNode],
      rotateEnabled: true,
      keepRatio: selected.type === "gif",
      borderStroke: "#c7ff68",
      borderStrokeWidth: 1.5,
      anchorFill: "#c7ff68",
      anchorStroke: "#0a0b0d",
      anchorSize: 8,
      anchorCornerRadius: 2,
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      boundBoxFunc: (_oldBox, newBox) => {
        if (newBox.width < 4 || newBox.height < 4) {
          return _oldBox;
        }
        return newBox;
      },
    });
    layer.add(transformer);
  }

  stage.on("pointerdown", (event) => {
    if (event.target !== stage) {
      return;
    }
    state.selectedIndex = -1;
    state.editingTextIndex = null;
    state.notice = "";
    render();
  });

  layer.draw();
  if (hasAnimatedGif) {
    gifRedrawAnimation = new Konva.Animation(() => undefined, layer);
    gifRedrawAnimation.start();
  }
}

function previewStageSize(container: HTMLDivElement): number {
  const rect = container.getBoundingClientRect();
  const measured = Math.round(Math.min(rect.width, rect.height));
  return measured > 0 ? measured : DISPLAY_SIZE;
}

function konvaNodeForPrimitive(primitive: Primitive, index: number): { node: EditableKonvaNode; animated: boolean } | null {
  let node: EditableKonvaNode;
  let animated = false;

  if (primitive.type === "rect") {
    node = new Konva.Rect({
      ...commonKonvaProps(primitive, index),
      width: primitive.width ?? 1,
      height: primitive.height ?? 1,
      fill: primitive.color ?? "#000000",
    });
  } else if (primitive.type === "progress") {
    node = progressKonvaGroup(primitive, index);
  } else if (primitive.type === "gif") {
    const result = gifKonvaGroup(primitive, index);
    node = result.node;
    animated = result.animated;
  } else {
    node = textKonvaGroup(primitive, index);
  }

  bindKonvaNodeEvents(node, index);
  return { node, animated };
}

function commonKonvaProps(primitive: Primitive, index: number) {
  return {
    x: primitive.x,
    y: primitive.y,
    rotation: normalizeRotation(primitive.rotation ?? 0),
    draggable: true,
    id: `primitive-${index}`,
    name: "primitive",
    primitiveIndex: index,
  };
}

function progressKonvaGroup(primitive: Primitive, index: number): Konva.Group {
  const width = primitive.width ?? 1;
  const height = primitive.height ?? 1;
  const pct = primitive.binding === "weekly" || primitive.binding === "weeklyPercent" ? frame.weekly : frame.session;
  const fillWidth = Math.max(0, Math.min(width - 2, Math.floor((width * pct) / 100)));
  const group = new Konva.Group({
    ...commonKonvaProps(primitive, index),
    width,
    height,
  });
  group.add(new Konva.Rect({
    x: 0,
    y: 0,
    width,
    height,
    fill: primitive.bgColor ?? "#000000",
    stroke: primitive.borderColor ?? "#7B7B7B",
    strokeWidth: 1,
  }));
  group.add(new Konva.Rect({
    x: 1,
    y: 1,
    width: fillWidth,
    height: Math.max(0, height - 2),
    fill: primitive.color ?? "#FFFFFF",
  }));
  return group;
}

function textKonvaGroup(primitive: Primitive, index: number): Konva.Group {
  const font = fontOptionFor(primitive.font);
  const text = primitive.binding ? bindingValue(primitive.binding) : renderTemplate(primitive.text ?? "");
  const fontSize = textPixelSize(primitive);
  const width = estimatePrimitiveWidth(primitive);
  const height = estimatePrimitiveHeight(primitive);
  const group = new Konva.Group({
    ...commonKonvaProps(primitive, index),
    width,
    height,
  });
  const textNode = new Konva.Text({
    x: 0,
    y: 0,
    text,
    fontSize,
    fontFamily: previewFontFamily(primitive.font, font.family),
    fontStyle: font.weight >= 800 ? "800" : "700",
    fill: primitive.color ?? "#FFFFFF",
    listening: false,
  });
  const measuredWidth = measureKonvaTextWidth(text, fontSize, textNode.fontFamily(), textNode.fontStyle());
  if (measuredWidth > 0) {
    textNode.scaleX(width / measuredWidth);
  }
  const previewCanvas = textPreviewCanvas(primitive, text, width, height, fontSize, textNode.fontFamily(), textNode.fontStyle());
  group.add(new Konva.Image({
    x: 0,
    y: 0,
    width,
    height,
    image: previewCanvas,
    imageSmoothingEnabled: false,
    listening: false,
  }));
  return group;
}

function gifKonvaGroup(primitive: Primitive, index: number): { node: Konva.Group; animated: boolean } {
  const width = primitive.width ?? DEFAULT_GIF_SIZE;
  const height = primitive.height ?? DEFAULT_GIF_SIZE;
  const group = new Konva.Group({
    ...commonKonvaProps(primitive, index),
    width,
    height,
  });
  const image = primitive.assetPath ? gifImageFor(primitive.assetPath) : null;
  if (image) {
    const rect = fitContainRect(0, 0, width, height, gifAspectRatio(primitive));
    group.add(new Konva.Rect({
      x: 0,
      y: 0,
      width,
      height,
      fill: "rgba(0,0,0,0)",
    }));
    group.add(new Konva.Image({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      image,
    }));
    return { node: group, animated: true };
  }

  group.add(new Konva.Rect({
    x: 0,
    y: 0,
    width,
    height,
    fill: "#141922",
    stroke: "#c7ff68",
    strokeWidth: 1,
    dash: [4, 3],
  }));
  group.add(new Konva.Text({
    x: 0,
    y: Math.max(0, height / 2 - 6),
    width,
    height: 14,
    text: "GIF",
    align: "center",
    fontSize: 12,
    fontFamily: fallbackFont.family,
    fontStyle: "800",
    fill: "#c7ff68",
    listening: false,
  }));
  return { node: group, animated: false };
}

function fitContainRect(x: number, y: number, width: number, height: number, ratio: number) {
  if (width <= 0 || height <= 0 || ratio <= 0) {
    return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
  }
  let drawWidth = width;
  let drawHeight = Math.round(width / ratio);
  if (drawHeight > height) {
    drawHeight = height;
    drawWidth = Math.round(height * ratio);
  }
  return {
    x: x + Math.round((width - drawWidth) / 2),
    y: y + Math.round((height - drawHeight) / 2),
    width: Math.max(1, drawWidth),
    height: Math.max(1, drawHeight),
  };
}

function gifImageFor(assetPath: string): HTMLImageElement | null {
  const previewUrl = state.gifAssets[assetPath]?.previewUrl ?? builtInGifPreviewUrl(assetPath);
  if (!previewUrl) {
    return null;
  }
  const key = `${assetPath}|${previewUrl}`;
  const cached = gifImageCache.get(key);
  if (cached) {
    return cached;
  }

  const image = new Image();
  image.decoding = "async";
  image.src = previewUrl;
  gifImageCache.set(key, image);
  return image;
}

function bindKonvaNodeEvents(node: Konva.Node, index: number) {
  node.on("pointerdown", () => {
    state.selectedIndex = index;
    state.editingTextIndex = null;
    state.notice = "";
  });
  node.on("click tap", () => {
    state.selectedIndex = index;
    state.editingTextIndex = null;
    state.notice = "";
    render();
  });
  node.on("dblclick dbltap", () => {
    const primitive = state.spec.primitives[index];
    if (primitive?.type === "text") {
      state.selectedIndex = index;
      state.editingTextIndex = index;
      state.notice = "";
      render();
    }
  });
  node.on("dragend", () => {
    commitKonvaTransform(node, index);
  });
  node.on("transformend", () => {
    commitKonvaTransform(node, index);
  });
}

function commitKonvaTransform(node: Konva.Node, index: number) {
  const primitive = state.spec.primitives[index];
  if (!primitive) {
    return;
  }

  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  const baseWidth = estimatePrimitiveWidth(primitive);
  const baseHeight = estimatePrimitiveHeight(primitive);
  const nextWidth = Math.max(1, Math.round(baseWidth * Math.abs(scaleX || 1)));
  const nextHeight = Math.max(1, Math.round(baseHeight * Math.abs(scaleY || 1)));

  primitive.x = clamp(Math.round(node.x()), 0, DISPLAY_SIZE - 1);
  primitive.y = clamp(Math.round(node.y()), 0, DISPLAY_SIZE - 1);
  primitive.rotation = normalizeRotation(Math.round(node.rotation()));

  if (primitive.type === "text") {
    const nextSize = Math.max(Math.abs(scaleX || 1), Math.abs(scaleY || 1));
    primitive.fontSize = clamp(Math.round((primitive.fontSize ?? 1) * nextSize), 1, 12);
  } else if (primitive.type === "gif") {
    const ratio = gifAspectRatio(primitive);
    if (Math.abs(scaleY) > Math.abs(scaleX)) {
      applyGifHeight(primitive, ratio, nextHeight);
    } else {
      applyGifWidth(primitive, ratio, nextWidth);
    }
  } else {
    primitive.width = clamp(nextWidth, 1, DISPLAY_SIZE - primitive.x);
    primitive.height = clamp(nextHeight, 1, DISPLAY_SIZE - primitive.y);
  }

  node.scale({ x: 1, y: 1 });
  state.selectedIndex = index;
  state.editingTextIndex = null;
  syncJsonFromSpec();
  render();
}

function renderPrimitive(primitive: Primitive, index: number): string {
  const selected = index === state.selectedIndex;
  const active = selected || index === state.hoveredIndex;
  const handle = active ? selectionHandle(primitive, index) : "";
  const hitTarget = primitiveHitTarget(primitive, index);
  const transform = rotationTransform(primitive);
  if (primitive.type === "rect") {
    return `
      <g${transform}>
        <rect class="${selected ? "selected-shape" : ""}" x="${primitive.x}" y="${primitive.y}" width="${primitive.width ?? 1}" height="${primitive.height ?? 1}" fill="${escapeAttr(primitive.color ?? "#000000")}"></rect>
        ${hitTarget}
      </g>
      ${handle}
    `;
  }
  if (primitive.type === "progress") {
    const width = primitive.width ?? 1;
    const height = primitive.height ?? 1;
    const pct = primitive.binding === "weekly" || primitive.binding === "weeklyPercent" ? frame.weekly : frame.session;
    const fillWidth = Math.max(0, Math.min(width, Math.round((width * pct) / 100)));
    return `
      <g${transform}>
        <rect x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" fill="${escapeAttr(primitive.bgColor ?? "#000000")}" stroke="${escapeAttr(primitive.borderColor ?? "#7B7B7B")}" stroke-width="1"></rect>
        <rect x="${primitive.x + 2}" y="${primitive.y + 2}" width="${Math.max(0, fillWidth - 4)}" height="${Math.max(0, height - 4)}" fill="${escapeAttr(primitive.color ?? "#FFFFFF")}"></rect>
        ${hitTarget}
      </g>
      ${handle}
    `;
  }
  if (primitive.type === "gif") {
    const width = primitive.width ?? 64;
    const height = primitive.height ?? 64;
    const previewUrl = primitive.assetPath ? state.gifAssets[primitive.assetPath]?.previewUrl ?? builtInGifPreviewUrl(primitive.assetPath) : undefined;
    const placeholder = `
      <rect x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" fill="#141922" stroke="#c7ff68" stroke-width="1" stroke-dasharray="4 3"></rect>
      <text x="${primitive.x + width / 2}" y="${primitive.y + height / 2 + 4}" text-anchor="middle" font-size="12" fill="#c7ff68" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="800">GIF</text>
    `;
    return `
      <g${transform}>
        ${previewUrl ? `<image href="${escapeAttr(previewUrl)}" x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"></image>` : placeholder}
        ${hitTarget}
      </g>
      ${handle}
    `;
  }

  const fontPx = textPixelSize(primitive);
  const text = primitive.binding ? bindingValue(primitive.binding) : renderTemplate(primitive.text ?? "");
  const isEditing = state.editingTextIndex === index;
  const font = fontOptionFor(primitive.font);
  return `
    <g${transform}>
      ${isEditing ? inlineTextEditor(primitive, index) : `<text class="preview-text ${selected ? "selected-text" : ""}" x="${primitive.x}" y="${primitive.y}" dominant-baseline="hanging" font-size="${fontPx}" fill="${escapeAttr(primitive.color ?? "#FFFFFF")}" font-family="${escapeAttr(font.family)}" font-weight="${font.weight}">${escapeHtml(text)}</text>`}
      ${isEditing ? "" : hitTarget}
    </g>
    ${handle}
  `;
}

function inlineTextEditor(primitive: Primitive, index: number): string {
  const width = Math.min(DISPLAY_SIZE - primitive.x, Math.max(42, estimatePrimitiveWidth(primitive) + 10));
  const height = Math.max(18, estimatePrimitiveHeight(primitive) + 6);
  const font = fontOptionFor(primitive.font);
  return `
    <foreignObject class="inline-text-editor" x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}">
      <input xmlns="http://www.w3.org/1999/xhtml" style="font-family:${escapeAttr(font.family)};font-weight:${font.weight}" data-inline-text="${index}" value="${escapeAttr(primitive.text ?? "")}" />
    </foreignObject>
  `;
}

function primitiveHitTarget(primitive: Primitive, index: number): string {
  const width = estimatePrimitiveWidth(primitive);
  const height = estimatePrimitiveHeight(primitive);
  return `<rect class="primitive-hit" data-drag="${index}" x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" fill="transparent"></rect>`;
}

function selectionHandle(primitive: Primitive, index: number): string {
  const width = estimatePrimitiveWidth(primitive);
  const height = estimatePrimitiveHeight(primitive);
  const box = `<rect class="selection-box" x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" fill="none"></rect>`;
  const handles = primitive.type === "text"
    ? resizeHandle(index, "se", primitive.x + width, primitive.y + height)
    : [
        resizeHandle(index, "e", primitive.x + width, primitive.y + height / 2),
        resizeHandle(index, "s", primitive.x + width / 2, primitive.y + height),
        resizeHandle(index, "se", primitive.x + width, primitive.y + height),
      ].join("");
  return `<g${rotationTransform(primitive)}>${box}${handles}</g>${canvasToolbar(primitive)}`;
}

function canvasToolbar(primitive: Primitive): string {
  const width = primitive.type === "text" ? 128 : primitive.type === "progress" ? 110 : primitive.type === "gif" ? 48 : 74;
  const height = 22;
  const x = clamp(primitive.x, 0, Math.max(0, DISPLAY_SIZE - width));
  const y = primitive.y > height + 4 ? primitive.y - height - 4 : primitive.y + estimatePrimitiveHeight(primitive) + 6;

  if (primitive.type === "text") {
    return `
      <foreignObject class="canvas-toolbar" x="${x}" y="${clamp(y, 0, DISPLAY_SIZE - height)}" width="${width}" height="${height}">
        <div xmlns="http://www.w3.org/1999/xhtml" class="canvas-toolbar-inner">
          ${rotationControls(primitive)}
          <span class="toolbar-separator"></span>
          <button class="toolbar-icon" data-font-size-delta="-1" title="Smaller text" aria-label="Smaller text">A-</button>
          <button class="toolbar-icon" data-font-size-delta="1" title="Bigger text" aria-label="Bigger text">A+</button>
          <span class="toolbar-separator"></span>
          <input data-canvas-field="color" type="color" value="${escapeAttr(primitive.color ?? "#FFFFFF")}" aria-label="Text color" />
          <input data-canvas-field="bgColor" type="color" value="${escapeAttr(primitive.bgColor ?? "#000000")}" aria-label="Text background" />
        </div>
      </foreignObject>
    `;
  }

  if (primitive.type === "progress") {
    return `
      <foreignObject class="canvas-toolbar" x="${x}" y="${clamp(y, 0, DISPLAY_SIZE - height)}" width="${width}" height="${height}">
        <div xmlns="http://www.w3.org/1999/xhtml" class="canvas-toolbar-inner">
          ${rotationControls(primitive)}
          <span class="toolbar-separator"></span>
          <input data-canvas-field="color" type="color" value="${escapeAttr(primitive.color ?? "#FFFFFF")}" aria-label="Fill color" />
          <input data-canvas-field="bgColor" type="color" value="${escapeAttr(primitive.bgColor ?? "#000000")}" aria-label="Track color" />
          <input data-canvas-field="borderColor" type="color" value="${escapeAttr(primitive.borderColor ?? "#7B7B7B")}" aria-label="Border color" />
        </div>
      </foreignObject>
    `;
  }

  if (primitive.type === "gif") {
    return `
      <foreignObject class="canvas-toolbar" x="${x}" y="${clamp(y, 0, DISPLAY_SIZE - height)}" width="${width}" height="${height}">
        <div xmlns="http://www.w3.org/1999/xhtml" class="canvas-toolbar-inner">
          ${rotationControls(primitive)}
        </div>
      </foreignObject>
    `;
  }

  return `
    <foreignObject class="canvas-toolbar" x="${x}" y="${clamp(y, 0, DISPLAY_SIZE - height)}" width="${width}" height="${height}">
      <div xmlns="http://www.w3.org/1999/xhtml" class="canvas-toolbar-inner">
        ${rotationControls(primitive)}
        <span class="toolbar-separator"></span>
        <input data-canvas-field="color" type="color" value="${escapeAttr(primitive.color ?? "#FFFFFF")}" aria-label="Color" />
      </div>
    </foreignObject>
  `;
}

function rotationControls(primitive: Primitive): string {
  return `
    <button class="toolbar-icon" data-rotate-delta="-15" title="Rotate left" aria-label="Rotate left">↶</button>
    <button class="toolbar-icon" data-rotate-delta="15" title="Rotate right" aria-label="Rotate right">↷</button>
  `;
}

function rotationTransform(primitive: Primitive): string {
  const rotation = normalizeRotation(primitive.rotation ?? 0);
  if (rotation === 0) {
    return "";
  }
  const center = primitiveCenter(primitive);
  return ` transform="rotate(${rotation} ${center.x} ${center.y})"`;
}

function primitiveCenter(primitive: Primitive): { x: number; y: number } {
  return {
    x: primitive.x + estimatePrimitiveWidth(primitive) / 2,
    y: primitive.y + estimatePrimitiveHeight(primitive) / 2,
  };
}

function resizeHandle(index: number, handle: ResizeHandle, x: number, y: number): string {
  const size = 7;
  return `<rect class="resize-handle resize-${handle}" data-resize-index="${index}" data-resize-handle="${handle}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" rx="1.5"></rect>`;
}

function estimatePrimitiveWidth(primitive: Primitive): number {
  if (primitive.type === "text") {
    const text = primitive.binding ? bindingValue(primitive.binding) : renderTemplate(primitive.text ?? "");
    return Math.max(1, firmwareTextWidth(text, primitive.font, primitive.fontSize));
  }
  return primitive.width ?? 1;
}

function estimatePrimitiveHeight(primitive: Primitive): number {
  if (primitive.type === "text") {
    return Math.max(8, textPixelSize(primitive));
  }
  return primitive.height ?? 1;
}

function textPixelSize(primitive: Primitive): number {
  return firmwareFontHeight(primitive.font, primitive.fontSize);
}

function firmwareFontHeight(fontValue: number | undefined, fontSizeValue: number | undefined): number {
  const size = Math.max(1, fontSizeValue ?? 1);
  const font = fontOptionFor(fontValue);
  if (font.value === 2) {
    return size * 16;
  }
  return size * 8;
}

function firmwareTextWidth(text: string, fontValue: number | undefined, fontSizeValue: number | undefined): number {
  const size = Math.max(1, fontSizeValue ?? 1);
  const font = fontOptionFor(fontValue);
  if (font.value === 2) {
    return textWidthFromTable(text, firmwareFont2Widths) * size;
  }
  return text.length * 6 * size;
}

function textWidthFromTable(text: string, widths: number[]): number {
  let width = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    width += code >= 32 && code < 128 ? widths[code - 32] : widths[0];
  }
  return width;
}

function previewFontFamily(fontValue: number | undefined, fallbackFamily: string): string {
  const font = fontOptionFor(fontValue);
  return font.value === 1 || font.value === 2 ? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" : fallbackFamily;
}

function measureKonvaTextWidth(text: string, fontSize: number, family: string, style: string): number {
  if (!textMeasureContext) {
    return 0;
  }
  textMeasureContext.font = `${style} ${fontSize}px ${family}`;
  return textMeasureContext.measureText(text).width;
}

function textPreviewCanvas(
  primitive: Primitive,
  text: string,
  width: number,
  height: number,
  fontSize: number,
  family: string,
  style: string,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const context = canvas.getContext("2d");
  if (!context) {
    return canvas;
  }
  context.imageSmoothingEnabled = false;
  context.fillStyle = primitive.bgColor ?? "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = primitive.color ?? "#FFFFFF";
  context.textBaseline = "top";
  context.font = `${style} ${fontSize}px ${family}`;
  const measuredWidth = context.measureText(text).width;
  if (measuredWidth > 0) {
    context.save();
    context.scale(width / measuredWidth, 1);
    context.fillText(text, 0, 0);
    context.restore();
    return canvas;
  }
  context.fillText(text, 0, 0);
  return canvas;
}

function renderTemplate(text: string): string {
  return text.replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => {
    return bindingValue(key);
  });
}

function bindingValue(key: string): string {
  const values: Record<string, string> = {
    label: frame.label,
    providerLabel: frame.label,
    provider: frame.provider,
    session: String(frame.session),
    sessionPercent: String(frame.session),
    weekly: String(frame.weekly),
    weeklyPercent: String(frame.weekly),
    reset: frame.reset,
    resetCountdown: frame.reset,
    usageMode: frame.usageMode,
    sessionTokens: String(frame.sessionTokens),
    weekTokens: String(frame.weekTokens),
    totalTokens: String(frame.totalTokens),
  };
  return values[key] ?? "";
}

function builtInGifPreviewUrl(assetPath: string): string | undefined {
  if (assetPath === "/themes/mini/mini.gif") {
    return assetPath;
  }
  return undefined;
}

function fontOptionFor(value: number | undefined) {
  return fontOptions.find((font) => font.value === value) ?? fallbackFont;
}

function fontSelectOptions(value: number | undefined): string {
  const selectedValue = fontOptionFor(value).value;
  return fontOptions.map((font) => `<option value="${font.value}" ${font.value === selectedValue ? "selected" : ""}>${font.label}</option>`).join("");
}

function fontWidthFactor(value: number | undefined): number {
  const font = fontOptionFor(value);
  if (font.value === 2) {
    return 5.8;
  }
  return 6;
}

function messageList(): string {
  const notices = state.notice ? [`<li class="notice">${escapeHtml(state.notice)}</li>`] : [];
  const errors = state.errors.map((msg) => `<li class="error">${escapeHtml(msg)}</li>`);
  const warnings = state.warnings.map((msg) => `<li class="warning">${escapeHtml(msg)}</li>`);
  const items = [...notices, ...errors, ...warnings];
  if (items.length === 0) {
    return `<ul class="messages"><li class="ok-message">Ready to send to Vibe TV.</li></ul>`;
  }
  return `<ul class="messages">${items.join("")}</ul>`;
}

function bindEvents() {
  app.querySelectorAll<HTMLElement>("[data-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedIndex = Number(button.dataset.select);
      state.editingTextIndex = null;
      state.notice = "";
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.field;
      if (key === "themeId") {
        state.spec.themeId = input.value.trim().toLowerCase();
      }
      if (key === "targetOrigin") {
        state.targetOrigin = input.value.trim();
        persistTargetOrigin();
      }
      if (key === "bgColor") {
        state.spec.bgColor = input.value.trim();
      }
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-primitive-field]").forEach((input) => {
    input.addEventListener("input", () => {
      updateSelectedPrimitive(input.dataset.primitiveField ?? "", input.value);
      if (isColorInput(input)) {
        syncStateWithoutRender();
        return;
      }
      syncJsonFromSpec();
      render();
    });
    input.addEventListener("change", () => {
      if (!isColorInput(input)) {
        return;
      }
      updateSelectedPrimitive(input.dataset.primitiveField ?? "", input.value);
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-canvas-field]").forEach((input) => {
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("input", (event) => {
      event.stopPropagation();
      updateSelectedPrimitive(input.dataset.canvasField ?? "", input.value);
      if (isColorInput(input)) {
        syncStateWithoutRender();
        return;
      }
      syncJsonFromSpec();
      render();
    });
    input.addEventListener("change", (event) => {
      event.stopPropagation();
      if (!isColorInput(input)) {
        return;
      }
      updateSelectedPrimitive(input.dataset.canvasField ?? "", input.value);
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement>("[data-inline-text]").forEach((input) => {
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("input", () => {
      const index = Number(input.dataset.inlineText);
      const primitive = state.spec.primitives[index];
      if (primitive?.type === "text") {
        primitive.text = input.value;
        normalizeMiniThemeSpec();
        state.jsonText = prettyJson(state.spec);
        state.jsonDirty = false;
        validateCurrentSpec();
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Escape") {
        finishInlineTextEdit();
      }
    });
    input.addEventListener("blur", finishInlineTextEdit);
  });

  app.querySelector<HTMLTextAreaElement>("[data-role='json-editor']")?.addEventListener("input", (event) => {
    state.jsonText = (event.target as HTMLTextAreaElement).value;
    state.jsonDirty = true;
  });

  app.querySelector<HTMLInputElement>("[data-role='gif-input']")?.addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      addGifPrimitive(file);
    }
    (event.target as HTMLInputElement).value = "";
  });

  app.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      void handleAction(button.dataset.action ?? "");
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-insert-token]").forEach((button) => {
    button.addEventListener("click", () => {
      insertToken(button.dataset.insertToken ?? "");
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-rotate-delta]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      rotateSelectedPrimitive(toInt(button.dataset.rotateDelta ?? "0", 0));
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-font-size-delta]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      adjustSelectedTextSize(toInt(button.dataset.fontSizeDelta ?? "0", 0));
    });
  });

  app.querySelectorAll<SVGElement>("[data-drag]").forEach((element) => {
    element.addEventListener("mouseenter", () => {
      state.hoveredIndex = Number(element.dataset.drag);
      render();
    });
    element.addEventListener("mouseleave", () => {
      const index = Number(element.dataset.drag);
      if (state.hoveredIndex === index) {
        state.hoveredIndex = null;
        render();
      }
    });
    element.addEventListener("click", () => {
      const index = Number(element.dataset.drag);
      state.selectedIndex = index;
      state.editingTextIndex = state.spec.primitives[index]?.type === "text" ? index : null;
      state.notice = "";
      render();
    });
    element.addEventListener("dblclick", () => {
      const index = Number(element.dataset.drag);
      if (state.spec.primitives[index]?.type === "text") {
        state.selectedIndex = index;
        state.editingTextIndex = index;
        state.notice = "";
        render();
      }
    });
    element.addEventListener("pointerdown", startDrag);
  });

  app.querySelectorAll<SVGElement>("[data-resize-index]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    element.addEventListener("pointerdown", startResize);
  });
}

function focusInlineTextEditor() {
  if (state.editingTextIndex === null) {
    return;
  }
  window.requestAnimationFrame(() => {
    const input = app.querySelector<HTMLInputElement>(`[data-inline-text="${state.editingTextIndex}"]`);
    input?.focus();
    input?.select();
  });
}

function syncStateWithoutRender() {
  normalizeMiniThemeSpec();
  state.jsonText = prettyJson(state.spec);
  state.jsonDirty = false;
  validateCurrentSpec();
}

function isColorInput(input: Element): input is HTMLInputElement {
  return input instanceof HTMLInputElement && input.type === "color";
}

function finishInlineTextEdit() {
  if (state.editingTextIndex === null) {
    return;
  }
  state.editingTextIndex = null;
  syncJsonFromSpec();
  render();
}

function insertToken(token: string) {
  if (!token) {
    return;
  }
  const primitive = state.spec.primitives[state.selectedIndex];
  if (primitive?.type === "text") {
    primitive.text = `${primitive.text ?? ""}${token}`;
    state.editingTextIndex = state.selectedIndex;
  } else {
    state.spec.primitives.push({ type: "text", x: 24, y: 24, text: token, fontSize: 2, color: "#FFFFFF", bgColor: "#000000" });
    state.selectedIndex = state.spec.primitives.length - 1;
    state.editingTextIndex = state.selectedIndex;
  }
  state.notice = "Variable inserted.";
  syncJsonFromSpec();
  render();
}

function handleGlobalKeydown(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  const usesCommandKey = event.metaKey || event.ctrlKey;
  const typing = isTypingTarget(event.target);

  if (key === "escape" && state.editingTextIndex !== null) {
    event.preventDefault();
    finishInlineTextEdit();
    return;
  }

  if (usesCommandKey && key === "d") {
    event.preventDefault();
    duplicateSelectedPrimitive();
    return;
  }

  if (typing) {
    return;
  }

  if (usesCommandKey && key === "c") {
    event.preventDefault();
    copySelectedPrimitive();
    return;
  }

  if (usesCommandKey && key === "v") {
    event.preventDefault();
    pasteCopiedPrimitive();
    return;
  }

  if (key === "backspace" || key === "delete") {
    event.preventDefault();
    deleteSelectedPrimitive();
    return;
  }

  const moveBy = event.shiftKey ? 10 : 1;
  if (key === "arrowleft") {
    event.preventDefault();
    moveSelectedPrimitive(-moveBy, 0);
  } else if (key === "arrowright") {
    event.preventDefault();
    moveSelectedPrimitive(moveBy, 0);
  } else if (key === "arrowup") {
    event.preventDefault();
    moveSelectedPrimitive(0, -moveBy);
  } else if (key === "arrowdown") {
    event.preventDefault();
    moveSelectedPrimitive(0, moveBy);
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.matches("input, textarea, select, [contenteditable='true']");
}

function selectedPrimitive(): Primitive | null {
  return state.spec.primitives[state.selectedIndex] ?? null;
}

function clonePrimitive(primitive: Primitive): Primitive {
  return JSON.parse(JSON.stringify(primitive)) as Primitive;
}

function copySelectedPrimitive() {
  const primitive = selectedPrimitive();
  if (!primitive) {
    return;
  }
  state.copiedPrimitive = clonePrimitive(primitive);
  state.notice = "Element copied.";
  render();
}

function pasteCopiedPrimitive() {
  if (!state.copiedPrimitive) {
    state.notice = "No copied element.";
    render();
    return;
  }
  addPrimitive(copyWithOffset(state.copiedPrimitive), "Element pasted.");
}

function duplicateSelectedPrimitive() {
  const primitive = selectedPrimitive();
  if (!primitive) {
    return;
  }
  state.copiedPrimitive = clonePrimitive(primitive);
  addPrimitive(copyWithOffset(primitive), "Element duplicated.");
}

function copyWithOffset(primitive: Primitive): Primitive {
  const copy = clonePrimitive(primitive);
  const width = estimatePrimitiveWidth(copy);
  const height = estimatePrimitiveHeight(copy);
  copy.x = clamp(copy.x + 8, 0, Math.max(0, DISPLAY_SIZE - width));
  copy.y = clamp(copy.y + 8, 0, Math.max(0, DISPLAY_SIZE - height));
  return copy;
}

function deleteSelectedPrimitive() {
  if (!selectedPrimitive()) {
    return;
  }
  state.spec.primitives.splice(state.selectedIndex, 1);
  state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, state.spec.primitives.length - 1));
  state.editingTextIndex = null;
  state.notice = "Element deleted.";
  syncJsonFromSpec();
  render();
}

function moveSelectedPrimitive(deltaX: number, deltaY: number) {
  const primitive = selectedPrimitive();
  if (!primitive) {
    return;
  }
  const maxX = Math.max(0, DISPLAY_SIZE - estimatePrimitiveWidth(primitive));
  const maxY = Math.max(0, DISPLAY_SIZE - estimatePrimitiveHeight(primitive));
  primitive.x = clamp(primitive.x + deltaX, 0, maxX);
  primitive.y = clamp(primitive.y + deltaY, 0, maxY);
  state.editingTextIndex = null;
  syncJsonFromSpec();
  render();
}

function rotateSelectedPrimitive(delta: number) {
  const primitive = selectedPrimitive();
  if (!primitive) {
    return;
  }
  primitive.rotation = normalizeRotation((primitive.rotation ?? 0) + delta);
  state.editingTextIndex = null;
  syncJsonFromSpec();
  render();
}

function adjustSelectedTextSize(delta: number) {
  const primitive = selectedPrimitive();
  if (!primitive || primitive.type !== "text") {
    return;
  }
  primitive.fontSize = clamp((primitive.fontSize ?? 1) + delta, 1, 12);
  state.editingTextIndex = null;
  syncJsonFromSpec();
  render();
}

function updateSelectedPrimitive(key: string, value: string) {
  const primitive = state.spec.primitives[state.selectedIndex];
  if (!primitive) {
    return;
  }
  if (key === "rotation") {
    primitive.rotation = normalizeRotation(toInt(value, 0));
    return;
  }
  if ((key === "width" || key === "height") && primitive.type === "gif") {
    resizeGifPrimitive(primitive, key, toInt(value, DEFAULT_GIF_SIZE));
    return;
  }
  if (["x", "y", "width", "height", "font", "fontSize"].includes(key)) {
    primitive[key as "x"] = Math.max(key === "x" || key === "y" ? 0 : 1, toInt(value, key === "x" || key === "y" ? 0 : 1));
    return;
  }
  if (["color", "bgColor", "borderColor"].includes(key)) {
    primitive[key as "color"] = value.trim();
    return;
  }
  if (key === "binding") {
    primitive.binding = value as BindingKey;
    return;
  }
  if (key === "assetPath") {
    primitive.assetPath = value.trim();
    return;
  }
  if (key === "text") {
    primitive.text = value;
  }
}

async function handleAction(action: string) {
  if (action === "reset") {
    state.spec = cloneSpec(initialSpec);
    state.selectedIndex = -1;
    state.editingTextIndex = null;
    state.notice = "Sample restored.";
    syncJsonFromSpec();
    render();
    return;
  }
  if (action === "add-rect") {
    addPrimitive({ type: "rect", x: 24, y: 24, width: 64, height: 38, color: "#1E2738" });
  }
  if (action === "add-text") {
    addPrimitive({ type: "text", x: 24, y: 24, text: "{label}", fontSize: 2, color: "#FFFFFF", bgColor: "#000000" });
  }
  if (action === "add-progress") {
    addPrimitive({ type: "progress", x: 24, y: 190, width: 160, height: 16, binding: "session", color: "#C7FF68", bgColor: "#202632", borderColor: "#667084" });
  }
  if (action === "add-gif") {
    app.querySelector<HTMLInputElement>("[data-role='gif-input']")?.click();
  }
  if (action === "delete-selected") {
    deleteSelectedPrimitive();
  }
  if (action === "apply-json") {
    applyJson();
  }
  if (action === "copy-json") {
    await copyText(prettyJson(state.spec), "JSON copied.");
  }
  if (action === "download-json") {
    downloadTheme();
  }
  if (action === "send-theme") {
    await sendThemeToVibeTV();
  }
}

function addPrimitive(primitive: Primitive, notice = "Element added.") {
  state.spec.primitives.push(primitive);
  state.selectedIndex = state.spec.primitives.length - 1;
  state.editingTextIndex = primitive.type === "text" ? state.selectedIndex : null;
  state.notice = notice;
  syncJsonFromSpec();
  render();
}

function addGifPrimitive(file: File) {
  if (file.type && file.type !== "image/gif") {
    state.notice = "Please choose a GIF file.";
    render();
    return;
  }
  const assetPath = themeAssetPathForFile(file.name);
  const existing = state.gifAssets[assetPath];
  if (existing) {
    URL.revokeObjectURL(existing.previewUrl);
  }
  state.gifAssets[assetPath] = {
    file,
    previewUrl: URL.createObjectURL(file),
  };
  addPrimitive({ type: "gif", x: 24, y: 24, width: DEFAULT_GIF_SIZE, height: DEFAULT_GIF_SIZE, assetPath }, "GIF placed.");
}

function themeAssetPathForFile(name: string): string {
  return `/themes/u/${safeAssetName(name)}`;
}

function safeAssetName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const withExtension = cleaned.endsWith(".gif") ? cleaned : `${cleaned || "asset"}.gif`;
  if (withExtension.length <= 21) {
    return withExtension;
  }
  const base = withExtension.replace(/\.gif$/i, "");
  return `${base.slice(0, 17).replace(/[._-]+$/g, "") || "asset"}.gif`;
}

function applyJson() {
  try {
    const parsed = JSON.parse(state.jsonText) as ThemeSpec;
    state.spec = parsed;
    normalizeMiniThemeSpec();
    state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, state.spec.primitives.length - 1));
    state.editingTextIndex = null;
    state.notice = "JSON applied.";
    syncJsonFromSpec();
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "Invalid JSON.";
  }
  render();
}

function startDrag(event: PointerEvent) {
  const index = Number((event.currentTarget as SVGElement).dataset.drag);
  const primitive = state.spec.primitives[index];
  if (!primitive) {
    return;
  }
  state.selectedIndex = index;
  const svg = (event.currentTarget as SVGElement).closest("svg");
  if (!svg) {
    return;
  }
  const start = pointerPosition(svg, event);
  const originX = primitive.x;
  const originY = primitive.y;
  (event.currentTarget as SVGElement).setPointerCapture(event.pointerId);

  const onMove = (moveEvent: PointerEvent) => {
    const liveSvg = app.querySelector<SVGSVGElement>(".display") ?? svg;
    const point = pointerPosition(liveSvg, moveEvent);
    const maxX = Math.max(0, DISPLAY_SIZE - estimatePrimitiveWidth(primitive));
    const maxY = Math.max(0, DISPLAY_SIZE - estimatePrimitiveHeight(primitive));
    primitive.x = clamp(Math.round(originX + point.x - start.x), 0, maxX);
    primitive.y = clamp(Math.round(originY + point.y - start.y), 0, maxY);
    syncJsonFromSpec();
    render();
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function startResize(event: PointerEvent) {
  event.preventDefault();
  event.stopPropagation();

  const target = event.currentTarget as SVGElement;
  const index = Number(target.dataset.resizeIndex);
  const handle = target.dataset.resizeHandle as ResizeHandle;
  const primitive = state.spec.primitives[index];
  if (!primitive || !handle) {
    return;
  }

  state.selectedIndex = index;
  const svg = target.closest("svg");
  if (!svg) {
    return;
  }

  const start = pointerPosition(svg, event);
  const originWidth = estimatePrimitiveWidth(primitive);
  const originHeight = estimatePrimitiveHeight(primitive);
  const originFontSize = Math.max(1, primitive.fontSize ?? 1);
  target.setPointerCapture(event.pointerId);

  const onMove = (moveEvent: PointerEvent) => {
    const liveSvg = app.querySelector<SVGSVGElement>(".display") ?? svg;
    const point = pointerPosition(liveSvg, moveEvent);
    const deltaX = point.x - start.x;
    const deltaY = point.y - start.y;

    if (primitive.type === "text") {
      const nextSize = clamp(Math.round(originFontSize + deltaY / 10), 1, 12);
      primitive.fontSize = nextSize;
    } else if (primitive.type === "gif") {
      resizeGifFromPointer(primitive, handle, originWidth, originHeight, deltaX, deltaY);
    } else {
      if (handle === "e" || handle === "se") {
        primitive.width = clamp(Math.round(originWidth + deltaX), 1, DISPLAY_SIZE - primitive.x);
      }
      if (handle === "s" || handle === "se") {
        primitive.height = clamp(Math.round(originHeight + deltaY), 1, DISPLAY_SIZE - primitive.y);
      }
    }

    syncJsonFromSpec();
    render();
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function resizeGifPrimitive(primitive: Primitive, key: "width" | "height", rawValue: number) {
  const ratio = gifAspectRatio(primitive);
  if (key === "width") {
    applyGifWidth(primitive, ratio, rawValue);
    return;
  }

  applyGifHeight(primitive, ratio, rawValue);
}

function resizeGifFromPointer(
    primitive: Primitive,
    handle: ResizeHandle,
    originWidth: number,
    originHeight: number,
    deltaX: number,
    deltaY: number) {
  const ratio = gifAspectRatio(primitive);
  if (handle === "s") {
    applyGifHeight(primitive, ratio, Math.round(originHeight + deltaY));
    return;
  }

  if (handle === "e") {
    applyGifWidth(primitive, ratio, Math.round(originWidth + deltaX));
    return;
  }

  const widthFromPointer = Math.round(originWidth + deltaX);
  const heightFromPointer = Math.round(originHeight + deltaY);
  if (Math.abs(deltaY) > Math.abs(deltaX)) {
    applyGifHeight(primitive, ratio, heightFromPointer);
    return;
  }

  applyGifWidth(primitive, ratio, widthFromPointer);
}

function applyGifWidth(primitive: Primitive, ratio: number, rawWidth: number) {
  const maxWidth = Math.max(1, DISPLAY_SIZE - primitive.x);
  const maxHeight = Math.max(1, DISPLAY_SIZE - primitive.y);
  let width = clamp(rawWidth, 1, maxWidth);
  let height = Math.max(1, Math.round(width / ratio));
  if (height > maxHeight) {
    height = maxHeight;
    width = clamp(Math.round(height * ratio), 1, maxWidth);
  }
  primitive.width = width;
  primitive.height = height;
}

function applyGifHeight(primitive: Primitive, ratio: number, rawHeight: number) {
  const maxWidth = Math.max(1, DISPLAY_SIZE - primitive.x);
  const maxHeight = Math.max(1, DISPLAY_SIZE - primitive.y);
  let height = clamp(rawHeight, 1, maxHeight);
  let width = Math.max(1, Math.round(height * ratio));
  if (width > maxWidth) {
    width = maxWidth;
    height = clamp(Math.round(width / ratio), 1, maxHeight);
  }
  primitive.width = width;
  primitive.height = height;
}

function gifAspectRatio(primitive: Primitive): number {
  if (primitive.assetPath === "/themes/mini/mini.gif") {
    return 1;
  }
  const width = primitive.width ?? DEFAULT_GIF_SIZE;
  const height = primitive.height ?? DEFAULT_GIF_SIZE;
  if (width <= 0 || height <= 0) {
    return 1;
  }
  return width / height;
}

function pointerPosition(svg: SVGSVGElement, event: PointerEvent): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: ((event.clientX - rect.left) / rect.width) * DISPLAY_SIZE,
    y: ((event.clientY - rect.top) / rect.height) * DISPLAY_SIZE,
  };
}

function downloadTheme() {
  const blob = new Blob([prettyJson(state.spec)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${state.spec.themeId}.json`;
  link.click();
  URL.revokeObjectURL(href);
  state.notice = "Download prepared.";
  render();
}

async function sendThemeToVibeTV() {
  validateCurrentSpec();
  if (state.errors.length > 0) {
    state.notice = "Theme is invalid. Fix the errors before sending.";
    render();
    return;
  }

  try {
    const targetOrigin = normalizeTargetOrigin(state.targetOrigin);
    state.targetOrigin = targetOrigin;
    persistTargetOrigin();
    await clearDeviceThemeSpec(targetOrigin);
    await uploadThemeAssets(targetOrigin);
    const response = await postFramePayload(targetOrigin, buildFramePayload());

    if (response.type === "opaque") {
      state.notice = "Theme sent to Vibe TV. Local dev mode cannot read the device confirmation.";
      render();
      return;
    }

    if (!response.ok) {
      state.notice = `Vibe TV rejected the theme (${response.status}).`;
      render();
      return;
    }

    state.notice = "Theme sent to Vibe TV.";
  } catch (error) {
    state.notice = error instanceof Error ? error.message : `Could not reach Vibe TV at ${normalizeTargetOrigin(state.targetOrigin)}. Check Wi-Fi/mDNS, then try again.`;
  }
  render();
}

async function clearDeviceThemeSpec(targetOrigin: string) {
  const response = await postFramePayload(targetOrigin, buildThemeSpecClearPayload());
  if (response.type !== "opaque" && !response.ok) {
    throw new Error(`Theme clear failed (${response.status}).`);
  }
}

async function postFramePayload(targetOrigin: string, payload: Record<string, unknown>): Promise<Response> {
  return fetchWithCorsFallback(`${targetOrigin}/frame`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
}

async function uploadThemeAssets(targetOrigin: string) {
  const paths = uniqueGifAssetPaths();
  for (const path of paths) {
    const asset = state.gifAssets[path] ?? await builtInGifAsset(path);
    if (!asset) {
      continue;
    }
    const body = new FormData();
    body.append("asset", asset.file, asset.file.name);
    const response = await fetchWithCorsFallback(`${targetOrigin}/assets?path=${encodeURIComponent(path)}`, {
      method: "POST",
      body,
    });
    if (response.type !== "opaque" && !response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`GIF upload failed (${response.status})${detail ? `: ${detail}` : ""}.`);
    }
  }
}

async function fetchWithCorsFallback(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, mode: "cors" });
  } catch {
    return fetch(url, { ...init, mode: "no-cors" });
  }
}

function uniqueGifAssetPaths(): string[] {
  const paths = new Set<string>();
  for (const primitive of state.spec.primitives) {
    if (primitive.type === "gif" && primitive.assetPath) {
      paths.add(primitive.assetPath);
    }
  }
  return Array.from(paths);
}

async function builtInGifAsset(path: string): Promise<{ file: File; previewUrl: string } | null> {
  const previewUrl = builtInGifPreviewUrl(path);
  if (!previewUrl) {
    return null;
  }
  const response = await fetch(previewUrl);
  if (!response.ok) {
    throw new Error(`Built-in GIF missing (${response.status}).`);
  }
  const blob = await response.blob();
  return {
    file: new File([blob], path.split("/").pop() || "theme.gif", { type: "image/gif" }),
    previewUrl,
  };
}

function buildFramePayload() {
  const payload: Record<string, unknown> = {
    v: 2,
    provider: frame.provider,
    label: frame.label,
    session: frame.session,
    weekly: frame.weekly,
    resetSecs: frame.resetSecs,
    usageMode: frame.usageMode,
    themeSpec: state.spec,
  };
  const bindings = usedThemeBindings();
  if (bindings.has("sessionTokens")) {
    payload.sessionTokens = frame.sessionTokens;
  }
  if (bindings.has("weekTokens")) {
    payload.weekTokens = frame.weekTokens;
  }
  if (bindings.has("totalTokens")) {
    payload.totalTokens = frame.totalTokens;
  }
  return payload;
}

function buildThemeSpecClearPayload(): Record<string, unknown> {
  return {
    v: 2,
    provider: frame.provider,
    label: frame.label,
    session: frame.session,
    weekly: frame.weekly,
    resetSecs: frame.resetSecs,
    usageMode: frame.usageMode,
    theme: FIXED_FALLBACK_THEME,
    themeSpec: null,
  };
}

function usedThemeBindings(): Set<string> {
  const bindings = new Set<string>();
  for (const primitive of state.spec.primitives) {
    if (primitive.binding) {
      bindings.add(primitive.binding);
    }
    if (primitive.text) {
      for (const match of primitive.text.matchAll(/\{([a-zA-Z]+)\}/g)) {
        bindings.add(match[1]);
      }
    }
  }
  return bindings;
}

async function copyText(text: string, notice: string) {
  await navigator.clipboard.writeText(text);
  state.notice = notice;
  render();
}

function toInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeRotation(value: number): number {
  const rotation = Math.round(value) % 360;
  return rotation < 0 ? rotation + 360 : rotation;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
