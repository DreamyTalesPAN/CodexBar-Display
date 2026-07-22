import { Monitor } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { DeviceCandidate } from "./control-center-types";

export function WifiSetupInstructions() {
  return (
    <div className="border-y border-[#747A60] py-6 text-left sm:px-6">
      <ol className="grid list-decimal gap-3 pl-5 text-base leading-7 text-[#444933] sm:text-lg">
        <li>Plug VibeTV into power.</li>
        <li>Wait until VibeTV shows VibeTV-Setup.</li>
        <li>Take your phone.</li>
        <li>
          Open WiFi settings and join <strong>VibeTV-Setup</strong>.
        </li>
        <li>
          If the browser does not open automatically, open{" "}
          <strong>192.168.4.1</strong> on your phone.
        </li>
        <li>Choose your home WiFi and save.</li>
        <li>Wait until VibeTV says WiFi connected, then continue here.</li>
      </ol>
    </div>
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
    <div className="grid gap-3 text-left">
      {candidates.map((candidate) => (
        <div
          className="grid gap-4 border border-[#747A60] bg-[#F9F9F9] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          key={`${candidate.deviceId || "legacy"}-${candidate.target}`}
        >
          <DeviceCandidateDetails candidate={candidate} />
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => onSelect(candidate)}
            size="lg"
            type="button"
            variant={buttonVariant}
          >
            {selecting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Monitor data-icon="inline-start" aria-hidden />
            )}
            <span>{selecting ? "Connecting" : "Connect this VibeTV"}</span>
          </Button>
        </div>
      ))}
    </div>
  );
}

export function DeviceCandidateDetails({
  candidate,
}: {
  candidate: DeviceCandidate;
}) {
  const address = candidateAddress(candidate.target);
  return (
    <div className="min-w-0">
      <p className="break-words text-base font-black text-[#1B1B1B] sm:text-lg">
        VibeTV {candidate.deviceId || address}
      </p>
      <p className="mt-1 break-words text-sm leading-6 text-[#444933]">
        IP address: {address}
        {candidate.firmware ? ` · Firmware ${candidate.firmware}` : ""}
      </p>
      {candidate.known ? (
        <p className="mt-1 text-sm font-bold text-[#506600]">
          Previously connected
        </p>
      ) : null}
    </div>
  );
}

function candidateAddress(target: string): string {
  try {
    return new URL(target).hostname || target;
  } catch {
    return target.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
}
