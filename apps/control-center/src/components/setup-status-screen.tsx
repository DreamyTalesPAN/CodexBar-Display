import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ControlCenterBrand } from "./control-center-brand";
import { Spinner } from "@/components/ui/spinner";

type Props = {
  actions?: ReactNode;
  busy?: boolean;
  children?: ReactNode;
  description: string;
  footer?: ReactNode;
  statusLabel?: string;
  statusVisible?: boolean;
  testId?: string;
  title: string;
  visual?: ReactNode;
};

export function SetupStatusScreen({
  actions,
  busy = false,
  children,
  description,
  footer,
  statusLabel,
  statusVisible = true,
  testId,
  title,
  visual,
}: Props) {
  return (
    <main
      aria-busy={busy || undefined}
      className="grid min-h-screen place-items-center bg-[#F9F9F9] px-6 py-12 text-[#1B1B1B]"
      data-testid={testId}
    >
      <section className="grid w-full max-w-[720px] gap-7 text-center">
        <ControlCenterBrand variant="hero" />

        <div className="grid gap-3">
          {visual ? <div className="mx-auto">{visual}</div> : null}
          <h1 className="text-[clamp(2rem,4vw,3.25rem)] font-black leading-tight">
            {title}
          </h1>
          <p className="mx-auto max-w-[620px] text-base leading-7 text-[#444933] sm:text-lg">
            {description}
          </p>
        </div>

        {statusLabel ? (
          <div
            aria-label={statusLabel}
            aria-live="polite"
            className="flex min-h-12 items-center justify-center gap-3 text-base font-semibold text-[#444933]"
            role="status"
          >
            {busy ? <Spinner className="size-5" /> : null}
            <span className={cn(!statusVisible && "sr-only")}>{statusLabel}</span>
          </div>
        ) : null}

        {children}
        {actions}
        {footer}
      </section>
    </main>
  );
}
