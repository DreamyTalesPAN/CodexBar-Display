"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ThemeStudioPrimitive } from "@/lib/theme-studio";
import { ColorField, NumberField, SelectField, TextField } from "./editor-fields";
import {
  DISPLAY_SIZE,
  primitiveBounds,
  type FieldKey,
} from "./editor-geometry";

const DEFAULT_SPRITE_FPS = 8;

const VARIABLE_TOKENS = [
  { label: "Label", token: "{label}" },
  { label: "Session", token: "{session}" },
  { label: "Weekly", token: "{weekly}" },
  { label: "Reset", token: "{reset}" },
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
  const maxX = Math.max(0, DISPLAY_SIZE - bounds.width);
  const maxY = Math.max(0, DISPLAY_SIZE - bounds.height);
  const maxWidth = Math.max(1, DISPLAY_SIZE - primitive.x);
  const maxHeight = Math.max(1, DISPLAY_SIZE - primitive.y);
  const maxEditableWidth =
    primitive.type === "gif"
      ? Math.min(80, maxWidth)
      : primitive.type === "pixels"
        ? Math.min(maxWidth, Math.floor(1024 / Math.max(1, bounds.height)))
        : maxWidth;
  const maxEditableHeight =
    primitive.type === "gif"
      ? Math.min(80, maxHeight)
      : primitive.type === "pixels"
        ? Math.min(maxHeight, Math.floor(1024 / Math.max(1, bounds.width)))
        : maxHeight;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="X"
          max={maxX}
          value={primitive.x}
          onChange={(value) => onChange("x", value)}
        />
        <NumberField
          label="Y"
          max={maxY}
          value={primitive.y}
          onChange={(value) => onChange("y", value)}
        />
      </div>

      {(primitive.type === "rect" ||
        primitive.type === "progress" ||
        primitive.type === "gif" ||
        primitive.type === "sprite" ||
        primitive.type === "pixels" ||
        primitive.width !== undefined) ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Width"
            max={maxEditableWidth}
            min={1}
            value={primitive.type === "text" ? bounds.width : primitive.width ?? bounds.width}
            onChange={(value) => onChange("width", value)}
          />
          <NumberField
            label="Height"
            max={maxEditableHeight}
            min={1}
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
              ["session", "Session"],
              ["weekly", "Weekly"],
              ["reset", "Reset"],
              ["usageMode", "Mode"],
              ["time", "Time"],
              ["date", "Date"],
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Font size"
              max={30}
              min={1}
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
              ["session", "Session"],
              ["weekly", "Weekly"],
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
                max={32}
                min={1}
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
          <ColorField
            label="Bar color"
            value={primitive.color || "#C7FF68"}
            onChange={(value) => onChange("color", value)}
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
            max={32}
            min={1}
            value={primitive.frameCount ?? 1}
            onChange={(value) => onChange("frameCount", value)}
          />
          <NumberField
            label="FPS"
            max={30}
            value={primitive.fps ?? DEFAULT_SPRITE_FPS}
            onChange={(value) => onChange("fps", value)}
          />
          <NumberField
            label="Columns"
            max={primitive.frameCount ?? 1}
            min={1}
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
