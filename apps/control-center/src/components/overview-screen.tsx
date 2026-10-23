"use client";

import { useEffect, useState } from "react";
import type {
  CompanionStatus,
  DeviceInfo,
  UsageSnapshot,
} from "./control-center-types";
import { Check } from "lucide-react";
import { activeLiveThemeId } from "@/lib/active-theme-upgrade";
import { validateThemeSpec } from "@/lib/theme-studio";
import {
  loadUserThemes,
  USER_THEMES_STORAGE_KEY,
  type ThemeStudioDocument,
} from "@/lib/theme-studio-storage";
import type { ThemeProduct } from "@/lib/themes";
import {
  deviceIsCustomerConnected,
  deviceIsReady,
  deviceUsesCable,
} from "./control-center-types";
import { SetupDialog } from "./setup/setup-dialog";
import type { DisplayFrameSnapshot } from "./live-vibetv-preview";
import { LiveVibeTV3DPreview } from "./live-vibetv-3d-preview";

export type OverviewNotice = "weak-wifi" | "theme-not-shown";

// The words the Overview tiles used before #755, unchanged.
const NOTICE_COPY: Record<OverviewNotice, { description: string; title: string }> = {
  "weak-wifi": {
    description: "Move VibeTV closer to your router.",
    title: "Weak WiFi signal",
  },
  "theme-not-shown": {
    description: "VibeTV can't show this theme. Choose another theme.",
    title: "Theme not shown",
  },
};

// Issue #498: the Companion names a theme the VibeTV cannot draw.
// Issue #265: the Mac App names a WiFi signal too weak for reliable updates.
function activeOverviewNotices(device: DeviceInfo | null): OverviewNotice[] {
  const notices: OverviewNotice[] = [];
  if (!deviceIsCustomerConnected(device)) return notices;
  if (device?.health?.wifi?.weak === true) notices.push("weak-wifi");
  if (device?.connectionState === "display_render_failed") {
    notices.push("theme-not-shown");
  }
  return notices;
}

/**
 * The one Overview notice to show now, or null; the weak WiFi notice comes
 * first. A notice the customer closed stays closed while it is there; once it
 * has gone away, its return opens again. It waits while `held` (the busy
 * notice is due): the two would otherwise each wait for the other. The state
 * lives in the app, not in the screen, because the Overview unmounts on other
 * tabs and a closed notice must stay closed there too.
 */
export function useOverviewNotice(device: DeviceInfo | null, held: boolean) {
  const active = activeOverviewNotices(device);
  const [closed, setClosed] = useState<OverviewNotice[]>([]);
  // A notice that went away is forgotten, so its return opens again.
  const stillClosed = closed.filter((notice) => active.includes(notice));
  if (stillClosed.length !== closed.length) setClosed(stillClosed);
  const notice =
    active.find((candidate) => !stillClosed.includes(candidate)) ?? null;
  return {
    close: (closedNotice: OverviewNotice) =>
      setClosed([...stillClosed, closedNotice]),
    notice: held ? null : notice,
  };
}

type OverviewScreenProps = {
  companionVersion?: string;
  companionStatus: CompanionStatus;
  device: DeviceInfo | null;
  displayFrame?: DisplayFrameSnapshot | null;
  firmwareUpdateStatus?: {
    phase?: string;
    stage?: string;
  } | null;
  /** The notice to show, from useOverviewNotice. */
  notice?: OverviewNotice | null;
  onCloseNotice?: (notice: OverviewNotice) => void;
  usage?: UsageSnapshot | null;
  /**
   * What the last update check found, for the lines under the Mac App and
   * Firmware figures. No value (not checked yet, or the check failed) says
   * nothing: "Up to date" is only for a confirmed-current result.
   */
  firmwareUpdate?: "available" | "current";
  macAppUpdate?: "available" | "current";
  /** The catalog, to name the theme VibeTV shows. */
  themes?: ThemeProduct[];
  /** The app runs on Windows; the wording says "computer" instead of "Mac". */
  windowsHost?: boolean;
};

/**
 * Overview: the status line with a small green check, the VibeTV centred in 3D
 * and four quiet figures under a hairline (Mac App, VibeTV, Display, Firmware),
 * as in the approved calm master. Calm rule 12 is deliberately not applied to
 * this page: the heading and the device are centred, not left-aligned.
 */
