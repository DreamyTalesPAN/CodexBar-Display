import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
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
      className="grid min-h-svh place-items-center bg-muted/40 px-4 py-8 text-foreground sm:px-6"
      data-testid={testId}
    >
      <section className="grid w-full max-w-2xl gap-5">
        <div className="flex justify-center">
          <ControlCenterBrand />
        </div>

        <Card className="w-full">
          <CardHeader className="items-center gap-3 border-b border-border px-5 py-6 text-center sm:px-8 sm:py-8">
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
            <CardDescription className="max-w-xl text-pretty text-base leading-6">
              {description}
            </CardDescription>
          </CardHeader>

          {children || actions ? (
            <CardContent className="grid gap-5 px-5 sm:px-8">
              {children ? <div className="w-full">{children}</div> : null}
              {actions ? <div className="mx-auto w-full">{actions}</div> : null}
            </CardContent>
          ) : null}

          {footer ? (
            <CardFooter className="justify-center px-5 sm:px-8">
              <div className="w-full">{footer}</div>
            </CardFooter>
          ) : null}
        </Card>
      </section>
    </main>
  );
}
