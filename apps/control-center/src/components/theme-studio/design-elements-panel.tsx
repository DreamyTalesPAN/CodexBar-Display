"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ThemeStudioDocument } from "./theme-studio-editor-state";
import { friendlyElementName } from "./theme-studio-customer-labels";
import { pinnedElement, readingKey, usageSectionIndices, type DesignRow } from "./design-controls";

export function DesignElementsPanel({ document, onSelect, onMove }: {
  document: ThemeStudioDocument;
  onSelect: (indices: number[]) => void;
  onMove: (from: number[], to: number[], mode: "position" | "layers") => string;
}) {
  const [mode, setMode] = useState<"position" | "layers">("position");
  const [grouped, setGrouped] = useState(true);
  const [dragged, setDragged] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const all = document.spec.primitives;
  const groups = mode === "position" && grouped ? usageSectionIndices(all) : [];
  const rows: DesignRow[] = groups.flatMap((indices, slot) => indices.length > 1 ? [{
    id: `window-${slot}`, name: indices.some((i) => readingKey(all[i]) === (slot === 0 ? "session" : "weekly")) ? `${slot === 0 ? "Session" : "Weekly"} section` : `${slot === 0 ? "First" : "Second"} usage section`, indices,
    y: Math.min(...indices.map((i) => all[i].y)), locked: false,
  }] : []);
  const groupedIndices = rows.flatMap((row) => row.indices);
  all.forEach((p, i) => {
    if (!groupedIndices.includes(i)) rows.push({
      id: `element-${i}`, name: friendlyElementName(p, document.assets), indices: [i], y: p.y, locked: pinnedElement(p, all),
    });
  });
  rows.sort((a, b) => mode === "position" ? a.y - b.y || a.indices[0] - b.indices[0] : b.indices[0] - a.indices[0]);
  const editable = rows.filter((row) => !row.locked);
  function move(from: DesignRow, to?: DesignRow) {
    if (to && to.id !== from.id && !from.locked && !to.locked) setMessage(onMove(from.indices, to.indices, mode));
    setDragged(null);
  }
  return (
    <details onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && ["z", "y"].includes(event.key.toLowerCase())) setMessage("");
    }}>
      <summary className="min-h-11 cursor-pointer py-3 font-medium">Elements in this design</summary>
      <p className="mb-3 text-xs text-muted-foreground">Select an element to edit it, even when it is hidden behind another.</p>
      {all.length ? <>
        <label className="grid gap-2 text-sm">
          Arrange elements
          <select aria-label="Arrange elements" className="h-11 w-full rounded-md border bg-background px-3" value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setDragged(null); }}>
            <option value="position">Position on screen — top to bottom</option>
            <option value="layers">Layer order — front to back</option>
          </select>
        </label>
        <p className="my-2 text-xs text-muted-foreground">
          {mode === "position" ? "Drag to swap vertical positions. Arrows do the same. Left/right positions stay unchanged." : "Drag to move in front of or behind another element. Screen positions stay unchanged."}
        </p>
        {mode === "position" ? <label className="mb-2 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
          Keep usage sections together
        </label> : null}
        <ol className="grid gap-2" aria-label={mode === "position" ? "Elements from top to bottom" : "Layers from front to back"}>
          {rows.map((row) => {
            const order = editable.findIndex((r) => r.id === row.id);
            return <li key={row.id} data-design-row={row.id} draggable={!row.locked}
              onDragStart={(e) => { if (row.locked) return e.preventDefault(); setDragged(row.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", row.id); }}
              onDragEnd={() => setDragged(null)}
              onDragOver={(e) => { if (dragged && !row.locked) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
              onDrop={(e) => { e.preventDefault(); const from = rows.find((r) => r.id === dragged); if (from) move(from, row); }}
              className={`flex min-w-0 items-center gap-1 rounded-md border p-1 ${dragged === row.id ? "opacity-50" : ""}`}>
              <GripVertical aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground ${row.locked ? "invisible" : "cursor-grab"}`} />
              <Button variant="ghost" className="h-auto min-h-11 min-w-0 flex-1 justify-start whitespace-normal px-2 text-left" disabled={row.locked} onClick={() => onSelect(row.indices)}>
                <span className="min-w-0 break-words">{row.name}<span className="block text-xs font-normal text-muted-foreground">{row.locked ? "Attached to scene" : row.indices.length > 1 ? `${row.indices.length} elements · move together` : mode === "position" ? `Top: ${row.y}` : "Select to edit"}</span></span>
              </Button>
              <Button variant="ghost" size="icon" disabled={row.locked || order <= 0} aria-label={`${mode === "position" ? "Move up" : "Bring forward"}: ${row.name}`} onClick={() => move(row, editable[order - 1])}><ArrowUp /></Button>
              <Button variant="ghost" size="icon" disabled={row.locked || order < 0 || order === editable.length - 1} aria-label={`${mode === "position" ? "Move down" : "Send backward"}: ${row.name}`} onClick={() => move(row, editable[order + 1])}><ArrowDown /></Button>
            </li>;
          })}
        </ol>
        {message ? <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
      </> : <p className="text-sm text-muted-foreground">There are no elements yet.</p>}
    </details>
  );
}
