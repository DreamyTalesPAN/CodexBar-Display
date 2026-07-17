"use client";

import {
  AppWindow,
  ArrowUpFromLine,
  Check,
  CircleHelp,
  Download,
  Monitor,
  Palette,
  RefreshCw,
  SlidersHorizontal,
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
import { Spinner } from "@/components/ui/spinner";
import {
  availableMacAppDmgDownloadUrl,
  type CompanionReleaseInfo,
} from "@/lib/companion-release";
import { hasFirmwareUpdate, type FirmwareUpdateInfo } from "@/lib/firmware";
import {
  deviceImageIsStuck,
  type CompanionStatus,
  type DeviceInfo,
  type DeviceState,
  type UsageSnapshot,
} from "./control-center-types";
import { LiveVibeTVPreview } from "./live-vibetv-preview";

type OverviewScreenProps = {
  companionVersion?: string;
  companionRelease?: CompanionReleaseInfo | null;
  companionStatus: CompanionStatus;
  deviceState: DeviceState;
  device: DeviceInfo | null;
  firmwareUpdate?: FirmwareUpdateInfo | null;
  usage?: UsageSnapshot | null;
  busyAction?: string | null;
  onReloadImage?: () => void;
  requiresMacAppMigration?: boolean;
};

export function OverviewScreen({
  busyAction,
  companionVersion,
  companionRelease,
  companionStatus,
  deviceState,
  device,
  firmwareUpdate,
  usage,
  onReloadImage,
  requiresMacAppMigration = false,
}: OverviewScreenProps) {
  const imageStuck = deviceImageIsStuck(device);
  const reloadingImage = busyAction === "reload-display";
  const ready = Boolean(device?.ready && !imageStuck);
  const healthDetail = deviceHealthDetail(device);
  const hero = buildHeroCopy({
    companionStatus,
    ready,
    reachable: Boolean(device?.connected),
    imageStuck,
    reloadingImage,
  });
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
              VibeTV
            </h2>
          </div>

          <div className="flex justify-center">
            <LiveVibeTVPreview device={device} usage={usage || null} />
          </div>

          <ItemGroup className="grid w-full gap-3 lg:grid-cols-4">
            <StatusItem
              icon={<Monitor aria-hidden />}
              label="VibeTV"
              value={labelForDevice(deviceState, device, reloadingImage)}
            />
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
              badge={firmwareUpdateAvailable ? "Update" : undefined}
              icon={<ArrowUpFromLine aria-hidden />}
              label="Firmware"
              value={device?.firmware || "Waiting for VibeTV"}
            />
            <StatusItem
              icon={<Palette aria-hidden />}
              label="Active theme"
              value={activeThemeLabel(device)}
            />
          </ItemGroup>
        </div>

        {healthDetail || imageStuck ? (
          <Card className="mx-auto mt-4 max-w-[1040px]" size="sm">
            <CardHeader>
              <CardTitle>
                {imageStuck ? "Screen needs attention" : "Connection detail"}
              </CardTitle>
              <CardDescription>
                {imageStuck ? imageStuckDetail(device) : healthDetail}
              </CardDescription>
            </CardHeader>
            {imageStuck && onReloadImage ? (
              <CardFooter>
                <Button
                  disabled={reloadingImage}
                  onClick={onReloadImage}
                  type="button"
                >
                  {reloadingImage ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <RefreshCw data-icon="inline-start" aria-hidden />
                  )}
                  <span>{reloadingImage ? "Reloading image" : "Reload image"}</span>
                </Button>
              </CardFooter>
            ) : null}
          </Card>
        ) : null}

        {requiresMacAppMigration ? (
          <MacAppMigrationCard downloadUrl={macAppMigrationUrl} />
        ) : null}
      </section>
    </div>
  );
}

