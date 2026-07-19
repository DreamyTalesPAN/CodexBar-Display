"use client";

import { Trash2 } from "lucide-react";
import type { ThemeStudioPrimitive } from "@/lib/theme-studio";
import { ColorField, NumberField, SelectField, TextField } from "./editor-fields";
import { primitiveBounds, type FieldKey } from "./editor-geometry";

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

      {(primitive.type === "rect" ||
        primitive.type === "progress" ||
        primitive.type === "gif" ||
        primitive.type === "sprite" ||
        primitive.type === "pixels" ||
        primitive.width !== undefined) ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Width"
            value={primitive.type === "text" ? bounds.width : primitive.width ?? bounds.width}
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
            <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
              Variables
            </span>
            <div className="grid grid-cols-2 gap-2">
              {VARIABLE_TOKENS.map((item) => (
                <button
                  className="min-w-0 border border-[#747A60] bg-[#F9F9F9] px-2 py-2 text-left text-xs text-[#1B1B1B] outline-none transition hover:bg-[#EEEEEE] focus-visible:border-[#5E7200]"
                  key={item.token}
                  onClick={() => onInsertToken(item.token)}
                  type="button"
                >
                  <span className="block truncate font-black">{item.label}</span>
                  <code className="block truncate text-[11px] text-[#5E7200]">
                    {item.token}
                  </code>
                </button>
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
        </>
      ) : null}

      {primitive.type === "rect" ? (
        <ColorField
          label="Fill color"
          value={primitive.color || "#222222"}
          onChange={(value) => onChange("color", value)}
        />
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

      <button
        className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 border border-[#7D2633] bg-[#FFE3E8] px-3 text-sm font-black text-[#7D2633] outline-none hover:bg-[#FFD1DA] focus-visible:border-[#7D2633]"
        onClick={onDelete}
        type="button"
      >
        <Trash2 size={16} aria-hidden />
        <span>Delete</span>
      </button>
    </div>
  );
}
