"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import type { ThemeStudioAsset } from "@/lib/theme-studio";
import {
  assetFileName,
  assetKindLabel,
  formatBytes,
  themeAssetByteLength,
} from "@/lib/theme-studio-assets";

export function AddButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="w-full justify-start"
      onClick={onClick}
      size="sm"
      type="button"
      variant="outline"
    >
      <Icon data-icon="inline-start" aria-hidden />
      <span>{label}</span>
    </Button>
  );
}

export function AssetRow({
  asset,
  onRemove,
  onUse,
  path,
  referenced,
}: {
  asset: ThemeStudioAsset;
  onRemove: () => void;
  onUse: () => void;
  path: string;
  referenced: boolean;
}) {
  return (
    <Item size="sm" variant="outline">
      <ItemContent className="min-w-0">
        <ItemTitle>{assetFileName(path)}</ItemTitle>
        <ItemDescription className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span>{assetKindLabel(path)}</span>
          <span>{formatBytes(themeAssetByteLength(asset))}</span>
          <Badge variant={referenced ? "secondary" : "outline"}>
            {referenced ? "Used" : "Unused"}
          </Badge>
        </ItemDescription>
        <code className="block truncate text-[11px] text-ring">
          {path}
        </code>
      </ItemContent>
      <ItemActions className="basis-full grid w-full grid-cols-2">
        <Button onClick={onUse} size="sm" type="button">
          Use
        </Button>
        <Button onClick={onRemove} size="sm" type="button" variant="destructive">
          Remove
        </Button>
      </ItemActions>
    </Item>
  );
}

export function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-normal text-foreground">
      <span className="text-ring">{icon}</span>
      <span>{title}</span>
    </div>
  );
}
