"use client";

import {
  AppWindow,
  ArrowUpFromLine,
  Check,
  CircleHelp,
  Monitor,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import type {
  CompanionStatus,
  DeviceInfo,
  UsageSnapshot,
} from "./control-center-types";
import {
  deviceIsActive,
  deviceIsCustomerConnected,
  deviceIsReady,
  deviceIsWaitingForUsage,
} from "./control-center-types";
import {
  LiveVibeTVPreview,
  type DisplayFrameSnapshot,
} from "./live-vibetv-preview";

type OverviewScreenProps = {
  companionVersion?: string;
  companionStatus: CompanionStatus;
  device: DeviceInfo | null;
  displayFrame?: DisplayFrameSnapshot | null;
  firmwareUpdateStatus?: {
    phase?: string;
    stage?: string;
  } | null;
  usage?: UsageSnapshot | null;
};

export function OverviewScreen({
  companionVersion,
  companionStatus,
  device,
  displayFrame = null,
  firmwareUpdateStatus = null,
  usage,
}: OverviewScreenProps) {
  const pairingRejected = device?.paired === false;
  const connected = deviceIsCustomerConnected(device);
  const displayReady = deviceIsReady(device);
  const waitingForUsage = deviceIsWaitingForUsage(device);
  const reconnecting =
    deviceIsActive(device) &&
    !deviceIsReady(device) &&
    !pairingRejected &&
    !waitingForUsage;
  const updateOwnedDisconnect = Boolean(
    !connected && firmwareUpdateStatus?.phase === "installing",
  );
  const hero = buildHeroCopy(companionStatus, connected, updateOwnedDisconnect);

  return (
    <div className="mx-auto max-w-[1180px] py-4">
      <section aria-labelledby="vibetv-overview-title">
        <div className="mx-auto flex w-full max-w-[1040px] flex-col items-center gap-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <Badge variant={hero.badgeVariant}>
              {hero.icon}
              <span>{hero.badge}</span>
            </Badge>
            <h2
              className="text-4xl font-black tracking-tight md:text-5xl"
              id="vibetv-overview-title"
            >
              {connected
                ? "VibeTV is connected"
                : updateOwnedDisconnect
                  ? "VibeTV is restarting"
                  : "VibeTV status"}
            </h2>
          </div>

          <div className="flex w-full justify-center">
            <LiveVibeTVPreview
              device={device}
              displayFrame={displayFrame}
              updateOwnedDisconnect={updateOwnedDisconnect}
              usage={usage || null}
            />
          </div>

          <ItemGroup className="grid w-full gap-3 lg:grid-cols-4">
            <StatusItem
              icon={<AppWindow aria-hidden />}
              label="Mac App"
              value={labelForCompanion(companionStatus, companionVersion)}
            />
            <StatusItem
              icon={<ArrowUpFromLine aria-hidden />}
              label="VibeTV"
              value={
                connected
                  ? "Connected"
                  : updateOwnedDisconnect
                    ? "Restarting"
                    : "Not connected"
              }
            />
            <StatusItem
              detail={
                displayReady
                  ? undefined
                  : updateOwnedDisconnect
                    ? "No action is required. Keep VibeTV connected to power and wait."
                  : waitingForUsage
                    ? "This can take up to 60 seconds."
                    : "Waiting for a fresh image from VibeTV."
              }
              icon={<Monitor aria-hidden />}
              label="Display"
              value={
                displayReady
                  ? "Live"
                  : updateOwnedDisconnect
                    ? "Update running"
                  : waitingForUsage
                    ? "Waiting for usage"
                    : "Waiting for first image"
              }
            />
            <StatusItem
              icon={<Monitor aria-hidden />}
              label="VibeTV firmware"
              value={device?.firmware || "Waiting for VibeTV"}
            />
          </ItemGroup>
        </div>
      </section>
    </div>
  );
}

function ReconnectNotice({ device }: { device: DeviceInfo | null }) {
  const wifiSetupLikely =
    device?.connected === false || device?.connectionState === "setup_required";
  return (
    <Alert className="w-full max-w-[1040px]">
      <WifiOff aria-hidden />
      <AlertTitle>Reconnecting to VibeTV</AlertTitle>
      <AlertDescription>
        {wifiSetupLikely
          ? "If VibeTV shows VibeTV-Setup, connect your phone to it and choose the new WiFi. Your pairing and settings stay saved."
          : "VibeTV is online, but its display is still reconnecting."}
      </AlertDescription>
    </Alert>
  );
}

function StatusItem({
  detail,
  icon,
  label,
  value,
}: {
  detail?: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Item className="min-w-0 flex-nowrap items-start" role="listitem" variant="muted">
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemDescription>{label}</ItemDescription>
        <ItemTitle>{value}</ItemTitle>
        {detail ? <ItemDescription>{detail}</ItemDescription> : null}
      </ItemContent>
    </Item>
  );
}

function buildHeroCopy(
  companionStatus: CompanionStatus,
  connected: boolean,
  updateOwnedDisconnect = false,
) {
  if (connected) {
    return {
      badge: "Connected",
      badgeVariant: "default" as const,
      icon: <Check data-icon="inline-start" aria-hidden />,
    };
  }
  if (updateOwnedDisconnect) {
    return {
      badge: "Updating",
      badgeVariant: "default" as const,
      icon: <ArrowUpFromLine data-icon="inline-start" aria-hidden />,
    };
  }
  return {
    badge:
      companionStatus === "missing" ? "Mac App offline" : "Not connected",
    badgeVariant: "outline" as const,
    icon: <CircleHelp data-icon="inline-start" aria-hidden />,
  };
}

function labelForCompanion(
  status: CompanionStatus,
  companionVersion?: string,
): string {
  if (status === "online") {
    return companionVersion ? `Online ${companionVersion}` : "Online";
  }
  if (status === "missing") {
    return "Not reachable";
  }
  return "Waiting for Mac App";
}
