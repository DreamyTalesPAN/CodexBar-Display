"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ThemeStudioPrimitive } from "@/lib/theme-studio";
import { ColorField, NumberField, SelectField, TextField } from "./editor-fields";
import {
  primitiveBounds,
  textPrimitiveNaturalWidth,
  type FieldKey,
} from "./editor-geometry";

const DEFAULT_SPRITE_FPS = 8;

const VARIABLE_TOKENS = [
  { label: "Label", token: "{label}" },
  { label: "Usage window 1 label", token: "{usageSlot1Label}" },
  { label: "Usage window 1 %", token: "{usageSlot1Percent}" },
  { label: "Usage window 1 reset", token: "{usageSlot1Reset}" },
  { label: "Usage window 2 label", token: "{usageSlot2Label}" },
  { label: "Usage window 2 %", token: "{usageSlot2Percent}" },
  { label: "Usage window 2 reset", token: "{usageSlot2Reset}" },
  { label: "Provider 1 name", token: "{providerSlot1Label}" },
  { label: "Provider 1 next reset", token: "{providerSlot1Reset}" },
  { label: "Provider 2 name", token: "{providerSlot2Label}" },
  { label: "Provider 2 next reset", token: "{providerSlot2Reset}" },
  { label: "Mode", token: "{usageMode}" },
  { label: "Time", token: "{time}" },
];

