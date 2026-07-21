"use client";

import { AppWindow, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SetupStatusScreen } from "./setup-status-screen";

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
  const title = repairing
    ? "Repairing VibeTV Control Center"
    : "VibeTV Control Center needs attention";
  const description = repairing
    ? "The background service stopped responding. VibeTV Control Center is restarting it automatically. Your setup stays saved."
    : "The background service could not be restarted automatically. Your VibeTV setup stays saved, so you do not need to set up WiFi again.";
  const actions = repairing ? null : (
    <div className="mx-auto grid w-full max-w-[620px] gap-3 sm:grid-cols-2">
      <Button
        className="h-12 w-full text-base"
        disabled={checking}
        onClick={onRetry}
        size="lg"
      >
        {checking ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <RefreshCw data-icon="inline-start" aria-hidden />
        )}
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
  );

  return (
    <SetupStatusScreen
      actions={actions}
      busy={repairing || checking}
      description={description}
      statusLabel={
        repairing
          ? "Repairing background service…"
          : checking
            ? "Checking background service…"
            : undefined
      }
      testId="mac-app-recovery-screen"
      title={title}
      visual={
        repairing ? null : (
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-[#747A60] bg-white">
            <AppWindow size={24} aria-hidden />
          </div>
        )
      }
    />
  );
}
