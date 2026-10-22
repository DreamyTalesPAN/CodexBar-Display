import { type ApiError, type DeviceInfo } from "./control-center-types";

export function normalizeError(error: unknown, status: number): ApiError {
  if (error && typeof error === "object") {
    const maybeError = error as Partial<ApiError>;
    return {
      code: maybeError.code || `HTTP_${status}`,
      message: maybeError.message || "Request failed.",
      nextAction: maybeError.nextAction || "Try again.",
      ...(maybeError.device ? { device: maybeError.device } : {}),
    };
  }
  return {
    code: `HTTP_${status}`,
    message: "Request failed.",
    nextAction: "Try again.",
  };
}

export function themeInstallErrorText(error: ApiError): string {
  const message = error.message?.trim();
  const nextAction = error.nextAction?.trim();
  if (!message) {
    return nextAction || "The install failed. Try again.";
  }
  if (!nextAction || nextAction === message) {
    return message;
  }
  return `${message} ${nextAction}`;
}

export function normalizeCaughtError(
  error: unknown,
  fallbackMessage: string,
): ApiError {
  if (error && typeof error === "object" && "code" in error) {
    return error as ApiError;
  }
  if (error instanceof Error) {
    if (isCompanionConnectionError(error)) {
      return companionUnavailableError();
    }
    return {
      code: "CLIENT_ERROR",
      message: fallbackMessage,
      nextAction: error.message,
    };
  }
  return {
    code: "CLIENT_ERROR",
    message: fallbackMessage,
    nextAction: "Run setup again, then connect VibeTV.",
  };
}

export function connectionErrorForCustomer(error: ApiError): ApiError {
  if (error.code === "legacy_pairing_recovery_required") {
    return error;
  }
  if (
    error.code === "pairing_token_rejected" ||
    error.code === "pairing_window_closed"
  ) {
    return {
      code: "connect_failed",
      message: "VibeTV could not connect.",
      nextAction: "Press Connect again. If it still fails, create a report.",
    };
  }
  if (error.code === "pairing_rate_limited") {
    return {
      code: "connect_temporarily_unavailable",
      message: "VibeTV is temporarily unavailable.",
      nextAction: "Wait one minute, then press Connect again.",
    };
  }
  return error;
}

export function pairingRejectionForDevice(
  device: DeviceInfo | null | undefined,
): ApiError | null {
  if (
    device?.active !== true ||
    device.stream?.errorCode !== "pairing_token_rejected"
  ) {
    return null;
  }
  if (device.firmware === "1.0.38") {
    return {
      code: "legacy_pairing_recovery_required",
      message: "This VibeTV uses an older recovery method.",
      nextAction:
        "Follow the recovery steps in Control Center, then press Connect.",
    };
  }
  return {
    code: "pairing_rejected",
    message: "VibeTV could not connect.",
    nextAction: "VibeTV no longer accepts this computer. Run setup again to connect it.",
  };
}

// Status polls rebuild the error for a condition that is still active. Keep the
// object already shown, so a dialog the customer closed stays closed; a new
// occurrence (different text) is a new object and shows again.
export function sameActiveError(
  current: ApiError | null | undefined,
  next: ApiError,
): ApiError {
  if (
    current &&
    current.code === next.code &&
    current.message === next.message &&
    current.nextAction === next.nextAction
  ) {
    return current;
  }
  return next;
}

export function isConnectionRecoveryError(error?: ApiError | null): boolean {
  return (
    error?.code === "legacy_pairing_recovery_required" ||
    error?.code === "connect_failed" ||
    error?.code === "pairing_rejected" ||
    error?.code === "connect_temporarily_unavailable" ||
    error?.code === "pairing_window_closed" ||
    error?.code === "pairing_token_rejected" ||
    error?.code === "pairing_rate_limited"
  );
}

export function normalizeUsageError(error: ApiError): ApiError {
  if (error.code === "HTTP_404") {
    return {
      code: "MAC_APP_UPDATE_REQUIRED",
      message: "Mac App update needed.",
      nextAction: "Run setup again, then refresh usage.",
    };
  }
  return error;
}

export function localControlCenterUnavailableError(): ApiError {
  return {
    code: "LOCAL_CONTROL_CENTER_UNAVAILABLE",
    message: "Mac App update needed.",
    nextAction:
      "Update the Mac App or run setup again, then open Control Center.",
  };
}

export async function normalizeLocalControlCenterError(
  error: unknown,
): Promise<ApiError> {
  if (error && typeof error === "object" && "code" in error) {
    return error as ApiError;
  }
  if (error instanceof Error && isCompanionConnectionError(error)) {
    const accessState = await readLocalNetworkAccessState();
    if (localNetworkAccessNeedsUserAction(accessState)) {
      return localNetworkAccessError(accessState);
    }
    return companionUnavailableError();
  }
  return localControlCenterUnavailableError();
}

export function companionUnavailableError(): ApiError {
  return {
    code: "COMPANION_UNREACHABLE",
    message: "Mac App did not answer.",
    nextAction:
      "Quit VibeTV Control Center, then open it again from Applications. If it still does not answer, replace it with the latest Mac App from app.vibetv.shop.",
  };
}

export function isCompanionConnectionError(error: Error): boolean {
  return /failed to fetch|fetch failed|load failed|networkerror|connection refused|err_connection_refused|couldn'?t connect/i.test(
    error.message,
  );
}

export function isLocalCompanionFetchFailureReason(reason: unknown): boolean {
  if (reason instanceof Error) {
    return isCompanionConnectionError(reason);
  }
  return /failed to fetch|fetch failed|load failed|networkerror|connection refused|err_connection_refused|couldn'?t connect/i.test(
    String(reason),
  );
}

export function isCompanionMissingError(error: ApiError): boolean {
  return error.code === "COMPANION_UNREACHABLE";
}

export function isLocalNetworkAccessError(error?: ApiError | null): boolean {
  return error?.code === "LOCAL_NETWORK_ACCESS_REQUIRED";
}

export function localNetworkAccessNeedsUserAction(
  state: PermissionState | "unsupported",
): boolean {
  return state === "prompt" || state === "denied";
}

export function localNetworkAccessError(
  state: PermissionState | "unsupported",
): ApiError {
  if (state === "denied") {
    return {
      code: "LOCAL_NETWORK_ACCESS_REQUIRED",
      message: "Local Control Center is blocked.",
      nextAction: "Open the local Control Center again, then retry.",
    };
  }
  return {
    code: "LOCAL_NETWORK_ACCESS_REQUIRED",
    message: "Local Control Center could not be reached.",
    nextAction: "Open the local Control Center again, then retry.",
  };
}

export async function readLocalNetworkAccessState(): Promise<
  PermissionState | "unsupported"
> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unsupported";
  }
  const permissionNames = ["loopback-network", "local-network-access"];
  for (const name of permissionNames) {
    try {
      const status = await navigator.permissions.query({
        name: name as unknown as PermissionName,
      });
      return status.state;
    } catch {
      // Chrome versions disagree on the permission name. Try the next one.
    }
  }
  return "unsupported";
}
