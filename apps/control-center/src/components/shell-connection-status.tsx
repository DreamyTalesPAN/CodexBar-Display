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
  windowsHost = false,
): Props {
  if (companionStatus === "missing") {
    return { label: windowsHost ? "App offline" : "Mac App offline", compactLabel: "Offline", ready: false };
  }
  if (companionStatus !== "online") {
    return { label: windowsHost ? "Connecting to app" : "Connecting to Mac App", compactLabel: "Connecting", ready: false };
  }
  if (deviceIsCustomerConnected(device)) {
    // Issue #498: the Companion names a theme the VibeTV cannot draw.
    if (device?.connectionState === "display_render_failed") {
      return { label: "Theme not shown · VibeTV can't show this theme. Choose another theme.", compactLabel: "Theme not shown", ready: false };
    }
    // Issue #265: the Mac App names a WiFi signal too weak for reliable updates.
    if (device?.health?.wifi?.weak === true) {
      return { label: "Weak WiFi signal · Move VibeTV closer to your router.", compactLabel: "Weak WiFi signal", ready: true };
    }
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
