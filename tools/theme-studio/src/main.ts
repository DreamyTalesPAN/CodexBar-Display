import "./styles.css";

const DISPLAY_SIZE = 240;
const MAX_SPEC_BYTES = 1024;
const MAX_PRIMITIVES = 32;
const COLOR_RE = /^#[A-Fa-f0-9]{6}$/;
const THEME_ID_RE = /^[a-z0-9][a-z0-9\-_]{2,63}$/;

type PrimitiveType = "rect" | "text" | "progress";
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
}

interface ThemeSpec {
  themeSpecVersion: 1;
  themeId: string;
  themeRev: number;
  fallbackTheme?: "classic" | "crt" | "mini";
  primitives: Primitive[];
}

interface FrameData {
  provider: string;
  label: string;
  session: number;
  weekly: number;
  reset: string;
  usageMode: string;
  sessionTokens: number;
  weekTokens: number;
  totalTokens: number;
}

interface AppState {
  spec: ThemeSpec;
  selectedIndex: number;
  jsonText: string;
  jsonDirty: boolean;
  errors: string[];
  warnings: string[];
  notice: string;
}

const frame: FrameData = {
  provider: "codex",
  label: "Codex",
  session: 94,
  weekly: 87,
  reset: "89h 54m",
  usageMode: "remaining",
  sessionTokens: 12840,
  weekTokens: 68120,
  totalTokens: 190420,
};

const initialSpec: ThemeSpec = {
  themeSpecVersion: 1,
  themeId: "mini-transport",
  themeRev: 3,
  fallbackTheme: "mini",
  primitives: [
    { type: "rect", x: 0, y: 0, width: 240, height: 240, color: "#04070E" },
    { type: "text", x: 14, y: 18, text: "Codex", fontSize: 2, color: "#E9F2FF", bgColor: "#04070E" },
    { type: "text", x: 14, y: 54, text: "Session", fontSize: 1, color: "#AAB6C7", bgColor: "#04070E" },
    { type: "text", x: 14, y: 76, text: "{session}%", fontSize: 4, color: "#C7FF68", bgColor: "#04070E" },
    { type: "progress", x: 14, y: 176, width: 212, height: 18, binding: "weekly", color: "#A7FFC9", bgColor: "#1E2738", borderColor: "#526078" },
    { type: "text", x: 14, y: 206, text: "Reset {reset}", fontSize: 1, color: "#B8C2D1", bgColor: "#04070E" },
  ],
};

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("missing #app root");
}
const app = appRoot;

const state: AppState = {
  spec: cloneSpec(initialSpec),
  selectedIndex: 1,
  jsonText: "",
  jsonDirty: false,
  errors: [],
  warnings: [],
  notice: "",
};
syncJsonFromSpec();
render();

function cloneSpec(spec: ThemeSpec): ThemeSpec {
  return JSON.parse(JSON.stringify(spec)) as ThemeSpec;
}

function minifiedJson(spec: ThemeSpec): string {
  return JSON.stringify(spec);
}

function prettyJson(spec: ThemeSpec): string {
  return JSON.stringify(spec, null, 2);
}

