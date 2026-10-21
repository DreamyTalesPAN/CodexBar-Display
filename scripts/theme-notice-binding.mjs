// Asks the firmware's question (ThemeSpecLiveUse in
// firmware_shared/codexbar_display_core.h): does a primitive draw the label,
// through its binding or a {label} placeholder? Only then does the update notice
// render inside the theme instead of the overlay bar.
export function usesLabelBinding(specRaw) {
  const labelKeys = new Set(["label", "providerLabel", "l"]);
  const spec = JSON.parse(specRaw);
  return (spec.primitives || spec.p || []).some((primitive) => {
    // All footer spellings read by the firmware and the live preview carry notices.
    const showsNotice = (key) => labelKeys.has(key) || /^(?:usageSlot[12]|us[12]|usage\.\d+\.)PaceFooter$/.test(key);
    const binding = primitive.binding ?? primitive.b;
    if (typeof binding === "string") {
      return showsNotice(binding);
    }
    const text = primitive.text ?? primitive.v;
    return typeof text === "string" &&
      [...text.matchAll(/\{([^{}]+)\}/g)].some((match) => showsNotice(match[1]));
  });
}
