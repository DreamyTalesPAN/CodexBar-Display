import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type EditorStatus = {
  message: string;
  tone: EditorStatusTone;
};

export type EditorStatusTone = "attention" | "ready" | "unknown";

export function StatusPill({
  icon,
  label,
  tone,
}: {
  icon?: ReactNode;
  label: string;
  tone: "attention" | "neutral" | "ready" | "warn";
}) {
  const toneClass =
    tone === "attention"
      ? "bg-destructive/10 text-destructive"
      : tone === "warn"
          ? "bg-warning text-warning-foreground"
          : "bg-secondary text-secondary-foreground";
  return (
    <Badge
      className={cn("min-h-8 gap-1.5 px-3", tone === "ready" ? undefined : toneClass)}
      variant={tone === "ready" ? "default" : "outline"}
    >
      {icon}
      <span>{label}</span>
    </Badge>
  );
}

export function StatusLine({
  detail,
  icon,
  title,
  tone,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
  tone: EditorStatusTone;
}) {
  const toneClass =
    tone === "attention"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "ready"
        ? "border-success-foreground/40 bg-success text-success-foreground"
        : "bg-secondary text-secondary-foreground";
  return (
    <Alert
      className={toneClass}
      role={tone === "attention" ? "alert" : "status"}
    >
      {icon}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-current/80">{detail}</AlertDescription>
    </Alert>
  );
}