function syncJsonFromSpec() {
  state.jsonText = prettyJson(state.spec);
  state.jsonDirty = false;
  validateCurrentSpec();
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
  if (!Number.isInteger(spec.themeRev) || spec.themeRev < 1) {
    errors.push("themeRev muss eine ganze Zahl ab 1 sein.");
  }
  if (spec.fallbackTheme && !["classic", "crt", "mini"].includes(spec.fallbackTheme)) {
    errors.push("fallbackTheme muss classic, crt oder mini sein.");
  }
  if (!Array.isArray(spec.primitives) || spec.primitives.length === 0) {
    errors.push("Mindestens ein Primitive ist erforderlich.");
  }
  if (spec.primitives.length > MAX_PRIMITIVES) {
    errors.push(`Zu viele Primitives: ${spec.primitives.length}/${MAX_PRIMITIVES}.`);
  }

  spec.primitives.forEach((primitive, index) => {
    const prefix = `Primitive ${index + 1}`;
    if (!["rect", "text", "progress"].includes(primitive.type)) {
      errors.push(`${prefix}: type muss rect, text oder progress sein.`);
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
      if (!primitive.text || primitive.text.trim() === "") {
        errors.push(`${prefix}: text darf nicht leer sein.`);
      }
      if (primitive.fontSize !== undefined && (!Number.isInteger(primitive.fontSize) || primitive.fontSize < 1)) {
        errors.push(`${prefix}: fontSize sollte mindestens 1 sein.`);
      }
    }
    if (primitive.type === "rect" || primitive.type === "progress") {
      if (!isPositiveInteger(primitive.width) || !isPositiveInteger(primitive.height)) {
        errors.push(`${prefix}: width/height müssen größer als 0 sein.`);
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

  app.innerHTML = `
    <section class="studio-shell">
      <header class="appbar">
        <div>
          <div class="eyebrow">Vibe TV</div>
          <h1>Theme Studio</h1>
        </div>
        <div class="status-strip">
          ${metric("Bytes", bytes, MAX_SPEC_BYTES)}
          ${metric("Primitives", state.spec.primitives.length, MAX_PRIMITIVES)}
          <span class="health ${state.errors.length ? "bad" : "ok"}">${state.errors.length ? "Invalid" : "Valid"}</span>
        </div>
      </header>

      <section class="workspace">
        <aside class="panel left-panel">
          <div class="panel-head">
            <h2>Theme</h2>
            <button class="icon-button" data-action="reset" title="Reset sample">Reset</button>
          </div>
          ${themeFields()}
          <div class="divider"></div>
          <div class="panel-head compact">
            <h2>Elements</h2>
            <div class="segmented">
              <button data-action="add-rect" title="Add rectangle">Rect</button>
              <button data-action="add-text" title="Add text">Text</button>
              <button data-action="add-progress" title="Add progress">Bar</button>
            </div>
          </div>
          <div class="primitive-list">
            ${state.spec.primitives.map((primitive, index) => primitiveRow(primitive, index)).join("")}
          </div>
        </aside>

        <section class="preview-column">
          <div class="device-frame">
            ${renderPreview()}
          </div>
          <div class="preview-actions">
            <button data-action="copy-json">Copy JSON</button>
            <button data-action="download-json">Download</button>
            <button data-action="copy-validate">Copy validate command</button>
          </div>
          ${messageList()}
        </section>

        <aside class="panel right-panel">
          <div class="panel-head">
            <h2>${selected ? `${selected.type} ${state.selectedIndex + 1}` : "Inspector"}</h2>
            ${selected ? `<button class="danger-button" data-action="delete-selected">Delete</button>` : ""}
          </div>
          ${selected ? inspectorFields(selected) : `<p class="empty">Select an element.</p>`}
          <div class="divider"></div>
          <div class="panel-head compact">
            <h2>JSON</h2>
            <button data-action="apply-json">Apply JSON</button>
          </div>
          <textarea class="json-editor" spellcheck="false" data-role="json-editor">${escapeHtml(state.jsonText)}</textarea>
        </aside>
      </section>
    </section>
  `;

  bindEvents();
}

function metric(label: string, value: number, max: number): string {
  const over = value > max;
  return `<span class="metric ${over ? "bad" : ""}"><b>${value}</b><small>${label} / ${max}</small></span>`;
}

function themeFields(): string {
  return `
    <label>Theme ID<input data-field="themeId" value="${escapeAttr(state.spec.themeId)}" /></label>
    <div class="field-grid">
      <label>Rev<input type="number" min="1" step="1" data-field="themeRev" value="${state.spec.themeRev}" /></label>
      <label>Fallback
        <select data-field="fallbackTheme">
          ${["mini", "classic", "crt"].map((value) => `<option value="${value}" ${state.spec.fallbackTheme === value ? "selected" : ""}>${value}</option>`).join("")}
        </select>
      </label>
    </div>
  `;
}

function primitiveRow(primitive: Primitive, index: number): string {
  const title = primitive.type === "text" ? primitive.text || "Text" : primitive.type === "progress" ? primitive.binding || "session" : primitive.color || "Rect";
  return `
    <button class="primitive-row ${index === state.selectedIndex ? "selected" : ""}" data-select="${index}">
      <span>${index + 1}</span>
      <strong>${primitive.type}</strong>
      <em>${escapeHtml(title)}</em>
    </button>
  `;
}

function inspectorFields(primitive: Primitive): string {
  const common = `
    <div class="field-grid">
      <label>X<input type="number" min="0" step="1" data-primitive-field="x" value="${primitive.x}" /></label>
      <label>Y<input type="number" min="0" step="1" data-primitive-field="y" value="${primitive.y}" /></label>
    </div>
  `;

  if (primitive.type === "text") {
    return `
      ${common}
      <label>Text<input data-primitive-field="text" value="${escapeAttr(primitive.text ?? "")}" /></label>
      <div class="field-grid">
        <label>Font<input type="number" min="1" step="1" data-primitive-field="font" value="${primitive.font ?? 1}" /></label>
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
  return `
    <svg class="display" viewBox="0 0 ${DISPLAY_SIZE} ${DISPLAY_SIZE}" role="img" aria-label="Theme preview">
      <rect x="0" y="0" width="${DISPLAY_SIZE}" height="${DISPLAY_SIZE}" fill="#000000"></rect>
      ${state.spec.primitives.map((primitive, index) => renderPrimitive(primitive, index)).join("")}
    </svg>
  `;
}

function renderPrimitive(primitive: Primitive, index: number): string {
  const selected = index === state.selectedIndex;
  const handle = selected ? selectionHandle(primitive, index) : "";
  const hitTarget = primitiveHitTarget(primitive, index);
  if (primitive.type === "rect") {
    return `
      <rect class="${selected ? "selected-shape" : ""}" x="${primitive.x}" y="${primitive.y}" width="${primitive.width ?? 1}" height="${primitive.height ?? 1}" fill="${escapeAttr(primitive.color ?? "#000000")}"></rect>
      ${hitTarget}
      ${handle}
    `;
  }
  if (primitive.type === "progress") {
    const width = primitive.width ?? 1;
    const height = primitive.height ?? 1;
    const pct = primitive.binding === "weekly" || primitive.binding === "weeklyPercent" ? frame.weekly : frame.session;
    const fillWidth = Math.max(0, Math.min(width, Math.round((width * pct) / 100)));
    return `
      <rect x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" fill="${escapeAttr(primitive.bgColor ?? "#000000")}" stroke="${escapeAttr(primitive.borderColor ?? "#7B7B7B")}" stroke-width="1"></rect>
      <rect x="${primitive.x + 2}" y="${primitive.y + 2}" width="${Math.max(0, fillWidth - 4)}" height="${Math.max(0, height - 4)}" fill="${escapeAttr(primitive.color ?? "#FFFFFF")}"></rect>
      ${hitTarget}
      ${handle}
    `;
  }

  const size = Math.max(1, primitive.fontSize ?? 1);
  const fontPx = size * 9;
  const text = renderTemplate(primitive.text ?? "");
  return `
    <text class="preview-text ${selected ? "selected-text" : ""}" x="${primitive.x}" y="${primitive.y + fontPx}" font-size="${fontPx}" fill="${escapeAttr(primitive.color ?? "#FFFFFF")}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="800">${escapeHtml(text)}</text>
    ${hitTarget}
    ${handle}
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
  return `<rect class="selection-box" data-drag="${index}" x="${primitive.x}" y="${primitive.y}" width="${width}" height="${height}" fill="none"></rect>`;
}

function estimatePrimitiveWidth(primitive: Primitive): number {
  if (primitive.type === "text") {
    return Math.max(12, Math.round(renderTemplate(primitive.text ?? "").length * Math.max(1, primitive.fontSize ?? 1) * 5.5));
  }
  return primitive.width ?? 1;
}

function estimatePrimitiveHeight(primitive: Primitive): number {
  if (primitive.type === "text") {
    return Math.max(8, Math.max(1, primitive.fontSize ?? 1) * 10);
  }
  return primitive.height ?? 1;
}

function renderTemplate(text: string): string {
  return text.replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => {
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
  });
}

function messageList(): string {
  const notices = state.notice ? [`<li class="notice">${escapeHtml(state.notice)}</li>`] : [];
  const errors = state.errors.map((msg) => `<li class="error">${escapeHtml(msg)}</li>`);
  const warnings = state.warnings.map((msg) => `<li class="warning">${escapeHtml(msg)}</li>`);
  const items = [...notices, ...errors, ...warnings];
  if (items.length === 0) {
    return `<ul class="messages"><li class="ok-message">Ready for CLI validation.</li></ul>`;
  }
  return `<ul class="messages">${items.join("")}</ul>`;
}

function bindEvents() {
  app.querySelectorAll<HTMLElement>("[data-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedIndex = Number(button.dataset.select);
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
      if (key === "themeRev") {
        state.spec.themeRev = toInt(input.value, 1);
      }
      if (key === "fallbackTheme") {
        state.spec.fallbackTheme = input.value as ThemeSpec["fallbackTheme"];
      }
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-primitive-field]").forEach((input) => {
    input.addEventListener("input", () => {
      updateSelectedPrimitive(input.dataset.primitiveField ?? "", input.value);
      syncJsonFromSpec();
      render();
    });
  });

  app.querySelector<HTMLTextAreaElement>("[data-role='json-editor']")?.addEventListener("input", (event) => {
    state.jsonText = (event.target as HTMLTextAreaElement).value;
    state.jsonDirty = true;
  });

  app.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action ?? ""));
  });

  app.querySelectorAll<SVGElement>("[data-drag]").forEach((element) => {
    element.addEventListener("click", () => {
      state.selectedIndex = Number(element.dataset.drag);
      state.notice = "";
      render();
    });
    element.addEventListener("pointerdown", startDrag);
  });
}

