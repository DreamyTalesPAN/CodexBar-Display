"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { ThemeStudioSpec } from "@/lib/theme-studio";
import { ThemeSpecPreview, type ThemeRenderPack } from "../live-vibetv-preview";
import {
  aspectLockedResizeSize,
  clampCompanionSize,
  clampInt,
  clampedMoveDelta,
  DISPLAY_SIZE,
  isAspectLockedPrimitive,
  isFullCanvasBackground,
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
      mode: "select";
      clickIndex?: number;
      additive: boolean;
      initialSelection: number[];
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
  animate,
  children,
  toolbar,
  elementLabels,
  nonInteractiveIndices = [],
  onInteractionCancel,
  onInteractionCommit,
  onInteractionStart,
  onMoveMany,
  onResize,
  onSelect,
  onSelectMany,
  pack,
  selectedIndex,
  selectedIndices,
  spec,
}: {
  animate?: boolean;
  children?: ReactNode;
  toolbar?: ReactNode;
  elementLabels?: string[];
  nonInteractiveIndices?: number[];
  onInteractionCancel: () => void;
  onInteractionCommit: () => void;
  onInteractionStart: () => void;
  onMoveMany: (moves: PrimitiveMove[]) => void;
  onResize: (index: number, size: ResizeSize) => void;
  onSelect: (index: number, additive?: boolean) => void;
  onSelectMany: (indices: number[]) => void;
  pack: ThemeRenderPack;
  selectedIndex: number;
  selectedIndices: number[];
  spec: ThemeStudioSpec;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const surfaceRectRef = useRef<DOMRect | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const gestureRectRef = useRef<DOMRect | null>(null);
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

  function pointerPoint(event: ReactPointerEvent<Element>) {
    // Selection can reveal controls and change the canvas layout mid-gesture.
    const rect = gestureRectRef.current ?? svgRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: ((event.clientX - rect.left) / rect.width) * DISPLAY_SIZE,
      y: ((event.clientY - rect.top) / rect.height) * DISPLAY_SIZE,
    };
  }

  function startDrag(event: ReactPointerEvent<SVGRectElement>, index: number) {
    event.preventDefault();
    event.stopPropagation();
    gestureRectRef.current = svgRef.current?.getBoundingClientRect() ?? null;
    const point = pointerPoint(event);
    const primitive = spec.primitives[index];
    if (isFullCanvasBackground(primitive)) {
      startSelection(event, index);
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
    const moveIndices = (
      shouldMoveSelection ? normalizedSelection : [index]
    ).filter((i) => !nonInteractiveIndices.includes(i));
    dragRef.current = {
      mode: "move",
      origins: moveIndices.flatMap((moveIndex) => {
        const movePrimitive = spec.primitives[moveIndex];
        if (!movePrimitive) {
          return [];
        }
        const bounds = primitiveBounds(movePrimitive);
        return [
          {
            height: bounds.height,
            index: moveIndex,
            width: bounds.width,
            x: movePrimitive.x,
            y: movePrimitive.y,
          },
        ];
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

  function startSelection(event: ReactPointerEvent<Element>, clickIndex?: number) {
    event.preventDefault();
    event.stopPropagation();
    gestureRectRef.current = svgRef.current?.getBoundingClientRect() ?? null;
    surfaceRectRef.current = surfaceRef.current?.getBoundingClientRect() ?? null;
    const point = pointerPoint(event);
    dragRef.current = {
      mode: "select",
      clickIndex,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
      initialSelection: selectedIndices,
      startX: point.x,
      startY: point.y,
    };
    drawSelectionBox(point.x, point.y, point.x, point.y);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drawSelectionBox(startX: number, startY: number, x: number, y: number) {
    const canvas = gestureRectRef.current;
    const surface = surfaceRectRef.current;
    if (!canvas || !surface) return;
    setSelectionBox({
      x: canvas.left - surface.left + Math.min(startX, x) * canvas.width / DISPLAY_SIZE,
      y: canvas.top - surface.top + Math.min(startY, y) * canvas.height / DISPLAY_SIZE,
      width: Math.abs(x - startX) * canvas.width / DISPLAY_SIZE,
      height: Math.abs(y - startY) * canvas.height / DISPLAY_SIZE,
    });
  }

  function startResize(event: ReactPointerEvent<SVGElement>, index: number) {
    event.preventDefault();
    event.stopPropagation();
    gestureRectRef.current = svgRef.current?.getBoundingClientRect() ?? null;
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

  function movePointer(event: ReactPointerEvent<Element>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    event.preventDefault();
    const point = pointerPoint(event);
    if (drag.mode === "select") {
      drawSelectionBox(drag.startX, drag.startY, point.x, point.y);
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
        height: clampInt(
          point.y - drag.originY - drag.edgeOffsetY,
          1,
          maxHeight,
        ),
        width: clampInt(point.x - drag.originX - drag.edgeOffsetX, 1, maxWidth),
      };
      const aspectLocked = isAspectLockedPrimitive(primitive);
      let size =
        event.shiftKey || aspectLocked
          ? aspectLockedResizeSize({
              maxHeight,
              maxWidth,
              originHeight: drag.originHeight,
              originWidth: drag.originWidth,
              targetHeight: freeSize.height,
              targetWidth: freeSize.width,
            })
          : freeSize;
      if (aspectLocked) {
        const side = clampCompanionSize(Math.min(size.width, maxWidth, maxHeight));
        size = { height: side, width: side };
      }
      onResize(drag.index, size);
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
    gestureRectRef.current = null;
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

  function finishPointer(event: ReactPointerEvent<Element>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    if (drag.mode === "select") {
      event.preventDefault();
      const point = pointerPoint(event);
      const box = normalizedSelectionBox(
        drag.startX,
        drag.startY,
        point.x,
        point.y,
      );
      if (box.width < 2 && box.height < 2 && drag.clickIndex !== undefined) {
        onSelect(drag.clickIndex, drag.additive);
      } else {
        const hits = box.width < 2 && box.height < 2
          ? []
          : selectedPrimitiveIndices(spec.primitives, box);
        onSelectMany(
          normalizeSelectedIndices(
            [...(drag.additive ? drag.initialSelection : []), ...hits],
            spec.primitives.length,
          ).filter((i) => !nonInteractiveIndices.includes(i)),
        );
      }
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
      ref={surfaceRef}
      aria-label="Selection workspace"
      // Three rows plus a 98 px spacer: the preview stays where it is centred above the spacer; the details take all the space below the preview down to the bottom edge (scrolling inside), so the preview never moves or gets covered.
      className="relative grid min-h-0 w-full flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(3rem,1fr)_98px] max-lg:grid-rows-[auto_auto_auto] [touch-action:none]"
      onPointerDown={(event) => {
        if (event.button === 0 && !(event.target as Element).closest("svg, button, input, textarea, select, a, [role=button], [data-selection-controls]")) startSelection(event);
      }}
      onPointerCancel={() => stopDrag("cancel")}
      onPointerMove={movePointer}
      onPointerUp={finishPointer}
    >
    {toolbar ? <div className="row-start-1 [touch-action:auto]">{toolbar}</div> : null}
    <div className="row-start-2">
    <div className="mx-auto w-full max-w-[464px] rounded-xl bg-muted p-8 ring-1 ring-foreground/10">
    <div className="relative mx-auto aspect-square w-full max-w-[480px] overflow-hidden rounded-lg border border-[#1B1B1B] bg-black p-0">
      <ThemeSpecPreview
        animate={animate ?? !prefersReducedMotion}
        pack={pack}
        status="ready"
        themeId={spec.themeId}
      />
      <svg
        aria-label="Editable 240x240 preview"
        className="absolute inset-0 h-full w-full [touch-action:none]"
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
          if (nonInteractiveIndices.includes(index)) return null;
          const bounds = primitiveBounds(primitive);
          const selected = selectedIndices.includes(index);
          const active = selectedIndex === index;
          return (
            <g key={`${primitive.type}-${index}`}>
              <rect
                aria-label={`Select ${elementLabels?.[index] || primitive.type} ${index + 1}`}
                className={isFullCanvasBackground(primitive) ? "cursor-crosshair" : "cursor-move"}
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
      </svg>
    </div>
    </div>
    </div>
    {children ? <div className="row-start-3 flex flex-col pt-2 lg:row-span-2 lg:min-h-0 [touch-action:auto]">{children}</div> : null}
    {selectionBox ? (
      <div aria-hidden="true" data-testid="selection-box"
        className="pointer-events-none absolute z-10 border border-dashed border-[#CCFF00] bg-[#CCFF0033]"
        style={{
          left: selectionBox.x,
          top: selectionBox.y,
          width: selectionBox.width,
          height: selectionBox.height,
        }} />
    ) : null}
    </div>
  );
}
