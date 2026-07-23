import { cn } from "@/lib/utils";

type Props = {
  compactLabel?: string;
  label: string;
  ready: boolean;
};

export function ShellConnectionStatus({
  compactLabel,
  label,
  ready,
}: Props) {
  return (
    <div
      aria-live="polite"
      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground md:gap-3 md:text-base md:text-foreground"
      role="status"
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full md:size-2",
          ready ? "bg-primary" : "bg-border",
        )}
      />
      <span className="max-w-32 truncate md:hidden">
        {compactLabel || label}
      </span>
      <span className="hidden md:inline">{label}</span>
    </div>
  );
}
