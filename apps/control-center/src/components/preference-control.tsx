import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  PreferenceDescriptor,
  PreferenceValue,
} from "./control-center-types";

const defaultOptionValue = "__vibetv_default__";

type PreferenceControlProps = {
  descriptor: PreferenceDescriptor;
  disabled?: boolean;
  booleanLabel?: string;
  onChange: (value: PreferenceValue) => void | Promise<void>;
};

export function PreferenceControl({
  descriptor,
  disabled = false,
  booleanLabel,
  onChange,
}: PreferenceControlProps) {
  const unavailable =
    disabled ||
    !descriptor.writable ||
    descriptor.availability.state !== "available";

  switch (descriptor.type) {
    case "boolean":
      return (
        <Switch
          aria-label={booleanLabel || descriptor.label}
          checked={descriptor.value === true}
          disabled={unavailable}
          onCheckedChange={(value) => void onChange(value)}
        />
      );
    case "enum":
      return (
        <Select
          disabled={unavailable}
          onValueChange={(value) =>
            void onChange(value === defaultOptionValue ? null : value)
          }
          value={
            descriptor.value === null
              ? defaultOptionValue
              : String(descriptor.value)
          }
        >
          <SelectTrigger aria-label={descriptor.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {descriptor.allowsDefault ? (
              <SelectItem value={defaultOptionValue}>Default</SelectItem>
            ) : null}
            {(descriptor.options || []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "integer":
    case "duration":
      return (
        <Input
          aria-label={descriptor.label}
          defaultValue={
            typeof descriptor.value === "number" ? descriptor.value : ""
          }
          disabled={unavailable}
          max={descriptor.constraints?.max}
          min={descriptor.constraints?.min}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim();
            if (raw === "" && descriptor.allowsDefault) {
              void onChange(null);
              return;
            }
            const value = Number(raw);
            if (Number.isSafeInteger(value)) {
              void onChange(value);
            }
          }}
          step={descriptor.constraints?.step || 1}
          type="number"
        />
      );
    case "string":
      return (
        <Input
          aria-label={descriptor.label}
          defaultValue={
            typeof descriptor.value === "string" ? descriptor.value : ""
          }
          disabled={unavailable}
          onBlur={(event) =>
            void onChange(
              event.currentTarget.value === "" && descriptor.allowsDefault
                ? null
                : event.currentTarget.value,
            )
          }
        />
      );
    case "action":
      return (
        <Button
          disabled={unavailable}
          onClick={() => void onChange(true)}
          type="button"
          variant="outline"
        >
          {descriptor.label}
        </Button>
      );
    case "secret":
      return (
        <span className="text-sm text-muted-foreground">
          {descriptor.secretState === "configured"
            ? "Configured"
            : "Not configured"}
        </span>
      );
  }
}
