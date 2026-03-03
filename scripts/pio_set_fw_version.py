Import("env")
import os


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
