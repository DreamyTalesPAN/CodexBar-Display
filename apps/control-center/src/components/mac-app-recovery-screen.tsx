"use client";

import { AppWindow, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  checking: boolean;
  phase: "repairing" | "failed";
  onRestart: () => void;
  onRetry: () => void;
};

export function MacAppRecoveryScreen({
  checking,
  phase,
  onRestart,
  onRetry,
}: Props) {
  const repairing = phase === "repairing";

  return (
    <main
      className="grid min-h-screen place-items-center bg-[#F9F9F9] px-6 py-12 text-[#1B1B1B]"
      data-testid="mac-app-recovery-screen"
    >
      <section
        aria-live="polite"
        className="grid w-full max-w-[720px] gap-8 text-center"
      >
        <div className="text-[clamp(3rem,7vw,5rem)] font-black uppercase leading-none tracking-normal">
          VIBETV
        </div>

        <div className="grid gap-4">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-[#747A60] bg-white">
            {repairing ? (
              <Loader2 className="animate-spin" size={24} aria-hidden />
            ) : (
              <AppWindow size={24} aria-hidden />
            )}
          </div>
          <h1 className="text-[clamp(2rem,4vw,3.25rem)] font-black leading-tight">
            {repairing
              ? "Repairing VibeTV Control Center"
              : "VibeTV Control Center needs attention"}
          </h1>
          <p className="mx-auto max-w-[620px] text-base leading-7 text-[#444933] sm:text-lg">
            {repairing
              ? "The background service stopped responding. VibeTV Control Center is restarting it automatically. Your setup stays saved."
              : "The background service could not be restarted automatically. Your VibeTV setup stays saved, so you do not need to set up WiFi again."}
          </p>
        </div>

        {repairing ? (
          <div className="flex min-h-12 items-center justify-center gap-3 font-semibold text-[#444933]" role="status">
            <Loader2 className="animate-spin" size={20} aria-hidden />
            <span>Repairing background service…</span>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-[620px] gap-3 sm:grid-cols-2">
            <Button
              className="h-12 w-full text-base"
              disabled={checking}
              onClick={onRetry}
              size="lg"
            >
              <RefreshCw
                className={checking ? "animate-spin" : undefined}
                aria-hidden
              />
              {checking ? "Checking" : "Try automatic repair again"}
            </Button>
            <Button
              className="h-12 w-full text-base"
              onClick={onRestart}
              size="lg"
              variant="outline"
            >
              <AppWindow aria-hidden />
              Restart Control Center
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
