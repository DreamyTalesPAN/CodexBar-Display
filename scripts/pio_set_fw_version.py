Import("env")
import os
from SCons.Script import COMMAND_LINE_TARGETS, Exit


def normalize_version(raw):
    value = (raw or "").strip()
    if value.startswith("v"):
        value = value[1:]
    if not value:
        value = "1.0.0"
    return value


version = normalize_version(
    os.getenv("CODEXBAR_DISPLAY_FW_VERSION", env.GetProjectOption("custom_fw_version", "1.0.0"))
)
env.Append(CPPDEFINES=[("CODEXBAR_DISPLAY_FW_VERSION", '\\"{}\\"'.format(version))])
print("[codexbar-display] firmware semver {}".format(version))

upload_targets = {"upload", "uploadfs"}
if any(target in upload_targets or target.endswith(":upload") for target in COMMAND_LINE_TARGETS):
    if os.getenv("CODEXBAR_DISPLAY_ALLOW_SOURCE_UPLOAD") != "1":
        print(
            "[codexbar-display] refusing direct PlatformIO upload from local source. "
            "Use `codexbar-display install-update --target <device-url> --confirm-live-update` for WiFi release firmware, "
            "or `codexbar-display upgrade --port <serial> --firmware-env <env>` for explicit USB recovery, "
            "or set CODEXBAR_DISPLAY_ALLOW_SOURCE_UPLOAD=1 for an intentional source firmware test."
        )
        Exit(1)
