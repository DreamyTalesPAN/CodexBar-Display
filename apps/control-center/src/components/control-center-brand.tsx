import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  showTagline?: boolean;
  variant?: "hero" | "sidebar" | "compact";
};

export function ControlCenterBrand({
  className,
  showTagline = true,
  variant = "sidebar",
}: Props) {
  if (variant === "compact") {
    return (
      <span
        aria-label="VibeTV"
        className={cn("text-sm font-black text-sidebar-primary", className)}
      >
        VT
      </span>
    );
  }

  if (variant === "hero") {
    return (
      <div
        className={cn(
          "text-[clamp(3rem,7vw,5rem)] font-black uppercase leading-none tracking-normal",
          className,
        )}
      >
        VIBE<span className="text-primary">TV</span>
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-2xl font-black uppercase leading-none">
        VIBE<span className="text-sidebar-primary">TV</span>
      </div>
      {showTagline ? (
        <div className="mt-1 text-[0.7rem] font-semibold uppercase tracking-wide text-sidebar-foreground/65">
          Control Center
        </div>
      ) : null}
    </div>
  );
}
