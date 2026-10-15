// VibeTVs whose setup this app has finished. A later launch takes such a
// VibeTV straight to the Control Center instead of replaying the setup's last
// screen. Cleared web storage or "Run setup again" shows that screen once
// more, with its check.

const STORAGE_KEY = "vibetv.controlCenter.completedSetupDevices";
const KEPT = 20;

function storedDeviceIds(): string[] {
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "[]",
    );
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
    return [];
  }
}

export function setupCompletedFor(deviceId: string | undefined): boolean {
  const id = deviceId?.trim().toLowerCase();
  return Boolean(id && storedDeviceIds().includes(id));
}

export function rememberCompletedSetup(deviceId: string | undefined) {
  const id = deviceId?.trim().toLowerCase();
  if (!id) {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        [...storedDeviceIds().filter((stored) => stored !== id), id].slice(
          -KEPT,
        ),
      ),
    );
  } catch {
    // See above.
  }
}

export function forgetCompletedSetups() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See above.
  }
}
