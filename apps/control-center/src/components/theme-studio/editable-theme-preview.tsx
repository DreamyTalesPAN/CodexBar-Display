"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { ThemeStudioSpec } from "@/lib/theme-studio";
import {
  ThemeSpecPreview,
  type ThemeRenderPack,
} from "../live-vibetv-preview";
import {
  aspectLockedResizeSize,
  clampInt,
  clampedMoveDelta,
  DISPLAY_SIZE,
  isFullCanvasRect,
  normalizeSelectedIndices,
  normalizedSelectionBox,
  primitiveBounds,
  selectedPrimitiveIndices,
  type DragMoveOrigin,
  type PrimitiveMove,
  type ResizeSize,
  type SelectionBox,
} from "./editor-geometry";

type DragState =
  | {
      mode: "move";
      origins: DragMoveOrigin[];
      startX: number;
      startY: number;
    }
  | {
      currentX: number;
      currentY: number;
      mode: "select";
      startX: number;
      startY: number;
    }
  | {
      edgeOffsetX: number;
      edgeOffsetY: number;
      index: number;
      mode: "resize";
      originHeight: number;
      originWidth: number;
      originX: number;
      originY: number;
    };

export function EditableThemePreview({
  onInteractionCancel,
  onInteractionCommit,
  onInteractionStart,
  onMoveMany,
  onResize,
  onSelect,
  onSelectMany,
  pack,
  readOnly = false,
  selectedIndex,
  selectedIndices,
  spec,
}: {
  onInteractionCancel: () => void;
  onInteractionCommit: () => void;
  onInteractionStart: () => void;
  onMoveMany: (moves: PrimitiveMove[]) => void;
  onResize: (index: number, size: ResizeSize) => void;
  onSelect: (index: number, additive?: boolean) => void;
  onSelectMany: (indices: number[]) => void;
  pack: ThemeRenderPack;
  readOnly?: boolean;
  selectedIndex: number;
  selectedIndices: number[];
  spec: ThemeStudioSpec;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) =>
      setPrefersReducedMotion(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  function pointerPoint(event: ReactPointerEvent<SVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: ((event.clientX - rect.left) / rect.width) * DISPLAY_SIZE,
      y: ((event.clientY - rect.top) / rect.height) * DISPLAY_SIZE,
    };
  }

  function startDrag(
    event: ReactPointerEvent<SVGRectElement>,
    index: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const point = pointerPoint(event);
    const primitive = spec.primitives[index];
    if (isFullCanvasRect(primitive)) {
      startSelection(event);
      return;
    }
    const normalizedSelection = normalizeSelectedIndices(
      selectedIndices,
      spec.primitives.length,
    );
    const shouldMoveSelection =
      normalizedSelection.length > 1 &&
      normalizedSelection.includes(index) &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey;
    const moveIndices = shouldMoveSelection ? normalizedSelection : [index];
    dragRef.current = {
      mode: "move",
      origins: moveIndices.flatMap((moveIndex) => {
        const movePrimitive = spec.primitives[moveIndex];
        if (!movePrimitive) {
          return [];
        }
        const bounds = primitiveBounds(movePrimitive);
        return [{
          height: bounds.height,
          index: moveIndex,
          width: bounds.width,
          x: movePrimitive.x,
          y: movePrimitive.y,
        }];
      }),
      startX: point.x,
      startY: point.y,
    };
    onInteractionStart();
    if (!shouldMoveSelection) {
      onSelect(index, event.shiftKey || event.metaKey || event.ctrlKey);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startSelection(event: ReactPointerEvent<SVGRectElement>) {
    event.preventDefault();
    const point = pointerPoint(event);
    dragRef.current = {
      currentX: point.x,
      currentY: point.y,
      mode: "select",
      startX: point.x,
      startY: point.y,
    };
    setSelectionBox(normalizedSelectionBox(point.x, point.y, point.x, point.y));
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startResize(
    event: ReactPointerEvent<SVGElement>,
    index: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const point = pointerPoint(event);
    const primitive = spec.primitives[index];
    const bounds = primitiveBounds(primitive);
    dragRef.current = {
      edgeOffsetX: point.x - (primitive.x + bounds.width),
      edgeOffsetY: point.y - (primitive.y + bounds.height),
      index,
      mode: "resize",
      originHeight: bounds.height,
      originWidth: bounds.width,
      originX: primitive.x,
      originY: primitive.y,
    };
    onInteractionStart();
    onSelect(index, event.metaKey || event.ctrlKey);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event: ReactPointerEvent<SVGElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    event.preventDefault();
    const point = pointerPoint(event);
    if (drag.mode === "select") {
      drag.currentX = point.x;
      drag.currentY = point.y;
      setSelectionBox(
        normalizedSelectionBox(drag.startX, drag.startY, point.x, point.y),
      );
      return;
    }
    if (drag.mode === "resize") {
      const primitive = spec.primitives[drag.index];
      if (!primitive) {
        return;
      }
      const maxWidth = DISPLAY_SIZE - drag.originX;
      const maxHeight = DISPLAY_SIZE - drag.originY;
      const freeSize = {
        height: clampInt(point.y - drag.originY - drag.edgeOffsetY, 1, maxHeight),
        width: clampInt(point.x - drag.originX - drag.edgeOffsetX, 1, maxWidth),
      };
      onResize(
        drag.index,
        event.shiftKey
          ? aspectLockedResizeSize({
              maxHeight,
              maxWidth,
              originHeight: drag.originHeight,
              originWidth: drag.originWidth,
              targetHeight: freeSize.height,
              targetWidth: freeSize.width,
            })
          : freeSize,
      );
      return;
    }
    if (drag.origins.length === 0) {
      return;
    }
    const delta = clampedMoveDelta(
      drag.origins,
      point.x - drag.startX,
      point.y - drag.startY,
    );
    onMoveMany(
      drag.origins.map((origin) => ({
        index: origin.index,
        x: origin.x + delta.x,
        y: origin.y + delta.y,
      })),
    );
  }

  function stopDrag(outcome: "cancel" | "commit" | "selection" = "commit") {
    const drag = dragRef.current;
    dragRef.current = null;
    setSelectionBox(null);
    if (!drag || drag.mode === "select" || outcome === "selection") {
      return;
    }
    if (outcome === "cancel") {
      onInteractionCancel();
    } else {
      onInteractionCommit();
    }
  }

  function finishPointer(event: ReactPointerEvent<SVGElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    if (drag.mode === "select") {
      event.preventDefault();
      const box = normalizedSelectionBox(
        drag.startX,
        drag.startY,
        drag.currentX,
        drag.currentY,
      );
      onSelectMany(
        box.width < 2 && box.height < 2
          ? []
          : selectedPrimitiveIndices(spec.primitives, box),
      );
    }
    stopDrag(drag.mode === "select" ? "selection" : "commit");
  }

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !dragRef.current) {
        return;
      }
      event.preventDefault();
      stopDrag("cancel");
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  });

  return (
    <div
      aria-label={readOnly ? "AI candidate theme preview" : undefined}
      className="relative aspect-square w-full max-w-[480px] overflow-hidden border border-[#1B1B1B] bg-black p-0"
      data-preview-mode={readOnly ? "candidate" : "editor"}
    >
      <ThemeSpecPreview
        animate={!prefersReducedMotion}
        pack={pack}
        status="ready"
        themeId={spec.themeId}
      />
      {readOnly ? null : (
        <svg
          aria-label="Editable 240x240 preview"
          className="absolute inset-0 h-full w-full [touch-action:none]"
          onPointerCancel={() => stopDrag("cancel")}
          onPointerMove={movePointer}
          onPointerUp={finishPointer}
          ref={svgRef}
          viewBox="0 0 240 240"
        >
        <rect
          aria-hidden="true"
          className="cursor-crosshair"
          fill="transparent"
          height={DISPLAY_SIZE}
          onPointerDown={startSelection}
          width={DISPLAY_SIZE}
          x="0"
          y="0"
        />
        {spec.primitives.map((primitive, index) => {
          const bounds = primitiveBounds(primitive);
          const selected = selectedIndices.includes(index);
          const active = selectedIndex === index;
          return (
            <g key={`${primitive.type}-${index}`}>
              <rect
                aria-label={`Select ${primitive.type} ${index + 1}`}
                className="cursor-move"
                fill="transparent"
                height={Math.max(8, bounds.height)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  onSelect(
                    index,
                    event.shiftKey || event.metaKey || event.ctrlKey,
                  );
                }}
                onPointerDown={(event) => startDrag(event, index)}
                role="button"
                stroke={selected ? "#C7FF68" : "transparent"}
                strokeDasharray={active ? "4 3" : "2 2"}
                strokeWidth={selected ? (active ? 1.5 : 1) : 0}
                tabIndex={0}
                width={Math.max(8, bounds.width)}
                x={primitive.x}
                y={primitive.y}
              />
              {active ? (
                <g
                  aria-hidden="true"
                  className="cursor-se-resize"
                  onPointerDown={(event) => startResize(event, index)}
                >
                  <rect
                    fill="transparent"
                    height="14"
                    pointerEvents="all"
                    width="14"
                    x={primitive.x + Math.max(8, bounds.width) - 7}
                    y={primitive.y + Math.max(8, bounds.height) - 7}
                  />
                  <circle
                    cx={primitive.x + Math.max(8, bounds.width)}
                    cy={primitive.y + Math.max(8, bounds.height)}
                    fill="#C7FF68"
                    pointerEvents="none"
                    r="3"
                  />
                </g>
              ) : null}
            </g>
          );
        })}
        {selectionBox ? (
          <rect
            fill="#CCFF0033"
            height={selectionBox.height}
            pointerEvents="none"
            stroke="#CCFF00"
            strokeDasharray="4 3"
            strokeWidth="1"
            width={selectionBox.width}
            x={selectionBox.x}
            y={selectionBox.y}
          />
        ) : null}
        </svg>
      )}
    </div>
  );
}
