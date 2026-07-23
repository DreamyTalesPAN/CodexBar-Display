import { Monitor } from "lucide-react";
import type { ComponentProps } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { DeviceCandidate } from "./control-center-types";

export function WifiSetupInstructions() {
  return (
    <Alert>
      <Monitor aria-hidden />
      <AlertTitle>Connect VibeTV to WiFi</AlertTitle>
      <AlertDescription>
        <ol className="grid list-decimal gap-2 pl-5">
        <li>Plug VibeTV into power.</li>
        <li>Wait until VibeTV shows VibeTV-Setup.</li>
        <li>
            On your phone, open WiFi settings and join{" "}
            <strong>VibeTV-Setup</strong>.
        </li>
        <li>
          If the browser does not open automatically, open{" "}
          <strong>192.168.4.1</strong> on your phone.
        </li>
        <li>Choose your home WiFi and save.</li>
        <li>Wait until VibeTV says WiFi connected, then continue here.</li>
        </ol>
      </AlertDescription>
    </Alert>
  );
}

type DeviceCandidateListProps = {
  busy?: boolean;
  buttonVariant?: ComponentProps<typeof Button>["variant"];
  candidates: DeviceCandidate[];
  onSelect: (candidate: DeviceCandidate) => void;
  selecting?: boolean;
};

export function DeviceCandidateList({
  busy = false,
  buttonVariant = "default",
  candidates,
  onSelect,
  selecting = false,
}: DeviceCandidateListProps) {
  return (
    <ItemGroup className="grid gap-3 text-left">
      {candidates.map((candidate) => (
        <Item
          key={`${candidate.deviceId || "legacy"}-${candidate.target}`}
          variant="outline"
        >
          <ItemMedia variant="icon">
            <Monitor aria-hidden />
          </ItemMedia>
          <DeviceCandidateDetails candidate={candidate} />
          <ItemActions>
            <Button
              disabled={busy}
              onClick={() => onSelect(candidate)}
              type="button"
              variant={buttonVariant}
            >
              {selecting ? <Spinner data-icon="inline-start" /> : null}
              <span>{selecting ? "Connecting" : "Connect"}</span>
            </Button>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}

export function DeviceCandidateDetails({
  candidate,
}: {
  candidate: DeviceCandidate;
}) {
  const address = candidateAddress(candidate.target);
  return (
    <ItemContent>
      <ItemTitle>VibeTV {candidate.deviceId || address}</ItemTitle>
      <ItemDescription>
        IP address: {address}
        {candidate.firmware ? ` · Firmware ${candidate.firmware}` : ""}
      </ItemDescription>
      {candidate.known ? <Badge variant="secondary">Previously connected</Badge> : null}
    </ItemContent>
  );
}

function candidateAddress(target: string): string {
  try {
    return new URL(target).hostname || target;
  } catch {
    return target.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
}