export function PrimitiveInspector({
  onChange,
  onDelete,
  onInsertToken,
  primitive,
}: {
  onChange: (field: FieldKey, value: unknown) => void;
  onDelete: () => void;
  onInsertToken: (token: string) => void;
  primitive: ThemeStudioPrimitive;
}) {
  const bounds = primitiveBounds(primitive);
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="X"
          value={primitive.x}
          onChange={(value) => onChange("x", value)}
        />
        <NumberField
          label="Y"
          value={primitive.y}
          onChange={(value) => onChange("y", value)}
        />
      </div>

      <SelectField
        label="Show when"
        value={
          primitive.slot
            ? String(primitive.slot)
            : primitive.providerSlot
              ? `p${primitive.providerSlot}`
              : ""
        }
        onChange={(value) => {
          const providerMatch = /^p([12])$/.exec(value);
          onChange("slot", providerMatch || !value ? "" : Number(value));
          onChange("providerSlot", providerMatch ? Number(providerMatch[1]) : "");
        }}
        options={[
          ["", "Always"],
          ["1", "Usage window 1 has data"],
          ["2", "Usage window 2 has data"],
          ["p1", "Provider 1 has data"],
          ["p2", "Provider 2 has data"],
        ]}
      />

      {(primitive.type === "rect" ||
        primitive.type === "progress" ||
        primitive.type === "gif" ||
        primitive.type === "sprite" ||
        primitive.type === "pixels" ||
        primitive.width !== undefined) ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Width"
            // The stored width is the device's clip/fit box. Showing the
            // rendered bounds instead hides a narrower stored box and makes
            // align/shrink look broken while the field claims a wider value.
            value={primitive.width ?? bounds.width}
            onChange={(value) => onChange("width", value)}
          />
          <NumberField
            label="Height"
            value={primitive.height ?? bounds.height}
            onChange={(value) => onChange("height", value)}
          />
        </div>
      ) : null}

      {primitive.type === "text" ? (
        <>
          <TextField
            label="Text"
            value={primitive.text || ""}
            onChange={(value) => {
              onChange("text", value);
              if (value) {
                onChange("binding", "");
              }
            }}
          />
          <SelectField
            label="Binding"
            value={primitive.binding || ""}
            onChange={(value) => {
              onChange("binding", value);
              if (value) {
                onChange("text", "");
              }
            }}
            options={[
              ["", "None"],
              ["label", "Label"],
              ["usageSlot1Label", "Usage window 1 label"],
              ["usageSlot1Percent", "Usage window 1 %"],
              ["usageSlot1Reset", "Usage window 1 reset"],
              ["usageSlot2Label", "Usage window 2 label"],
              ["usageSlot2Percent", "Usage window 2 %"],
              ["usageSlot2Reset", "Usage window 2 reset"],
              ["providerSlot1Label", "Provider 1 name"],
              ["providerSlot1Reset", "Provider 1 next reset"],
              ["providerSlot2Label", "Provider 2 name"],
              ["providerSlot2Reset", "Provider 2 next reset"],
              ["session", "Session (legacy)"],
              ["weekly", "Weekly (legacy)"],
              ["reset", "Reset (legacy)"],
              ["usageMode", "Mode"],
              ["time", "Time"],
              ["date", "Date"],
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Font size"
              value={primitive.fontSize ?? 2}
              onChange={(value) => onChange("fontSize", value)}
            />
            <SelectField
              label="Align"
              value={primitive.align || "left"}
              onChange={(value) => onChange("align", value)}
              options={[
                ["left", "Left"],
                ["center", "Center"],
                ["right", "Right"],
              ]}
            />
          </div>
          <SelectField
            label="Vertical align"
            value={primitive.valign || "top"}
            onChange={(value) => onChange("valign", value)}
            options={[
              ["top", "Top"],
              ["middle", "Middle"],
              ["bottom", "Bottom"],
            ]}
          />
          {primitive.fit === "shrink" &&
          primitive.width !== undefined &&
          textPrimitiveNaturalWidth(primitive) > primitive.width ? (
            <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border bg-muted px-2 py-1.5">
              <span className="text-xs text-muted-foreground">
                Text is shrunk to fit the {primitive.width}px box.
              </span>
              <Button
                onClick={() =>
                  onChange("width", textPrimitiveNaturalWidth(primitive))
                }
                size="sm"
                type="button"
                variant="outline"
              >
                Fit box to text
              </Button>
            </div>
          ) : null}
          <ColorField
            label="Text color"
            value={primitive.color || "#FFFFFF"}
            onChange={(value) => onChange("color", value)}
          />
          <div className="grid gap-2">
            <span className="text-xs font-black uppercase tracking-normal text-muted-foreground">
              Variables
            </span>
            <div className="grid grid-cols-2 gap-2">
              {VARIABLE_TOKENS.map((item) => (
                <Button
                  className="h-auto min-w-0 justify-start px-2 py-2 text-left text-xs"
                  key={item.token}
                  onClick={() => onInsertToken(item.token)}
                  type="button"
                  variant="outline"
                >
                  <span className="block truncate font-black">{item.label}</span>
                  <code className="block truncate text-[11px] text-ring">
                    {item.token}
                  </code>
                </Button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {primitive.type === "progress" ? (
        <>
          <SelectField
            label="Binding"
            value={primitive.binding || "session"}
            onChange={(value) => onChange("binding", value)}
            options={[
              ["usageSlot1Percent", "Usage window 1 %"],
              ["usageSlot2Percent", "Usage window 2 %"],
              ["session", "Session (legacy)"],
              ["weekly", "Weekly (legacy)"],
            ]}
          />
          <SelectField
            label="Style"
            value={primitive.progressStyle || "solid"}
            onChange={(value) =>
              onChange("progressStyle", value === "solid" ? "" : value)
            }
            options={[
              ["solid", "Solid"],
              ["segments", "Segments"],
            ]}
          />
          {primitive.progressStyle === "segments" ? (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Segments"
                value={primitive.segments ?? 12}
                onChange={(value) => onChange("segments", value)}
              />
              <NumberField
                label="Gap"
                value={primitive.segmentGap ?? 1}
                onChange={(value) => onChange("segmentGap", value)}
              />
            </div>
          ) : null}
          <ProgressColorStopsEditor
            color={primitive.color || "#C7FF68"}
            stops={primitive.colorStops || []}
            onColorChange={(value) => onChange("color", value)}
            onStopsChange={(value) =>
              onChange("colorStops", value.length > 0 ? value : "")
            }
          />
          <ColorField
            label="Track color"
            value={primitive.bgColor || "#111111"}
            onChange={(value) => onChange("bgColor", value)}
          />
          <ColorField
            label="Border color"
            value={primitive.borderColor || "#3B4552"}
            onChange={(value) => onChange("borderColor", value)}
          />
          <NumberField
            label="Border radius"
            max={120}
            value={primitive.borderRadius ?? 0}
            onChange={(value) => onChange("borderRadius", value)}
          />
        </>
      ) : null}

      {primitive.type === "rect" ? (
        <>
          <ColorField
            label="Fill color"
            value={primitive.color || "#222222"}
            onChange={(value) => onChange("color", value)}
          />
          <NumberField
            label="Border radius"
            max={120}
            value={primitive.borderRadius ?? 0}
            onChange={(value) => onChange("borderRadius", value)}
          />
        </>
      ) : null}

      {primitive.type === "gif" || primitive.type === "sprite" ? (
        <TextField
          label="Asset path"
          value={primitive.assetPath || ""}
          onChange={(value) => onChange("assetPath", value)}
        />
      ) : null}

      {primitive.type === "sprite" ? (
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="Frames"
            value={primitive.frameCount ?? 1}
            onChange={(value) => onChange("frameCount", value)}
          />
          <NumberField
            label="FPS"
            value={primitive.fps ?? DEFAULT_SPRITE_FPS}
            onChange={(value) => onChange("fps", value)}
          />
          <NumberField
            label="Columns"
            value={primitive.sheetColumns ?? primitive.frameCount ?? 1}
            onChange={(value) => onChange("sheetColumns", value)}
          />
        </div>
      ) : null}

      <Button
        className="mt-1"
        onClick={onDelete}
        type="button"
        variant="destructive"
      >
        <Trash2 size={16} aria-hidden />
        <span>Delete</span>
      </Button>
    </div>
  );
}

const DEFAULT_REMAINING_COLOR_STOPS: Array<{ gte: number; color: string }> = [
  { gte: 75, color: "#22C55E" },
  { gte: 50, color: "#FACC15" },
  { gte: 25, color: "#F97316" },
  { gte: 0, color: "#EF4444" },
];

function ProgressColorStopsEditor({
  color,
  onColorChange,
  onStopsChange,
  stops,
}: {
  color: string;
  onColorChange: (value: string) => void;
  onStopsChange: (value: Array<{ gte: number; color: string }>) => void;
  stops: Array<{ gte: number; color: string }>;
}) {
  const hasStops = stops.length > 0;
  const sortedStops = [...stops].sort((a, b) => b.gte - a.gte);

  const handleStopChange = (
    index: number,
    field: "gte" | "color",
    value: number | string,
  ) => {
    const next = sortedStops.map((stop, stopIndex) =>
      stopIndex === index
        ? { ...stop, [field]: value }
        : stop,
    );
    onStopsChange(next);
  };

  const handleRemoveStop = (index: number) => {
    onStopsChange(sortedStops.filter((_, stopIndex) => stopIndex !== index));
  };

  const handleAddStop = () => {
    if (sortedStops.length >= 4) {
      return;
    }
    onStopsChange([
      ...sortedStops,
      { color, gte: nextUnusedGte(sortedStops) },
    ]);
  };

  return (
    <>
      <div className="grid gap-2 rounded-[var(--radius-control)] border bg-muted px-3 py-2">
        <span className="text-xs font-black uppercase tracking-normal text-muted-foreground">
          Fill color
        </span>
        {hasStops ? (
          <p className="text-xs text-muted-foreground">
            Visible fill comes from remaining-% thresholds below. Bar color is
            only the fallback if no threshold matches.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Solid bar color is the visible fill. Add remaining-% thresholds to
            change color as quota drops.
          </p>
        )}
        {hasStops
          ? sortedStops.map((stop, index) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-end gap-2"
                key={`${stop.gte}-${index}`}
              >
                <NumberField
                  label={index === 0 ? "At remaining ≥" : "≥"}
                  max={100}
                  value={stop.gte}
                  onChange={(value) => handleStopChange(index, "gte", value)}
                />
                <ColorField
                  label={index === 0 ? "Threshold color" : "Color"}
                  value={stop.color}
                  onChange={(value) => handleStopChange(index, "color", value)}
                />
                <Button
                  aria-label={`Remove remaining threshold ${stop.gte}`}
                  className="mb-0.5"
                  onClick={() => handleRemoveStop(index)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trash2 size={14} aria-hidden />
                </Button>
              </div>
            ))
          : null}
        <div className="flex flex-wrap gap-2">
          {hasStops ? (
            <>
              {sortedStops.length < 4 ? (
                <Button
                  onClick={handleAddStop}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Plus size={14} aria-hidden />
                  Add threshold
                </Button>
              ) : null}
              <Button
                onClick={() => onStopsChange([])}
                size="sm"
                type="button"
                variant="ghost"
              >
                Use solid bar color
              </Button>
            </>
          ) : (
            <Button
              onClick={() => onStopsChange(DEFAULT_REMAINING_COLOR_STOPS)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus size={14} aria-hidden />
              Add remaining-% colors
            </Button>
          )}
        </div>
      </div>
      <ColorField
        label={hasStops ? "Fallback color (no matching threshold)" : "Bar color"}
        value={color}
        onChange={onColorChange}
      />
    </>
  );
}

function nextUnusedGte(stops: Array<{ gte: number }>): number {
  const used = new Set(stops.map((stop) => stop.gte));
  for (const candidate of [75, 50, 25, 0]) {
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  for (let gte = 100; gte >= 0; gte -= 5) {
    if (!used.has(gte)) {
      return gte;
    }
  }
  return 0;
}
