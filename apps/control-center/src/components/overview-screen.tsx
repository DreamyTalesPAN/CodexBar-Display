"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CompanionStatus,
  DeviceInfo,
  UsageSnapshot,
} from "./control-center-types";
import { deviceIsCustomerConnected } from "./control-center-types";
import { SetupDialog } from "./setup/setup-dialog";
import {
  LiveVibeTVPreview,
  type DisplayFrameSnapshot,
} from "./live-vibetv-preview";
import { hardwareWebGLAvailable } from "./vibetv-3d-support";

// three.js and the model are their own chunk, loaded only on Overview.
const VibeTV3DPreview = dynamic(
  () => import("./vibetv-3d-preview").then((module) => module.VibeTV3DPreview),
  { ssr: false },
);

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

const DIALOGS = '[role="dialog"], [role="alertdialog"]';

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
  /** The app runs on Windows; the wording says "computer" instead of "Mac". */
  windowsHost?: boolean;
};

/**
 * Overview shows only the VibeTV, centered in 3D. The status line above it is
 * the only text. The Mac App, VibeTV, Display and firmware tiles are gone (the
 * approved calm Overview, #713). Calm rule 12 is deliberately not applied to
 * this page: the device is centered, not left-aligned.
 */
export function OverviewScreen({
  device,
  displayFrame = null,
  firmwareUpdateStatus = null,
  notice = null,
  onCloseNotice,
  usage,
}: OverviewScreenProps) {
  const connected = deviceIsCustomerConnected(device);
  const updateOwnedDisconnect = Boolean(
    !connected && firmwareUpdateStatus?.phase === "installing",
  );
  // The heading and the flat live preview come first. The 3D case starts after
  // the first paint, only on a hardware WebGL, and replaces the flat preview
  // once its model is on screen; the device screen inside shows the live
  // state, or the offline placeholder when VibeTV has no live frame.
  const [use3D, setUse3D] = useState(false);
  const [threeReady, setThreeReady] = useState(false);
  // Stable, so the flat preview's handover timer is not restarted on each poll.
  const onThreeReady = useCallback(() => setThreeReady(true), []);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setUse3D(hardwareWebGLAvailable()),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  // The notice waits while another dialog is open on the page. Its own dialog
  // is one of the open dialogs, so it is counted out with the ref. The first
  // answer is read before the first render, so it never opens over a dialog
  // that is already there.
  const [otherDialogOpen, setOtherDialogOpen] = useState(
    () =>
      typeof document !== "undefined" &&
      document.querySelectorAll(DIALOGS).length > 0,
  );
  const noticeOpen = notice !== null && !otherDialogOpen;
  const noticeOpenRef = useRef(false);
  useLayoutEffect(() => {
    noticeOpenRef.current = noticeOpen;
  });
  useLayoutEffect(() => {
    const check = () =>
      setOtherDialogOpen(
        document.querySelectorAll(DIALOGS).length >
          (noticeOpenRef.current ? 1 : 0),
      );
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mx-auto max-w-[1180px] py-4">
      <section aria-labelledby="vibetv-overview-title">
        <h2
          className="text-[28px] font-semibold leading-tight tracking-tight text-foreground"
          id="vibetv-overview-title"
        >
          {connected
            ? "VibeTV is connected"
            : updateOwnedDisconnect
              ? "VibeTV is restarting"
              : "VibeTV status"}
        </h2>

        <div className="relative mt-6 flex w-full justify-center">
          {use3D ? (
            <div
              // Until the 3D is revealed it is only drawn in the background:
              // the flat preview is the one screen readers get.
              aria-hidden={threeReady ? undefined : true}
              className={
                threeReady
                  ? "flex w-full justify-center"
                  : "absolute inset-0 flex justify-center opacity-0"
              }
              inert={threeReady ? undefined : true}
            >
              <VibeTV3DPreview
                className="aspect-[14/9] max-w-[900px]"
                device={device}
                displayFrame={displayFrame}
                onReady={onThreeReady}
                updateOwnedDisconnect={updateOwnedDisconnect}
                usage={usage || null}
              />
            </div>
          ) : null}
          {threeReady ? null : (
            <LiveVibeTVPreview
              device={device}
              displayFrame={displayFrame}
              updateOwnedDisconnect={updateOwnedDisconnect}
              usage={usage || null}
            />
          )}
        </div>
      </section>

      {notice ? (
        <SetupDialog
          description={NOTICE_COPY[notice].description}
          onOpenChange={(open) => {
            if (!open) onCloseNotice?.(notice);
          }}
          open={noticeOpen}
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
