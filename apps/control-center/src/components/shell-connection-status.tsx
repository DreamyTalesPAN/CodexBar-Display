import { cn } from "@/lib/utils";
import {
  deviceIsCustomerConnected,
  type CompanionStatus,
  type DeviceInfo,
} from "./control-center-types";

type Props = {
  compactLabel?: string;
  label: string;
  ready: boolean;
};

export function overviewConnectionStatus(
  companionStatus: CompanionStatus,
  device: DeviceInfo | null,
  firmwareUpdatePhase?: string,
  appVersion?: string,
): Props {
  if (companionStatus === "missing") {
    return { label: "Mac App offline", compactLabel: "Offline", ready: false };
  }
  if (companionStatus !== "online") {
    return { label: "Connecting to Mac App", compactLabel: "Connecting", ready: false };
  }
  if (deviceIsCustomerConnected(device)) {
    return { label: appVersion ? `Online · v${appVersion}` : "Online", compactLabel: "Online", ready: true };
  }
  if (firmwareUpdatePhase === "installing") {
    return { label: "VibeTV restarting", compactLabel: "Restarting", ready: false };
  }
  return { label: "VibeTV not connected", compactLabel: "Not connected", ready: false };
}

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