function MacAppMigrationCard({ downloadUrl }: { downloadUrl?: string }) {
  const downloadReady = Boolean(downloadUrl);
  return (
    <Card
      aria-labelledby="mac-app-migration-title"
      className="mx-auto mt-4 max-w-[1040px]"
    >
      <CardHeader>
        <CardTitle id="mac-app-migration-title">
          {downloadReady
            ? "Mac App update available"
            : "Mac App update not ready"}
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
    <Item
      className="min-w-0 flex-nowrap items-start"
      role="listitem"
      variant="muted"
    >
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

function buildHeroCopy({
  companionStatus,
  ready,
  reachable,
  imageStuck,
  reloadingImage,
}: {
  companionStatus: CompanionStatus;
  ready: boolean;
  reachable: boolean;
  imageStuck: boolean;
  reloadingImage: boolean;
}) {
  if (reloadingImage) {
    return {
      badge: "Updating",
      badgeVariant: "outline" as const,
      icon: <Spinner data-icon="inline-start" />,
    };
  }
  if (imageStuck) {
    return {
      badge: "Needs attention",
      badgeVariant: "destructive" as const,
      icon: <RefreshCw data-icon="inline-start" aria-hidden />,
    };
  }
  if (ready) {
    return {
      badge: "Connected",
      badgeVariant: "default" as const,
      icon: <Check data-icon="inline-start" aria-hidden />,
    };
  }
  if (reachable) {
    return {
      badge: "Preparing",
      badgeVariant: "outline" as const,
      icon: <SlidersHorizontal data-icon="inline-start" aria-hidden />,
    };
  }
  return {
    badge: companionStatus === "missing" ? "Setup needed" : "Checking",
    badgeVariant: "outline" as const,
    icon:
      companionStatus === "missing" ? (
        <CircleHelp data-icon="inline-start" aria-hidden />
      ) : (
        <SlidersHorizontal data-icon="inline-start" aria-hidden />
      ),
  };
}

function activeThemeLabel(device: DeviceInfo | null): string {
  const theme = device?.activeTheme?.trim();
  if (!theme) {
    return device?.connected ? "Default" : "Waiting for VibeTV";
  }
  return theme
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function labelForCompanion(
  status: CompanionStatus,
  companionVersion?: string,
): string {
  if (status === "online") {
    return companionVersion ? `Online ${companionVersion}` : "Online";
  }
  if (status === "missing") {
    return "Needs install";
  }
  return "Waiting for Mac App";
}

function labelForDevice(
  state: DeviceState,
  device: DeviceInfo | null,
  reloadingImage: boolean,
): string {
  if (reloadingImage) {
    return "Reloading image";
  }
  if (deviceImageIsStuck(device)) {
    return "Image is stuck";
  }
  if (device?.connectionState === "reconnecting") {
    return "Unavailable";
  }
  if (device?.ready) {
    return "Connected";
  }
  if (device?.connected) {
    return "Found";
  }
  if (state === "offline") {
    return "Offline";
  }
  return "Waiting for device";
}

function imageStuckDetail(device: DeviceInfo | null): string {
  const error = device?.display?.themeSpec?.renderError?.trim();
  if (error === "low_heap_full_render") {
    return "The connection works. VibeTV is freeing memory and redrawing the image.";
  }
  return "The connection works, but VibeTV could not redraw the current screen.";
}

function deviceHealthDetail(device: DeviceInfo | null): string | undefined {
  const resetReason = device?.health?.resetReason?.trim();
  if (resetReason && resetReason.toLowerCase() === "exception") {
    return "VibeTV restarted after a firmware exception. If this keeps happening, reconnect power and run setup again.";
  }
  if (device?.connectionState === "reconnecting") {
    return "VibeTV is currently unavailable.";
  }
  if (device?.connected && device.health?.error) {
    return "VibeTV is reachable, but health details are temporarily unavailable.";
  }
  if (device?.connected && !device.ready) {
    return device.stream?.running && !device.stream.healthy
      ? "VibeTV is reachable, but the Mac App has not delivered the first image yet."
      : "VibeTV is reachable, but the first image has not appeared yet.";
  }
  return undefined;
}
