import type { DeviceCandidate } from "../control-center-types";

export type SetupTransport = "cable" | "wifi";

export type SetupConnectionDecision = {
  kind: "direct" | "list" | "mode" | "not-found";
  transport?: SetupTransport;
  candidates: DeviceCandidate[];
  alternative?: SetupTransport;
};

export type SetupConnectionModeResult = {
  status: "selected" | "waiting_for_wifi" | "wifi_credentials_required";
  deviceId?: string;
};

export function candidateKey(candidate: DeviceCandidate): string {
  return `${candidate.transport || "wifi"}:${candidate.deviceId || candidate.target}`;
}

export function decideSetupConnection(options: {
  candidates: DeviceCandidate[];
  choiceRequired: boolean;
  savedMode?: string;
  preferredTransport?: SetupTransport | null;
}): SetupConnectionDecision {
  // Old Companions do not label the transport. Keep their established list
  // behavior; only the new combined Cable/WiFi scan may apply the skip matrix.
  if (
    options.candidates.length > 0 &&
    options.candidates.every((candidate) => !candidate.transport)
  ) {
    return {
      kind: "list",
      transport: "wifi",
      candidates: options.candidates,
    };
  }
  const cable = options.candidates.filter(
    (candidate) => candidate.transport === "cable",
  );
  const wifi = options.candidates.filter(
    (candidate) => candidate.transport !== "cable",
  );
  const saved = options.savedMode === "cable" ? "cable" : "wifi";
  const preferred =
    options.preferredTransport || (!options.choiceRequired ? saved : null);

  if (preferred) {
    const matches = preferred === "cable" ? cable : wifi;
    return {
      kind:
        matches.length > 1
          ? "list"
          : matches.length === 1
            ? "direct"
            : "not-found",
      transport: preferred,
      candidates: matches,
      alternative: preferred === "cable" ? "wifi" : "cable",
    };
  }
  if (cable.length >= 2) {
    return {
      kind: "list",
      transport: "cable",
      candidates: cable,
      alternative: "wifi",
    };
  }
  if (cable.length === 1 && wifi.length > 0) {
    return { kind: "mode", candidates: options.candidates };
  }
  if (cable.length === 1) {
    return {
      kind: "direct",
      transport: "cable",
      candidates: cable,
      alternative: "wifi",
    };
  }
  if (wifi.length === 1) {
    return {
      kind: "direct",
      transport: "wifi",
      candidates: wifi,
      alternative: "cable",
    };
  }
  if (wifi.length >= 2) {
    return { kind: "list", transport: "wifi", candidates: wifi };
  }
  return { kind: "not-found", candidates: [] };
}
