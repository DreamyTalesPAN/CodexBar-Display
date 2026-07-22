"use client";

import {
  AppWindow,
  ArrowUpFromLine,
  Check,
  CircleHelp,
  Download,
  Monitor,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  availableMacAppDmgDownloadUrl,
  type CompanionReleaseInfo,
} from "@/lib/companion-release";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import type {
  CompanionStatus,
  DeviceInfo,
  UsageSnapshot,
} from "./control-center-types";
import { LiveVibeTVPreview } from "./live-vibetv-preview";

type OverviewScreenProps = {
  companionVersion?: string;
  companionRelease?: CompanionReleaseInfo | null;
  companionStatus: CompanionStatus;
  device: DeviceInfo | null;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  usage?: UsageSnapshot | null;
  requiresMacAppMigration?: boolean;
};

export function OverviewScreen({
  companionVersion,
  companionRelease,
  companionStatus,
  device,
  firmwareUpdate,
  usage,
  requiresMacAppMigration = false,
}: OverviewScreenProps) {
  const pairingRequired =
    device?.stream?.errorCode === "device_pairing_required" ||
    device?.paired === false;
  const connected = deviceIsConnected(device);
  const displayReady = Boolean(device?.ready && !pairingRequired);
  const hero = buildHeroCopy(companionStatus, connected);
  const firmwareUpdateAvailable = hasFirmwareUpdate(firmwareUpdate);
  const macAppUpdateAvailable = Boolean(companionRelease?.updateAvailable);
  const macAppMigrationUrl = requiresMacAppMigration
    ? availableMacAppDmgDownloadUrl(companionRelease)
    : undefined;

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
              {connected ? "VibeTV is connected" : "VibeTV status"}
            </h2>
          </div>

          <div className="flex justify-center">
            <LiveVibeTVPreview device={device} usage={usage || null} />
          </div>

          <ItemGroup className="grid w-full gap-3 lg:grid-cols-4">
            <StatusItem
              badge={
                requiresMacAppMigration
                  ? "New App"
                  : macAppUpdateAvailable
                    ? "Update"
                    : undefined
              }
              icon={<AppWindow aria-hidden />}
              label="Mac App"
              value={labelForCompanion(companionStatus, companionVersion)}
            />
            <StatusItem
              icon={<Monitor aria-hidden />}
              label="VibeTV"
              value={connected ? "Connected" : "Not connected"}
            />
            <StatusItem
              detail={
                displayReady
                  ? undefined
                  : pairingRequired
                    ? "Pair VibeTV again to resume display updates."
                    : "Start using any AI provider."
              }
              icon={<Monitor aria-hidden />}
              label="Display"
              value={displayReady ? "Live" : "Waiting for first image"}
            />
            <StatusItem
              badge={firmwareUpdateAvailable ? "Update" : undefined}
              icon={<ArrowUpFromLine aria-hidden />}
              label="VibeTV firmware"
              value={device?.firmware || "Waiting for VibeTV"}
            />
          </ItemGroup>
        </div>

        {requiresMacAppMigration ? (
          <MacAppMigrationCard downloadUrl={macAppMigrationUrl} />
        ) : null}
      </section>
    </div>
  );
}

function MacAppMigrationCard({ downloadUrl }: { downloadUrl?: string }) {
  return (
    <Card
      aria-labelledby="mac-app-migration-title"
      className="mx-auto mt-4 max-w-[1040px]"
    >
      <CardHeader>
        <CardTitle id="mac-app-migration-title">
          {downloadUrl ? "Update available" : "Mac App update not ready"}
        </CardTitle>
        <CardDescription>
          Keep the Control Center and VibeTV connection on the latest version.
        </CardDescription>
      </CardHeader>
      {downloadUrl ? (
        <CardFooter>
          <Button asChild size="lg">
            <a href={downloadUrl}>
              <Download data-icon="inline-start" />
              <span>Update</span>
            </a>
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function StatusItem({
  badge,
  detail,
  icon,
  label,
  value,
}: {
  badge?: string;
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
      <ItemActions className="flex-wrap justify-end">
        {badge ? <Badge>{badge}</Badge> : null}
      </ItemActions>
    </Item>
  );
}

function buildHeroCopy(
  companionStatus: CompanionStatus,
  connected: boolean,
) {
  if (connected) {
    return {
      badge: "Connected",
      badgeVariant: "default" as const,
      icon: <Check data-icon="inline-start" aria-hidden />,
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

function deviceIsConnected(device: DeviceInfo | null): boolean {
  return Boolean(
    device?.connected &&
      device.paired !== false &&
      device.stream?.errorCode !== "device_pairing_required" &&
      (device.deviceId || device.target),
  );
}