function updateSelectedPrimitive(key: string, value: string) {
  const primitive = state.spec.primitives[state.selectedIndex];
  if (!primitive) {
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
  if (key === "text") {
    primitive.text = value;
  }
}

function handleAction(action: string) {
  if (action === "reset") {
    state.spec = cloneSpec(initialSpec);
    state.selectedIndex = 1;
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
  if (action === "delete-selected") {
    state.spec.primitives.splice(state.selectedIndex, 1);
    state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, state.spec.primitives.length - 1));
    state.notice = "Element deleted.";
    syncJsonFromSpec();
    render();
  }
  if (action === "apply-json") {
    applyJson();
  }
  if (action === "copy-json") {
    copyText(prettyJson(state.spec), "JSON copied.");
  }
  if (action === "download-json") {
    downloadTheme();
  }
  if (action === "copy-validate") {
    copyText(`codexbar-display theme-validate --transport wifi --target http://vibetv.local --spec ${state.spec.themeId}.json`, "Validate command copied.");
  }
}

function addPrimitive(primitive: Primitive) {
  state.spec.primitives.push(primitive);
  state.selectedIndex = state.spec.primitives.length - 1;
  state.notice = "Element added.";
  syncJsonFromSpec();
  render();
}

function applyJson() {
  try {
    const parsed = JSON.parse(state.jsonText) as ThemeSpec;
    state.spec = parsed;
    state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, state.spec.primitives.length - 1));
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