export function OverviewScreen({
  companionStatus,
  companionVersion,
  device,
  displayFrame = null,
  firmwareUpdate,
  firmwareUpdateStatus = null,
  macAppUpdate,
  notice = null,
  onCloseNotice,
  themes = [],
  usage,
  windowsHost = false,
}: OverviewScreenProps) {
  // Theme Studio unmounts Overview, so returning reads its latest save once.
  // Changes in another window refresh it without parsing on every status poll.
  const [savedThemes, setSavedThemes] = useState(loadUserThemes);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === USER_THEMES_STORAGE_KEY) {
        setSavedThemes(loadUserThemes());
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  const connected = deviceIsCustomerConnected(device);
  const updateOwnedDisconnect = Boolean(
    !connected && firmwareUpdateStatus?.phase === "installing",
  );

  return (
    <div className="flex w-full flex-1 flex-col pb-8">
      {/* The page fills the window's height (#784 point 1): the numbers sit at
          the bottom, "VibeTV is connected" and the device are centred as one
          group in the space above them. */}
      <section
        aria-labelledby="vibetv-overview-title"
        className="mt-7 flex flex-1 flex-col items-center"
      >
        <div className="mt-auto flex items-center gap-3">
          {connected ? (
            <span
              aria-hidden
              className="grid size-[22px] place-items-center rounded-full bg-success text-success-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--success-foreground)_22%,transparent)]"
            >
              <Check className="size-[13px]" strokeWidth={2.6} />
            </span>
          ) : null}
          <h2
            className="text-[28px] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground"
            id="vibetv-overview-title"
          >
            {connected
              ? "VibeTV is connected"
              : updateOwnedDisconnect
                ? "VibeTV is restarting"
                : "VibeTV status"}
          </h2>
        </div>

        <div className="mt-3 mb-5 w-full">
          <LiveVibeTV3DPreview
            className="-my-[22px] aspect-[640/411] max-w-[718px]"
            device={device}
            displayFrame={displayFrame}
            updateOwnedDisconnect={updateOwnedDisconnect}
            usage={usage || null}
          />
        </div>

        <dl className="mt-auto grid w-full grid-cols-2 gap-x-8 gap-y-5 border-t border-foreground/10 pt-5 text-[13px] min-[960px]:grid-cols-4">
          <Fact
            label={windowsHost ? "App" : "Mac App"}
            line={updateLine(macAppUpdate)}
            value={
              companionStatus === "online"
                ? companionVersion || "Online"
                : companionStatus === "missing"
                  ? "Not reachable"
                  : windowsHost
                    ? "Waiting for app"
                    : "Waiting for Mac App"
            }
          />
          <Fact
            label="VibeTV"
            line={
              connected
                ? `${deviceUsesCable(device) ? "USB-C cable" : "WiFi"} · connected`
                : undefined
            }
            value={
              connected
                ? device?.deviceId || device?.board || "Connected"
                : updateOwnedDisconnect
                  ? "Restarting"
                  : "Not connected"
            }
          />
          <Fact
            label="Display"
            line="Active theme"
            value={activeThemeLabel(themes, device, savedThemes)}
          />
          <Fact
            label="Firmware"
            line={device?.firmware ? updateLine(firmwareUpdate) : undefined}
            value={device?.firmware || "Waiting for VibeTV"}
          />
        </dl>
      </section>

      {notice ? (
        <SetupDialog
          description={NOTICE_COPY[notice].description}
          onOpenChange={(open) => {
            if (!open) onCloseNotice?.(notice);
          }}
          open
          rank="notice"
          secondaryAction={{
            label: "Not now",
            onSelect: () => onCloseNotice?.(notice),
          }}
          showCloseButton={false}
          title={NOTICE_COPY[notice].title}
        />
      ) : null}
    </div>
  );
}

function updateLine(update?: "available" | "current"): string | undefined {
  return update === "available"
    ? "Update available"
    : update === "current"
      ? "Up to date"
      : undefined;
}

/** One quiet figure: a muted label, the value in 600, a muted line. */
function Fact({
  label,
  line,
  value,
}: {
  label: string;
  line?: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold">{value}</dd>
      {line ? <dd className="text-muted-foreground">{line}</dd> : null}
    </div>
  );
}

function activeThemeLabel(
  themes: ThemeProduct[],
  device: DeviceInfo | null | undefined,
  saved: ReturnType<typeof loadUserThemes>,
): string {
  // The customer's own themes are saved in this browser, by Theme Studio, with
  // the name they gave them.
  const ownName = (matches: (document: ThemeStudioDocument) => boolean) =>
    (saved.ok ? saved.value.themes : saved.data?.themes || []).find(
      ({ document }) => document.usage !== "screensaver" && matches(document),
    )?.document.packName;
  // The file in the live slot says whose theme it is: a saved theme is sent
  // under a path only it has, also when a later catalog gave one of its themes
  // the same id. During standby that file is all VibeTV reports of the slot;
  // the screensaver on screen is not it.
  const standbyActive = device?.standby?.active === true;
  const livePath = (
    standbyActive
      ? device.standby?.liveThemePath
      : device?.display?.themeSpec?.path
  )?.trim();
  const ownByFile =
    livePath &&
    ownName(
      (document) =>
        validateThemeSpec(document.spec, document.assets, "live")
          .themeSpecPath === livePath,
    );
  if (ownByFile) {
    return ownByFile;
  }
  const theme = activeLiveThemeId(themes, device)?.trim();
  if (!theme) {
    if (standbyActive && livePath) {
      return "Custom theme";
    }
    return deviceIsReady(device) ? "Default" : "Not available";
  }
  const own =
    !themes.some((listed) => listed.themeId === theme) &&
    ownName((document) => document.spec.themeId === theme);
  if (own) {
    return own;
  }
  // A catalog theme is called by its title, as the Themes page calls it.
  const listed = themes.find((product) => product.themeId === theme);
  if (listed) {
    return listed.title;
  }
  return theme.split(/[-_]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
