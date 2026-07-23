import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ControlCenterBrand } from "./control-center-brand";

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
  statusVisible = false,
  testId,
  title,
  visual,
}: Props) {
  const statusVisual = visual ?? (busy ? <Spinner className="size-5" /> : null);

  return (
    <main
      aria-busy={busy || undefined}
      className="grid min-h-svh place-items-center bg-background px-4 py-8 text-foreground sm:px-6"
      data-testid={testId}
    >
      <section className="grid w-full max-w-2xl gap-8">
        <div className="flex justify-center">
          <ControlCenterBrand />
        </div>

        <header className="grid justify-items-center gap-3 text-center">
          {statusLabel ? (
            <div
              aria-label={statusLabel}
              aria-live="polite"
              className="flex min-h-11 items-center justify-center gap-3 text-sm font-medium text-muted-foreground"
              role="status"
            >
              {statusVisual ? (
                <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-foreground">
                  {statusVisual}
                </span>
              ) : null}
              <span className={cn(!statusVisible && "sr-only")}>
                {statusLabel}
              </span>
            </div>
          ) : visual ? (
            <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-foreground">
              {visual}
            </div>
          ) : null}

          <h1 className="max-w-xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            {title}
          </h1>
          <p className="max-w-xl text-pretty text-base leading-6 text-muted-foreground">
            {description}
          </p>
        </header>

        {children || actions ? (
          <div className="grid gap-5">
            {children ? <div className="w-full">{children}</div> : null}
            {actions ? <div className="mx-auto w-full">{actions}</div> : null}
          </div>
        ) : null}

        {footer ? <footer className="w-full">{footer}</footer> : null}
      </section>
    </main>
  );
}
