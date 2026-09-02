import type {
  ApiError,
  PreferenceDescriptor,
  ProviderDisplaySelection,
} from "./control-center-types";

/**
 * Everything the Settings tab needs to offer the provider choice.
 *
 * The picker that used to live here is gone: Settings now renders the same
 * `DisplayModeChoice` and `ProviderList` the setup wizard does. Two parallel
 * implementations of one choice is what let Settings drift into offering
 * "Always show one" against the wizard's "Manual", a per-provider inclusion
 * checkbox the wizard never had, and a repair effect that existed only to
 * finish what that checkbox left half-done.
 */
export type ProviderPickerProps = {
  display: ProviderDisplaySelection | null;
  displayError?: ApiError | null;
  displayPendingProviderId?: string | null;
  items: PreferenceDescriptor[] | null;
  preferencesError?: ApiError | null;
  pendingCheckIds: Set<string>;
  pendingPreferenceIds: Set<string>;
  onCheck: (item: PreferenceDescriptor) => void | Promise<void>;
  onDisplayChange: (
    selection: Pick<ProviderDisplaySelection, "mode" | "providerIds">,
    providerId: string,
  ) => void | Promise<boolean | void>;
  onPreferenceChange: (
    item: PreferenceDescriptor,
    value: boolean,
  ) => void | Promise<void>;
};

export type ProviderItem = PreferenceDescriptor & {
  type: "boolean";
  value: boolean;
  providerId: string;
  health: NonNullable<PreferenceDescriptor["health"]>;
};

export function isProviderItem(
  item: PreferenceDescriptor,
): item is ProviderItem {
  return (
    item.section === "providers" &&
    item.type === "boolean" &&
    typeof item.value === "boolean" &&
    typeof item.providerId === "string" &&
    item.providerId.length > 0 &&
    Boolean(item.health)
  );
}
